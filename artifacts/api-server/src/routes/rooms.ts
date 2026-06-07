import { Router, type IRouter } from "express";
import { db, roomsTable, roomMembersTable, usersTable, messagesTable, messageReactionsTable, channelsTable, roomBansTable, roleAtLeast } from "@workspace/db";
import { eq, and, count, desc, max, inArray, notInArray, isNull, or, lt, ilike } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { CreateRoomBody, JoinRoomBody, JoinRoomByCodeBody, UpdateRoomBody, SendMessageBody } from "@workspace/api-zod";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getPresenceSnapshot, broadcastToRoom, broadcastChannel, notifyUser, getVoicePresenceForRooms, evictUserFromRoom, revalidateMemberChannelAccess } from "../lib/signaling";

const router: IRouter = Router();

function generateInviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return orig.length === test.length && timingSafeEqual(orig, test);
}

// Strip the secret password hash from any room object before sending to clients,
// exposing only a boolean `hasPassword` flag.
function publicRoom<T extends { passwordHash?: string | null }>(room: T) {
  const { passwordHash, ...rest } = room;
  return { ...rest, hasPassword: !!passwordHash };
}

async function getActiveMembership(roomId: number, userId: number) {
  const [membership] = await db
    .select()
    .from(roomMembersTable)
    .where(and(
      eq(roomMembersTable.roomId, roomId),
      eq(roomMembersTable.userId, userId),
      eq(roomMembersTable.status, "active"),
    ));
  return membership ?? null;
}

function isStaffRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "mod";
}

async function isBanned(roomId: number, userId: number): Promise<boolean> {
  const [ban] = await db
    .select({ id: roomBansTable.id })
    .from(roomBansTable)
    .where(and(eq(roomBansTable.roomId, roomId), eq(roomBansTable.userId, userId)));
  return !!ban;
}

// A member cannot read/interact with messages in private channels (staff-only) or
// channels whose minViewRole is above their role. minViewRole is a true threshold
// that applies to EVERYONE (including mods); only isPrivate has a staff bypass.
async function canAccessMessageChannel(channelId: number | null, role: string | null | undefined): Promise<boolean> {
  if (channelId == null) return true;
  const [ch] = await db
    .select({ isPrivate: channelsTable.isPrivate, minViewRole: channelsTable.minViewRole })
    .from(channelsTable)
    .where(eq(channelsTable.id, channelId));
  if (!ch) return true;
  if (ch.isPrivate && !isStaffRole(role)) return false;
  return roleAtLeast(role, ch.minViewRole);
}

// Channel ids a member may NOT view (private-and-not-staff, or minViewRole above their role).
// Used to filter cross-channel reads (list/search/pins) when no channel filter is given.
// minViewRole is enforced for everyone, so even staff are filtered from owner-only channels.
async function getHiddenChannelIds(roomId: number, role: string | null | undefined): Promise<number[]> {
  const staff = isStaffRole(role);
  const chans = await db
    .select({ id: channelsTable.id, isPrivate: channelsTable.isPrivate, minViewRole: channelsTable.minViewRole })
    .from(channelsTable)
    .where(eq(channelsTable.roomId, roomId));
  return chans.filter((c) => (c.isPrivate && !staff) || !roleAtLeast(role, c.minViewRole)).map((c) => c.id);
}

function broadcastMessageEvent(roomId: number, channelId: number | null, message: object): void {
  if (channelId != null) broadcastChannel(channelId, message);
  else broadcastToRoom(roomId, message);
}

async function getRoomWithCount(roomId: number) {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) return null;
  const [{ value }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "active")));
  return publicRoom({ ...room, memberCount: Number(value) });
}

