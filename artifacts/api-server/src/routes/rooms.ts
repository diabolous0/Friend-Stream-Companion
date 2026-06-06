import { Router, type IRouter } from "express";
import { db, roomsTable, roomMembersTable, usersTable, messagesTable, messageReactionsTable } from "@workspace/db";
import { eq, and, count, desc, max, inArray } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { CreateRoomBody, JoinRoomBody, JoinRoomByCodeBody } from "@workspace/api-zod";
import { randomBytes } from "node:crypto";
import { getPresenceSnapshot, broadcastToRoom } from "../lib/signaling";

const router: IRouter = Router();

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

async function getRoomWithCount(roomId: number) {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) return null;
  const [{ value }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(eq(roomMembersTable.roomId, roomId));
  return { ...room, memberCount: Number(value) };
}

type ReactionGroup = { emoji: string; count: number; userIds: number[] };

function groupReactions(rows: { messageId: number; userId: number; emoji: string }[]): Map<number, ReactionGroup[]> {
  const map = new Map<number, ReactionGroup[]>();
  for (const r of rows) {
    if (!map.has(r.messageId)) map.set(r.messageId, []);
    const groups = map.get(r.messageId)!;
    const existing = groups.find((g) => g.emoji === r.emoji);
    if (existing) {
      existing.count++;
      existing.userIds.push(r.userId);
    } else {
      groups.push({ emoji: r.emoji, count: 1, userIds: [r.userId] });
    }
  }
  return map;
}

router.get("/rooms", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const memberships = await db
    .select({ roomId: roomMembersTable.roomId })
    .from(roomMembersTable)
    .where(eq(roomMembersTable.userId, authReq.userId!));

  const roomIds = memberships.map((m) => m.roomId);
  if (roomIds.length === 0) { res.json([]); return; }

  const [rooms, memberCounts, lastMessages] = await Promise.all([
    db.select().from(roomsTable).where(inArray(roomsTable.id, roomIds)),
    db
      .select({ roomId: roomMembersTable.roomId, value: count() })
      .from(roomMembersTable)
      .where(inArray(roomMembersTable.roomId, roomIds))
      .groupBy(roomMembersTable.roomId),
    db
      .select({ roomId: messagesTable.roomId, lastMessageAt: max(messagesTable.createdAt) })
      .from(messagesTable)
      .where(inArray(messagesTable.roomId, roomIds))
      .groupBy(messagesTable.roomId),
  ]);

  const memberCountMap = new Map(memberCounts.map((r) => [r.roomId, Number(r.value)]));
  const lastMessageMap = new Map(lastMessages.map((r) => [r.roomId, r.lastMessageAt ?? null]));

  res.json(rooms.map((room) => ({
    ...room,
    memberCount: memberCountMap.get(room.id) ?? 0,
    lastMessageAt: lastMessageMap.get(room.id) ?? null,
  })));
});

router.post("/rooms", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const inviteCode = generateInviteCode();
  const [room] = await db
    .insert(roomsTable)
    .values({ name: parsed.data.name, inviteCode, createdBy: authReq.userId! })
    .returning();

  await db.insert(roomMembersTable).values({ roomId: room.id, userId: authReq.userId! });

  res.status(201).json({ ...room, memberCount: 1 });
});

router.get("/rooms/:roomId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));

  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const room = await getRoomWithCount(roomId);
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  res.json(room);
});

router.post("/rooms/:roomId/join", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const parsed = JoinRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.inviteCode !== parsed.data.inviteCode) { res.status(403).json({ error: "Invalid invite code" }); return; }

  const [existing] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));

  if (!existing) {
    await db.insert(roomMembersTable).values({ roomId, userId: authReq.userId! });
  }

  const result = await getRoomWithCount(roomId);
  res.json(result);
});

router.post("/rooms/join-by-code", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const parsed = JoinRoomByCodeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.inviteCode, parsed.data.inviteCode));

  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  const [existing] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, room.id), eq(roomMembersTable.userId, authReq.userId!)));

  if (!existing) {
    await db.insert(roomMembersTable).values({ roomId: room.id, userId: authReq.userId! });
  }

  const result = await getRoomWithCount(room.id);
  res.json(result);
});

