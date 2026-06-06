import { Router, type IRouter } from "express";
import { db, roomsTable, roomMembersTable, usersTable, messagesTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { CreateRoomBody, JoinRoomBody, JoinRoomByCodeBody } from "@workspace/api-zod";
import { randomBytes } from "node:crypto";
import { getPresenceSnapshot } from "../lib/signaling";

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

router.get("/rooms", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const memberships = await db
    .select({ roomId: roomMembersTable.roomId })
    .from(roomMembersTable)
    .where(eq(roomMembersTable.userId, authReq.userId!));

  const rooms = await Promise.all(memberships.map((m) => getRoomWithCount(m.roomId)));
  res.json(rooms.filter(Boolean));
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

  res.json(messages.reverse());
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
  });
});

export default router;