async function enrichMessages<T extends { id: number; replyToId: number | null }>(rows: T[]) {
  const msgIds = rows.map((m) => m.id);
  const reactionRows = msgIds.length > 0
    ? await db
        .select({ messageId: messageReactionsTable.messageId, userId: messageReactionsTable.userId, emoji: messageReactionsTable.emoji })
        .from(messageReactionsTable)
        .where(inArray(messageReactionsTable.messageId, msgIds))
    : [];
  const reactionsMap = groupReactions(reactionRows);

  const parentIds = Array.from(new Set(rows.map((m) => m.replyToId).filter((id): id is number => id != null)));
  const parents = parentIds.length > 0
    ? await db
        .select({ id: messagesTable.id, content: messagesTable.content, username: usersTable.username })
        .from(messagesTable)
        .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
        .where(inArray(messagesTable.id, parentIds))
    : [];
  const parentMap = new Map(parents.map((p) => [p.id, p]));

  return rows.map((m) => {
    const parent = m.replyToId != null ? parentMap.get(m.replyToId) : undefined;
    return {
      ...m,
      reactions: reactionsMap.get(m.id) ?? [],
      replyToContent: parent?.content ?? null,
      replyToUsername: parent?.username ?? null,
    };
  });
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
    .where(and(eq(roomMembersTable.userId, authReq.userId!), eq(roomMembersTable.status, "active")));

  const roomIds = memberships.map((m) => m.roomId);
  if (roomIds.length === 0) { res.json([]); return; }

  const [rooms, memberCounts, lastMessages] = await Promise.all([
    db.select().from(roomsTable).where(inArray(roomsTable.id, roomIds)),
    db
      .select({ roomId: roomMembersTable.roomId, value: count() })
      .from(roomMembersTable)
      .where(and(inArray(roomMembersTable.roomId, roomIds), eq(roomMembersTable.status, "active")))
      .groupBy(roomMembersTable.roomId),
    db
      .select({ roomId: messagesTable.roomId, lastMessageAt: max(messagesTable.createdAt) })
      .from(messagesTable)
      .where(inArray(messagesTable.roomId, roomIds))
      .groupBy(messagesTable.roomId),
  ]);

  const memberCountMap = new Map(memberCounts.map((r) => [r.roomId, Number(r.value)]));
  const lastMessageMap = new Map(lastMessages.map((r) => [r.roomId, r.lastMessageAt ?? null]));
  const voiceMap = getVoicePresenceForRooms(roomIds);

  res.json(rooms.map((room) => ({
    ...publicRoom({
      ...room,
      memberCount: memberCountMap.get(room.id) ?? 0,
      lastMessageAt: lastMessageMap.get(room.id) ?? null,
    }),
    voiceMembers: voiceMap.get(room.id) ?? [],
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
    .values({ name: parsed.data.name, inviteCode, createdBy: authReq.userId!, isPrivate: parsed.data.isPrivate ?? true })
    .returning();

  await db.insert(roomMembersTable).values({ roomId: room.id, userId: authReq.userId!, status: "active", role: "owner" });
  await db.insert(channelsTable).values({ roomId: room.id, name: "general", type: "text", position: 0 });

  res.status(201).json(publicRoom({ ...room, memberCount: 1 }));
});

router.get("/rooms/:roomId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
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
  if (await isBanned(roomId, authReq.userId!)) { res.status(403).json({ error: "You are banned from this room" }); return; }
  if (room.inviteCode !== parsed.data.inviteCode) { res.status(403).json({ error: "Invalid invite code" }); return; }
  if (room.inviteExpiresAt && new Date(room.inviteExpiresAt).getTime() < Date.now()) {
    res.status(403).json({ error: "Invite link has expired" });
    return;
  }

  const [existing] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, authReq.userId!)));

  const result = await getRoomWithCount(roomId);

  if (existing) {
    res.json({ ...result, pending: existing.status === "pending" });
    return;
  }

  if (room.passwordHash) {
    if (!parsed.data.password || !verifyPassword(parsed.data.password, room.passwordHash)) {
      res.status(403).json({ error: "Incorrect room password" });
      return;
    }
  }

  if (room.isPrivate) {
    await db.insert(roomMembersTable).values({ roomId, userId: authReq.userId!, status: "pending" }).onConflictDoNothing();
    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, authReq.userId!));
    broadcastToRoom(roomId, { type: "knock", roomId, user });
    res.json({ ...result, pending: true });
    return;
  }

  await db.insert(roomMembersTable).values({ roomId, userId: authReq.userId!, status: "active" }).onConflictDoNothing();
  res.json({ ...(await getRoomWithCount(roomId)), pending: false });
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
  if (await isBanned(room.id, authReq.userId!)) { res.status(403).json({ error: "You are banned from this room" }); return; }

  if (room.inviteExpiresAt && new Date(room.inviteExpiresAt).getTime() < Date.now()) {
    res.status(403).json({ error: "Invite link has expired" });
    return;
  }

  const [existing] = await db
    .select()
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, room.id), eq(roomMembersTable.userId, authReq.userId!)));

  const result = await getRoomWithCount(room.id);

  if (existing) {
    // Already a member (active or pending) — return current state.
    res.json({ ...result, pending: existing.status === "pending" });
    return;
  }

  if (room.passwordHash) {
    if (!parsed.data.password || !verifyPassword(parsed.data.password, room.passwordHash)) {
      res.status(403).json({ error: "Incorrect room password" });
      return;
    }
  }

  if (room.isPrivate) {
    // Knock-to-join: create a pending membership and notify active members.
    await db.insert(roomMembersTable).values({ roomId: room.id, userId: authReq.userId!, status: "pending" }).onConflictDoNothing();
    const [user] = await db
      .select({ id: usersTable.id, username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, authReq.userId!));
    broadcastToRoom(room.id, { type: "knock", roomId: room.id, user });
    res.json({ ...result, pending: true });
    return;
  }

  await db.insert(roomMembersTable).values({ roomId: room.id, userId: authReq.userId!, status: "active" }).onConflictDoNothing();
  res.json({ ...(await getRoomWithCount(room.id)), pending: false });
});

