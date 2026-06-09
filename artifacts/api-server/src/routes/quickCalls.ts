import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, count, eq } from "drizzle-orm";
import { db, channelsTable, roomMembersTable, roomsTable, usersTable } from "@workspace/db";
import { signGuestToken } from "../middlewares/auth";

const router: IRouter = Router();
const QUICK_CALL_TTL_MS = 4 * 60 * 60 * 1000;
const QUICK_CALL_MAX_MEMBERS = 8;
const QUICK_CALL_REQUESTS_PER_HOUR = 30;
const QUICK_CALL_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const requestWindows = new Map<string, { startedAt: number; count: number }>();

const GuestName = z.string().trim().min(1).max(32);
const CreateQuickCallBody = z.object({ displayName: GuestName });
const JoinQuickCallBody = z.object({
  displayName: GuestName,
  inviteCode: z.string().trim().min(4).max(16),
});

function guestUsername(): string {
  return `__guest_${randomBytes(8).toString("hex")}`;
}

function inviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function allowQuickCallRequest(ip: string): boolean {
  const now = Date.now();
  if (requestWindows.size > 1_000) {
    for (const [key, window] of requestWindows) {
      if (now - window.startedAt >= QUICK_CALL_REQUEST_WINDOW_MS) requestWindows.delete(key);
    }
  }
  const current = requestWindows.get(ip);
  if (!current || now - current.startedAt >= QUICK_CALL_REQUEST_WINDOW_MS) {
    requestWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= QUICK_CALL_REQUESTS_PER_HOUR;
}

async function createGuest(displayName: string) {
  const [guest] = await db
    .insert(usersTable)
    .values({
      username: guestUsername(),
      displayName,
      passwordHash: `guest:${randomBytes(32).toString("hex")}`,
    })
    .returning();
  return guest;
}

async function quickCallResponse(roomId: number, userId: number) {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  const [guest] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!room || !guest) throw new Error("Quick Call session could not be loaded");
  const [{ value }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.status, "active")));
  const { passwordHash: _passwordHash, ...publicRoom } = room;
  return {
    token: signGuestToken(userId, roomId),
    room: { ...publicRoom, memberCount: Number(value), hasPassword: false, pending: false },
    user: {
      id: guest.id,
      username: guest.username,
      displayName: guest.displayName,
      isAdmin: false,
      createdAt: guest.createdAt,
    },
  };
}

router.post("/quick-calls", async (req, res): Promise<void> => {
  if (!allowQuickCallRequest(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many Quick Call requests. Try again later." });
    return;
  }
  const parsed = CreateQuickCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a display name between 1 and 32 characters" });
    return;
  }

  const guest = await createGuest(parsed.data.displayName);
  const now = new Date();
  const [room] = await db
    .insert(roomsTable)
    .values({
      name: `${parsed.data.displayName}'s Quick Call`,
      inviteCode: inviteCode(),
      createdBy: guest.id,
      isPrivate: false,
      ephemeral: true,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + QUICK_CALL_TTL_MS),
    })
    .returning();
  await db.insert(roomMembersTable).values({
    roomId: room.id,
    userId: guest.id,
    status: "active",
    role: "owner",
  });
  await db.insert(channelsTable).values({
    roomId: room.id,
    name: "call",
    type: "voice",
    position: 0,
  });

  res.status(201).json(await quickCallResponse(room.id, guest.id));
});

router.post("/quick-calls/join", async (req, res): Promise<void> => {
  if (!allowQuickCallRequest(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many Quick Call requests. Try again later." });
    return;
  }
  const parsed = JoinQuickCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a display name and valid invite code" });
    return;
  }
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.inviteCode, parsed.data.inviteCode.toUpperCase()));
  const [creator] = room
    ? await db.select({ username: usersTable.username }).from(usersTable).where(eq(usersTable.id, room.createdBy))
    : [];
  if (
    !room ||
    !room.ephemeral ||
    !creator?.username.startsWith("__guest_") ||
    (room.expiresAt && room.expiresAt.getTime() < Date.now())
  ) {
    res.status(404).json({ error: "Quick Call not found or expired" });
    return;
  }
  const [{ value: memberCount }] = await db
    .select({ value: count() })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, room.id), eq(roomMembersTable.status, "active")));
  if (Number(memberCount) >= QUICK_CALL_MAX_MEMBERS) {
    res.status(403).json({ error: "This Quick Call is full" });
    return;
  }

  const guest = await createGuest(parsed.data.displayName);
  await db.insert(roomMembersTable).values({
    roomId: room.id,
    userId: guest.id,
    status: "active",
    role: "member",
  });
  await db
    .update(roomsTable)
    .set({
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + QUICK_CALL_TTL_MS),
    })
    .where(eq(roomsTable.id, room.id));

  res.json(await quickCallResponse(room.id, guest.id));
});

export default router;