router.patch("/rooms/:roomId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const name = (req.body?.name as string)?.trim();
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }

  const [updated] = await db
    .update(roomsTable)
    .set({ name })
    .where(eq(roomsTable.id, roomId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Room not found" }); return; }

  const [{ value }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(eq(roomMembersTable.roomId, roomId));

  res.json({ ...updated, memberCount: Number(value) });
});

router.post("/rooms/:roomId/leave", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  await db
    .delete(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));

  res.status(204).end();
});

router.get("/rooms/:roomId/members", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({ id: usersTable.id, username: usersTable.username, createdAt: usersTable.createdAt })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(eq(roomMembersTable.roomId, roomId));

  res.json(members);
});

router.get("/rooms/:roomId/presence", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(eq(roomMembersTable.roomId, roomId));

  const onlineIds = new Set(getPresenceSnapshot(roomId).map((p) => p.userId));
  const livePresence = getPresenceSnapshot(roomId);
  const liveMap = new Map(livePresence.map((p) => [p.userId, p]));

  const entries = members.map((m) => ({
    userId: m.id,
    username: m.username,
    online: onlineIds.has(m.id),
    speaking: liveMap.get(m.id)?.speaking ?? false,
    streaming: liveMap.get(m.id)?.streaming ?? false,
  }));

  res.json(entries);
});

router.get("/rooms/:roomId/messages", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const messages = await db
    .select({
      id: messagesTable.id,
      roomId: messagesTable.roomId,
      userId: messagesTable.userId,
      username: usersTable.username,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
    .where(eq(messagesTable.roomId, roomId))
    .orderBy(desc(messagesTable.createdAt))
    .limit(50);

  const msgIds = messages.map((m) => m.id);
  const reactionRows = msgIds.length > 0
    ? await db
        .select({ messageId: messageReactionsTable.messageId, userId: messageReactionsTable.userId, emoji: messageReactionsTable.emoji })
        .from(messageReactionsTable)
        .where(inArray(messageReactionsTable.messageId, msgIds))
    : [];

  const reactionsMap = groupReactions(reactionRows);

  res.json(messages.reverse().map((m) => ({ ...m, reactions: reactionsMap.get(m.id) ?? [] })));
});

router.post("/rooms/:roomId/messages", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const content = (req.body?.content as string)?.trim();
  if (!content) { res.status(400).json({ error: "Content is required" }); return; }

  const [saved] = await db
    .insert(messagesTable)
    .values({ roomId, userId: authReq.userId!, content })
    .returning();

  res.status(201).json({
    id: saved.id,
    roomId: saved.roomId,
    userId: saved.userId,
    username: authReq.username!,
    content: saved.content,
    createdAt: saved.createdAt,
    reactions: [],
  });
});

router.post("/rooms/:roomId/messages/:messageId/reactions", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const rawRoom = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const rawMsg = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;
  const roomId = parseInt(rawRoom, 10);
  const messageId = parseInt(rawMsg, 10);
  if (isNaN(roomId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const emoji = (req.body?.emoji as string)?.trim();
  if (!emoji) { res.status(400).json({ error: "emoji is required" }); return; }

  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, roomId)));
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }

  const [existing] = await db
    .select()
    .from(messageReactionsTable)
    .where(
      and(
        eq(messageReactionsTable.messageId, messageId),
        eq(messageReactionsTable.userId, authReq.userId!),
        eq(messageReactionsTable.emoji, emoji),
      )
    );

  if (existing) {
    await db
      .delete(messageReactionsTable)
      .where(eq(messageReactionsTable.id, existing.id));
  } else {
    await db
      .insert(messageReactionsTable)
      .values({ messageId, userId: authReq.userId!, emoji });
  }

  const reactionRows = await db
    .select({ messageId: messageReactionsTable.messageId, userId: messageReactionsTable.userId, emoji: messageReactionsTable.emoji })
    .from(messageReactionsTable)
    .where(eq(messageReactionsTable.messageId, messageId));

  const reactions = groupReactions(reactionRows).get(messageId) ?? [];

  broadcastToRoom(roomId, { type: "reaction_update", messageId, reactions });

  res.json(reactions);
});

export default router;