router.patch("/rooms/:roomId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const parsed = UpdateRoomBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  const isCreator = room.createdBy === authReq.userId!;
  const data = parsed.data;
  const updates: Partial<typeof roomsTable.$inferInsert> = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) { res.status(400).json({ error: "Name cannot be empty" }); return; }
    updates.name = name;
  }
  // Room theme/banner/notes editing is creator-only.
  if (data.themeColor !== undefined || data.themeSkin !== undefined || data.bannerUrl !== undefined || data.notes !== undefined) {
    if (!isCreator) { res.status(403).json({ error: "Only the room creator can change room settings" }); return; }
    if (data.themeColor !== undefined) updates.themeColor = data.themeColor;
    if (data.themeSkin !== undefined) {
      if (data.themeSkin !== null && !/^[a-z]{1,32}$/.test(data.themeSkin)) {
        res.status(400).json({ error: "Invalid room skin" }); return;
      }
      updates.themeSkin = data.themeSkin;
    }
    if (data.bannerUrl !== undefined) updates.bannerUrl = data.bannerUrl;
    if (data.notes !== undefined) updates.notes = data.notes;
  }

  // Privacy, invite expiry and code regeneration are creator-only.
  if (data.isPrivate !== undefined || data.inviteExpiresAt !== undefined || data.regenerateCode) {
    if (!isCreator) { res.status(403).json({ error: "Only the room creator can change invite settings" }); return; }
    if (data.isPrivate !== undefined) updates.isPrivate = data.isPrivate;
    if (data.inviteExpiresAt !== undefined) updates.inviteExpiresAt = data.inviteExpiresAt;
    if (data.regenerateCode) updates.inviteCode = generateInviteCode();
  }

  // Room password is creator-only; empty string or null clears it.
  if (data.password !== undefined) {
    if (!isCreator) { res.status(403).json({ error: "Only the room creator can change the password" }); return; }
    updates.passwordHash = data.password ? hashPassword(data.password) : null;
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const [updated] = await db
    .update(roomsTable)
    .set(updates)
    .where(eq(roomsTable.id, roomId))
    .returning();

  if (!updated) { res.status(404).json({ error: "Room not found" }); return; }

  const [{ value }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "active")));

  const result = publicRoom({ ...updated, memberCount: Number(value) });
  broadcastToRoom(roomId, { type: "room_updated", room: result });
  res.json(result);
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

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
      steamUrl: usersTable.steamUrl,
      discordUrl: usersTable.discordUrl,
      isBot: usersTable.isBot,
      createdAt: usersTable.createdAt,
      role: roomMembersTable.role,
    })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "active")));

  res.json(members);
});

