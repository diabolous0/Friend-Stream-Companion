import { Router, type IRouter } from "express";
import { db, roomMembersTable, botsTable, usersTable, channelsTable, messagesTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { CreateBotBody, PostBotMessageBody } from "@workspace/api-zod";
import { broadcastToRoom, broadcastChannel } from "../lib/signaling";

const router: IRouter = Router();

function parseIdParam(value: string | string[]): number {
  return parseInt(Array.isArray(value) ? value[0] : value, 10);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getStaffMembership(roomId: number, userId: number) {
  const [m] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, userId), eq(roomMembersTable.status, "active")));
  if (!m) return { ok: false as const, code: 403, error: "Not a member" };
  if (m.role !== "owner" && m.role !== "mod") return { ok: false as const, code: 403, error: "Only owner/mod can manage bots" };
  return { ok: true as const };
}

// List bots in a room (staff only).
router.get("/rooms/:roomId/bots", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const roomId = parseIdParam(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const access = await getStaffMembership(roomId, me);
  if (!access.ok) { res.status(access.code).json({ error: access.error }); return; }

  const bots = await db
    .select({ id: botsTable.id, roomId: botsTable.roomId, userId: botsTable.userId, name: botsTable.name, createdAt: botsTable.createdAt })
    .from(botsTable)
    .where(eq(botsTable.roomId, roomId))
    .orderBy(botsTable.id);
  res.json(bots);
});

// Create a bot — returns the token + webhook URL once.
router.post("/rooms/:roomId/bots", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const roomId = parseIdParam(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const access = await getStaffMembership(roomId, me);
  if (!access.ok) { res.status(access.code).json({ error: access.error }); return; }

  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const name = parsed.data.name.trim();
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }

  // Backing user row so bot messages join cleanly with usersTable.
  const username = `bot_${roomId}_${randomBytes(4).toString("hex")}`;
  const [botUser] = await db
    .insert(usersTable)
    .values({ username, passwordHash: randomBytes(16).toString("hex"), displayName: name, isBot: true })
    .returning({ id: usersTable.id });

  const token = randomBytes(24).toString("hex");
  const [bot] = await db
    .insert(botsTable)
    .values({ roomId, userId: botUser.id, name, tokenHash: hashToken(token), createdBy: me })
    .returning({ id: botsTable.id, roomId: botsTable.roomId, userId: botsTable.userId, name: botsTable.name, createdAt: botsTable.createdAt });

  res.status(201).json({ bot, token, webhookUrl: `/api/rooms/${roomId}/bots/${bot.id}/webhook` });
});

router.delete("/rooms/:roomId/bots/:botId", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const roomId = parseIdParam(req.params.roomId);
  const botId = parseIdParam(req.params.botId);
  if (isNaN(roomId) || isNaN(botId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const access = await getStaffMembership(roomId, me);
  if (!access.ok) { res.status(access.code).json({ error: access.error }); return; }

  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, botId), eq(botsTable.roomId, roomId)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  // Keep the backing user + past messages so chat history stays intact; just revoke the bot.
  await db.delete(botsTable).where(eq(botsTable.id, botId));
  res.status(204).end();
});

// Public incoming webhook — authenticated by the bot token in the body.
router.post("/rooms/:roomId/bots/:botId/webhook", async (req, res): Promise<void> => {
  const roomId = parseIdParam(req.params.roomId);
  const botId = parseIdParam(req.params.botId);
  if (isNaN(roomId) || isNaN(botId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = PostBotMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [bot] = await db.select().from(botsTable).where(and(eq(botsTable.id, botId), eq(botsTable.roomId, roomId)));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  const provided = Buffer.from(hashToken(parsed.data.token), "hex");
  const expected = Buffer.from(bot.tokenHash, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const content = parsed.data.content.trim();
  if (!content) { res.status(400).json({ error: "Content is required" }); return; }

  // Validate target channel belongs to the room and is a text-capable channel.
  let channelId: number | null = null;
  if (parsed.data.channelId != null) {
    const [channel] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, parsed.data.channelId), eq(channelsTable.roomId, roomId)));
    if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
    if (channel.type === "voice") { res.status(400).json({ error: "Cannot post text to a voice channel" }); return; }
    channelId = channel.id;
  } else {
    // No channel specified — default to the room's first text-capable channel
    // (clients view messages per-channel, so a null channelId would be invisible).
    const [defaultChannel] = await db
      .select({ id: channelsTable.id })
      .from(channelsTable)
      .where(and(eq(channelsTable.roomId, roomId), ne(channelsTable.type, "voice")))
      .orderBy(channelsTable.position, channelsTable.id);
    channelId = defaultChannel?.id ?? null;
  }

  const [botUser] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, nameColor: usersTable.nameColor, avatarStyle: usersTable.avatarStyle })
    .from(usersTable)
    .where(eq(usersTable.id, bot.userId));

  const [saved] = await db
    .insert(messagesTable)
    .values({ roomId, channelId, userId: bot.userId, content })
    .returning();

  const message = {
    id: saved.id,
    roomId: saved.roomId,
    channelId: saved.channelId,
    userId: saved.userId,
    username: botUser.username,
    displayName: botUser.displayName,
    avatarUrl: botUser.avatarUrl,
    nameColor: botUser.nameColor,
    avatarStyle: botUser.avatarStyle,
    isBot: true,
    content: saved.content,
    createdAt: saved.createdAt,
    editedAt: null,
    pinned: false,
    replyToId: null,
    replyToContent: null,
    replyToUsername: null,
    reactions: [],
  };

  if (channelId != null) {
    broadcastChannel(channelId, { type: "new_message", message });
  } else {
    broadcastToRoom(roomId, { type: "new_message", message });
  }
  res.status(201).json(message);
});

export default router;
