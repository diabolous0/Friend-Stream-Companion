import {
  db,
  roomsTable,
  roomMembersTable,
  messagesTable,
  messageReactionsTable,
  channelsTable,
  roomBansTable,
  botsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, lt, inArray, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Delete a room and all of its dependent rows. Children are removed before the
 * room itself so the work is safe regardless of whether the underlying database
 * enforces foreign keys (Postgres always; SQLite only when pragma is on).
 */
export async function deleteRoomCascade(roomId: number): Promise<void> {
  const guestRows = await db
    .select({ userId: roomMembersTable.userId, username: usersTable.username })
    .from(roomMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, roomMembersTable.userId))
    .where(eq(roomMembersTable.roomId, roomId));
  const guestUserIds = guestRows
    .filter((row) => row.username.startsWith("__guest_"))
    .map((row) => row.userId);
  const msgRows = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(eq(messagesTable.roomId, roomId));
  const messageIds = msgRows.map((m) => m.id);

  if (messageIds.length > 0) {
    await db
      .delete(messageReactionsTable)
      .where(inArray(messageReactionsTable.messageId, messageIds));
  }
  await db.delete(messagesTable).where(eq(messagesTable.roomId, roomId));
  await db.delete(botsTable).where(eq(botsTable.roomId, roomId));
  await db.delete(roomBansTable).where(eq(roomBansTable.roomId, roomId));
  await db.delete(channelsTable).where(eq(channelsTable.roomId, roomId));
  await db.delete(roomMembersTable).where(eq(roomMembersTable.roomId, roomId));
  await db.delete(roomsTable).where(eq(roomsTable.id, roomId));
  if (guestUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, guestUserIds));
  }
}

/** Find and remove ephemeral rooms whose expiry has passed. */
export async function runCleanupOnce(): Promise<number> {
  const candidates = await db
    .select({ id: roomsTable.id })
    .from(roomsTable)
    .where(
      and(
        eq(roomsTable.ephemeral, true),
        isNotNull(roomsTable.expiresAt),
        lt(roomsTable.expiresAt, new Date())
      )
    );

  let deleted = 0;
  for (const room of candidates) {
    // Re-check expiry immediately before cascading: a message may have arrived
    // since the scan and extended the room's lifetime. SQLite has no row locks,
    // so this re-read narrows (not fully eliminates) the race without relying on
    // dialect-specific SELECT ... FOR UPDATE.
    const [current] = await db
      .select({ expiresAt: roomsTable.expiresAt, ephemeral: roomsTable.ephemeral })
      .from(roomsTable)
      .where(eq(roomsTable.id, room.id));
    if (!current || !current.ephemeral || !current.expiresAt) continue;
    if (current.expiresAt.getTime() >= Date.now()) continue;

    await deleteRoomCascade(room.id);
    deleted++;
  }

  if (deleted > 0) {
    logger.info({ count: deleted }, "Cleaned up expired ephemeral rooms");
  }
  return deleted;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the periodic cleanup job. Runs once shortly after boot and then on a
 * fixed interval. The timer is unref'd so it never keeps the process alive.
 */
export function startCleanupJob(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;

  const tick = () => {
    runCleanupOnce().catch((err) => logger.error({ err }, "Cleanup job failed"));
  };

  // Kick off shortly after boot, then on the interval.
  setTimeout(tick, 10_000).unref();
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