router.get("/rooms/:roomId/presence", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const members = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
    })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "active")));

  const livePresence = getPresenceSnapshot(roomId);
  const liveMap = new Map(livePresence.map((p) => [p.userId, p]));
  const onlineIds = new Set(livePresence.map((p) => p.userId));

  const entries = members.map((m) => {
    const live = liveMap.get(m.id);
    return {
      userId: m.id,
      username: m.username,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      nameColor: m.nameColor,
      avatarStyle: m.avatarStyle,
      online: onlineIds.has(m.id),
      speaking: live?.speaking ?? false,
      streaming: live?.streaming ?? false,
      inVoice: live?.inVoice ?? false,
      channelId: live?.channelId ?? null,
      status: live?.status ?? "online",
      statusMessage: live?.statusMessage ?? null,
      activity: live?.activity ?? null,
    };
  });

  res.json(entries);
});

router.get("/rooms/:roomId/messages", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const beforeParam = req.query.before ? parseInt(req.query.before as string, 10) : undefined;
  const limitParam = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 100) : 50;
  const channelIdParam = req.query.channelId ? parseInt(req.query.channelId as string, 10) : undefined;
  const isStaff = isStaffRole(membership.role);

  const conditions = [eq(messagesTable.roomId, roomId)];
  if (beforeParam) conditions.push(lt(messagesTable.id, beforeParam));
  if (channelIdParam && !isNaN(channelIdParam)) {
    const [ch] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, channelIdParam), eq(channelsTable.roomId, roomId)));
    if (!ch) { res.status(404).json({ error: "Channel not found" }); return; }
    if (ch.isPrivate && !isStaff) { res.status(403).json({ error: "No access to this channel" }); return; }
    if (!roleAtLeast(membership.role, ch.minViewRole)) { res.status(403).json({ error: "No access to this channel" }); return; }
    conditions.push(eq(messagesTable.channelId, channelIdParam));
  } else {
    // Exclude messages from channels this member can't view (private or role-gated).
    const ids = await getHiddenChannelIds(roomId, membership.role);
    if (ids.length) {
      const cond = or(isNull(messagesTable.channelId), notInArray(messagesTable.channelId, ids));
      if (cond) conditions.push(cond);
    }
  }
  const whereClause = and(...conditions);

  const messages = await db
    .select({
      id: messagesTable.id,
      roomId: messagesTable.roomId,
      channelId: messagesTable.channelId,
      userId: messagesTable.userId,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
      isBot: usersTable.isBot,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      editedAt: messagesTable.editedAt,
      pinned: messagesTable.pinned,
      replyToId: messagesTable.replyToId,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
    .where(whereClause)
    .orderBy(desc(messagesTable.id))
    .limit(limitParam);

  const enriched = await enrichMessages(messages);
  res.json(enriched.reverse());
});

router.get("/rooms/:roomId/messages/search", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const q = (req.query.q as string | undefined)?.trim() ?? "";
  if (q.length < 2) { res.json([]); return; }
  const limitParam = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 100) : 40;
  const channelIdParam = req.query.channelId ? parseInt(req.query.channelId as string, 10) : undefined;
  const isStaff = isStaffRole(membership.role);

  // Escape LIKE wildcards so user input is treated literally.
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const conditions = [eq(messagesTable.roomId, roomId), ilike(messagesTable.content, `%${escaped}%`)];

  if (channelIdParam && !isNaN(channelIdParam)) {
    const [ch] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, channelIdParam), eq(channelsTable.roomId, roomId)));
    if (!ch) { res.status(404).json({ error: "Channel not found" }); return; }
    if (ch.isPrivate && !isStaff) { res.status(403).json({ error: "No access to this channel" }); return; }
    if (!roleAtLeast(membership.role, ch.minViewRole)) { res.status(403).json({ error: "No access to this channel" }); return; }
    conditions.push(eq(messagesTable.channelId, channelIdParam));
  } else {
    const ids = await getHiddenChannelIds(roomId, membership.role);
    if (ids.length) {
      const cond = or(isNull(messagesTable.channelId), notInArray(messagesTable.channelId, ids));
      if (cond) conditions.push(cond);
    }
  }

  const messages = await db
    .select({
      id: messagesTable.id,
      roomId: messagesTable.roomId,
      channelId: messagesTable.channelId,
      userId: messagesTable.userId,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
      isBot: usersTable.isBot,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      editedAt: messagesTable.editedAt,
      pinned: messagesTable.pinned,
      replyToId: messagesTable.replyToId,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(messagesTable.id))
    .limit(limitParam);

  const enriched = await enrichMessages(messages);
  res.json(enriched);
});

router.patch("/rooms/:roomId/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  if (isNaN(roomId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, roomId)));
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  if (!(await canAccessMessageChannel(message.channelId, membership.role))) { res.status(403).json({ error: "No access to this channel" }); return; }
  if (message.userId !== authReq.userId!) { res.status(403).json({ error: "Not your message" }); return; }

  const ageMs = Date.now() - new Date(message.createdAt).getTime();
  if (ageMs > 15 * 60 * 1000) { res.status(403).json({ error: "Edit window expired (15 min)" }); return; }

  const content = (req.body?.content as string)?.trim();
  if (!content) { res.status(400).json({ error: "Content is required" }); return; }

  const now = new Date();
  const [updated] = await db
    .update(messagesTable)
    .set({ content, editedAt: now })
    .where(eq(messagesTable.id, messageId))
    .returning();

  const [user] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, nameColor: usersTable.nameColor, avatarStyle: usersTable.avatarStyle, isBot: usersTable.isBot })
    .from(usersTable)
    .where(eq(usersTable.id, updated.userId));
  const [enriched] = await enrichMessages([updated]);

  const result = { ...enriched, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, nameColor: user.nameColor, avatarStyle: user.avatarStyle, isBot: user.isBot ?? false };
  broadcastMessageEvent(roomId, message.channelId, { type: "message_updated", message: result });
  res.json(result);
});

router.delete("/rooms/:roomId/messages/:messageId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  if (isNaN(roomId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, roomId)));
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  if (!(await canAccessMessageChannel(message.channelId, membership.role))) { res.status(403).json({ error: "No access to this channel" }); return; }
  if (message.userId !== authReq.userId!) { res.status(403).json({ error: "Not your message" }); return; }

  await db.delete(messagesTable).where(eq(messagesTable.id, messageId));
  broadcastMessageEvent(roomId, message.channelId, { type: "message_deleted", messageId });
  res.status(204).end();
});

router.post("/rooms/:roomId/messages", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const raw = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const roomId = parseInt(raw, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const content = parsed.data.content.trim();
  if (!content) { res.status(400).json({ error: "Content is required" }); return; }

  // Resolve and validate the target channel (if provided).
  let channelId: number | null = null;
  if (parsed.data.channelId != null) {
    const [channel] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, parsed.data.channelId), eq(channelsTable.roomId, roomId)));
    if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }
    const isStaff = membership.role === "owner" || membership.role === "mod";
    if (channel.isPrivate && !isStaff) { res.status(403).json({ error: "No access to this channel" }); return; }
    if (channel.type === "announcement" && !isStaff) { res.status(403).json({ error: "Only owner/mod can post in announcement channels" }); return; }
    if (!roleAtLeast(membership.role, channel.minViewRole)) { res.status(403).json({ error: "No access to this channel" }); return; }
    if (!roleAtLeast(membership.role, channel.minSendRole)) { res.status(403).json({ error: "You don't have permission to post in this channel" }); return; }
    if (channel.type === "voice") { res.status(400).json({ error: "Cannot post text to a voice channel" }); return; }
    channelId = channel.id;
  }

  // Validate reply target belongs to the same room AND the same channel.
  let replyToId: number | null = null;
  if (parsed.data.replyToId != null) {
    const [parent] = await db
      .select({ id: messagesTable.id, channelId: messagesTable.channelId })
      .from(messagesTable)
      .where(and(eq(messagesTable.id, parsed.data.replyToId), eq(messagesTable.roomId, roomId)));
    if (parent && (parent.channelId ?? null) === channelId) replyToId = parent.id;
  }

  const [saved] = await db
    .insert(messagesTable)
    .values({ roomId, channelId, userId: authReq.userId!, content, replyToId })
    .returning();

  const [user] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, nameColor: usersTable.nameColor, avatarStyle: usersTable.avatarStyle, isBot: usersTable.isBot })
    .from(usersTable)
    .where(eq(usersTable.id, authReq.userId!));
  const [enriched] = await enrichMessages([saved]);
  const result = { ...enriched, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, nameColor: user.nameColor, avatarStyle: user.avatarStyle, isBot: user.isBot ?? false };

  if (channelId != null) {
    broadcastChannel(channelId, { type: "new_message", message: result });
  } else {
    broadcastToRoom(roomId, { type: "new_message", message: result });
  }
  res.status(201).json(result);
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

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, roomId)));
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }
  if (!(await canAccessMessageChannel(message.channelId, membership.role))) { res.status(403).json({ error: "No access to this channel" }); return; }

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

  broadcastMessageEvent(roomId, message.channelId, { type: "reaction_update", messageId, reactions });

  res.json(reactions);
});

router.post("/rooms/:roomId/messages/:messageId/pin", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const messageId = parseInt(Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId, 10);
  if (isNaN(roomId) || isNaN(messageId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const [room] = await db.select({ createdBy: roomsTable.createdBy }).from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.createdBy !== authReq.userId!) { res.status(403).json({ error: "Only the room creator can pin messages" }); return; }

  const [message] = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, roomId)));
  if (!message) { res.status(404).json({ error: "Message not found" }); return; }

  const [updated] = await db
    .update(messagesTable)
    .set({ pinned: !message.pinned })
    .where(eq(messagesTable.id, messageId))
    .returning();

  const [user] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName, avatarUrl: usersTable.avatarUrl, nameColor: usersTable.nameColor, avatarStyle: usersTable.avatarStyle, isBot: usersTable.isBot })
    .from(usersTable)
    .where(eq(usersTable.id, updated.userId));
  const [enriched] = await enrichMessages([updated]);
  const result = { ...enriched, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl, nameColor: user.nameColor, avatarStyle: user.avatarStyle, isBot: user.isBot ?? false };

  broadcastMessageEvent(roomId, message.channelId, { type: "message_updated", message: result });
  res.json(result);
});

router.get("/rooms/:roomId/pins", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const pinConditions = [eq(messagesTable.roomId, roomId), eq(messagesTable.pinned, true)];
  {
    const ids = await getHiddenChannelIds(roomId, membership.role);
    if (ids.length) {
      const cond = or(isNull(messagesTable.channelId), notInArray(messagesTable.channelId, ids));
      if (cond) pinConditions.push(cond);
    }
  }

  const messages = await db
    .select({
      id: messagesTable.id,
      roomId: messagesTable.roomId,
      userId: messagesTable.userId,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
      isBot: usersTable.isBot,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      editedAt: messagesTable.editedAt,
      pinned: messagesTable.pinned,
      replyToId: messagesTable.replyToId,
    })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
    .where(and(...pinConditions))
    .orderBy(desc(messagesTable.id));

  const enriched = await enrichMessages(messages);
  res.json(enriched);
});

router.get("/rooms/:roomId/pending", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership || !isStaffRole(membership.role)) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  const pending = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      requestedAt: roomMembersTable.joinedAt,
    })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(roomMembersTable.userId, usersTable.id))
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "pending")));

  res.json(pending);
});

router.post("/rooms/:roomId/members/:userId/approve", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const targetUserId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(roomId) || isNaN(targetUserId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership || !isStaffRole(membership.role)) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  const [pending] = await db
    .select()
    .from(roomMembersTable)
    .where(and(
      eq(roomMembersTable.roomId, roomId),
      eq(roomMembersTable.userId, targetUserId),
      eq(roomMembersTable.status, "pending"),
    ));
  if (!pending) { res.status(404).json({ error: "No pending request for this user" }); return; }

  await db
    .update(roomMembersTable)
    .set({ status: "active" })
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId)));

  const room = await getRoomWithCount(roomId);
  notifyUser(targetUserId, { type: "knock_approved", roomId, room });
  broadcastToRoom(roomId, { type: "knock_resolved", roomId, userId: targetUserId });

  res.status(204).end();
});

// Resolve the acting member and the target room, enforcing that the actor is
// active staff (owner/mod). Returns null (and sends the response) on failure.
async function requireStaff(
  req: AuthenticatedRequest,
  res: import("express").Response,
): Promise<{ roomId: number; targetUserId: number; isCreator: boolean } | null> {
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const targetUserId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(roomId) || isNaN(targetUserId)) { res.status(400).json({ error: "Invalid ID" }); return null; }

  const membership = await getActiveMembership(roomId, req.userId!);
  if (!membership || !isStaffRole(membership.role)) { res.status(403).json({ error: "Insufficient permissions" }); return null; }

  const [room] = await db.select({ createdBy: roomsTable.createdBy }).from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) { res.status(404).json({ error: "Room not found" }); return null; }

  return { roomId, targetUserId, isCreator: room.createdBy === req.userId! };
}

router.patch("/rooms/:roomId/members/:userId/role", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  const targetUserId = parseInt(Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId, 10);
  if (isNaN(roomId) || isNaN(targetUserId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const role = (req.body as { role?: unknown })?.role;
  if (role !== "mod" && role !== "member") { res.status(400).json({ error: "Role must be mod or member" }); return; }

  const [room] = await db.select({ createdBy: roomsTable.createdBy }).from(roomsTable).where(eq(roomsTable.id, roomId));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.createdBy !== authReq.userId!) { res.status(403).json({ error: "Only the room owner can change roles" }); return; }
  if (targetUserId === room.createdBy) { res.status(403).json({ error: "Cannot change the owner's role" }); return; }

  const updated = await db
    .update(roomMembersTable)
    .set({ role })
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId), eq(roomMembersTable.status, "active")))
    .returning();
  if (!updated.length) { res.status(404).json({ error: "Member not found" }); return; }

  broadcastToRoom(roomId, { type: "role_updated", roomId, userId: targetUserId, role });
  // A lowered role may no longer satisfy some channels' minViewRole — evict stale WS sessions.
  await revalidateMemberChannelAccess(roomId, targetUserId);
  res.status(204).end();
});

router.post("/rooms/:roomId/members/:userId/deny", requireAuth, async (req, res): Promise<void> => {
  const ctx = await requireStaff(req as AuthenticatedRequest, res);
  if (!ctx) return;
  const { roomId, targetUserId } = ctx;

  const deleted = await db
    .delete(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId), eq(roomMembersTable.status, "pending")))
    .returning();
  if (!deleted.length) { res.status(404).json({ error: "No pending request for this user" }); return; }

  notifyUser(targetUserId, { type: "knock_denied", roomId });
  broadcastToRoom(roomId, { type: "knock_resolved", roomId, userId: targetUserId });
  res.status(204).end();
});

router.delete("/rooms/:roomId/members/:userId", requireAuth, async (req, res): Promise<void> => {
  const ctx = await requireStaff(req as AuthenticatedRequest, res);
  if (!ctx) return;
  const { roomId, targetUserId, isCreator } = ctx;

  if (targetUserId === (req as AuthenticatedRequest).userId!) { res.status(403).json({ error: "Cannot remove yourself; use leave" }); return; }

  const [target] = await db
    .select({ role: roomMembersTable.role })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId)));
  if (!target) { res.status(404).json({ error: "Member not found" }); return; }
  if (target.role === "owner") { res.status(403).json({ error: "Cannot remove the room owner" }); return; }
  if (target.role === "mod" && !isCreator) { res.status(403).json({ error: "Only the owner can remove a moderator" }); return; }

  await db.delete(roomMembersTable).where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId)));

  notifyUser(targetUserId, { type: "removed_from_room", roomId });
  evictUserFromRoom(roomId, targetUserId);
  broadcastToRoom(roomId, { type: "member_removed", roomId, userId: targetUserId });
  res.status(204).end();
});

router.post("/rooms/:roomId/members/:userId/ban", requireAuth, async (req, res): Promise<void> => {
  const ctx = await requireStaff(req as AuthenticatedRequest, res);
  if (!ctx) return;
  const { roomId, targetUserId, isCreator } = ctx;
  const actorId = (req as AuthenticatedRequest).userId!;

  if (targetUserId === actorId) { res.status(403).json({ error: "Cannot ban yourself" }); return; }

  const [target] = await db
    .select({ id: usersTable.id, role: roomMembersTable.role })
    .from(usersTable)
    .leftJoin(roomMembersTable, and(eq(roomMembersTable.userId, usersTable.id), eq(roomMembersTable.roomId, roomId)))
    .where(eq(usersTable.id, targetUserId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.role === "owner") { res.status(403).json({ error: "Cannot ban the room owner" }); return; }
  if (target.role === "mod" && !isCreator) { res.status(403).json({ error: "Only the owner can ban a moderator" }); return; }

  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason.slice(0, 280) : null;

  await db.delete(roomMembersTable).where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, targetUserId)));
  await db
    .insert(roomBansTable)
    .values({ roomId, userId: targetUserId, bannedBy: actorId, reason })
    .onConflictDoUpdate({ target: [roomBansTable.roomId, roomBansTable.userId], set: { bannedBy: actorId, reason } });

  notifyUser(targetUserId, { type: "banned_from_room", roomId });
  evictUserFromRoom(roomId, targetUserId);
  broadcastToRoom(roomId, { type: "member_removed", roomId, userId: targetUserId });
  res.status(204).end();
});

router.get("/rooms/:roomId/bans", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseInt(Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId, 10);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership || !isStaffRole(membership.role)) { res.status(403).json({ error: "Insufficient permissions" }); return; }

  const bans = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      reason: roomBansTable.reason,
      bannedAt: roomBansTable.createdAt,
    })
    .from(roomBansTable)
    .innerJoin(usersTable, eq(roomBansTable.userId, usersTable.id))
    .where(eq(roomBansTable.roomId, roomId))
    .orderBy(desc(roomBansTable.createdAt));

  res.json(bans);
});

router.delete("/rooms/:roomId/bans/:userId", requireAuth, async (req, res): Promise<void> => {
  const ctx = await requireStaff(req as AuthenticatedRequest, res);
  if (!ctx) return;
  const { roomId, targetUserId } = ctx;

  const deleted = await db
    .delete(roomBansTable)
    .where(and(eq(roomBansTable.roomId, roomId), eq(roomBansTable.userId, targetUserId)))
    .returning();
  if (!deleted.length) { res.status(404).json({ error: "Ban not found" }); return; }

  res.status(204).end();
});

export default router;
