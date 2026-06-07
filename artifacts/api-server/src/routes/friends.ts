import { Router, type IRouter } from "express";
import { db, usersTable, friendshipsTable, blocksTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { SendFriendRequestBody } from "@workspace/api-zod";

const router: IRouter = Router();

const PUBLIC_USER_COLUMNS = {
  id: usersTable.id,
  username: usersTable.username,
  displayName: usersTable.displayName,
  avatarUrl: usersTable.avatarUrl,
  nameColor: usersTable.nameColor,
  avatarStyle: usersTable.avatarStyle,
  createdAt: usersTable.createdAt,
};

function parseIdParam(value: string | string[]): number {
  return parseInt(Array.isArray(value) ? value[0] : value, 10);
}

async function isBlockedEitherWay(a: number, b: number): Promise<boolean> {
  const [row] = await db
    .select({ id: blocksTable.id })
    .from(blocksTable)
    .where(or(
      and(eq(blocksTable.blockerId, a), eq(blocksTable.blockedId, b)),
      and(eq(blocksTable.blockerId, b), eq(blocksTable.blockedId, a)),
    ));
  return !!row;
}

// List accepted friends.
router.get("/friends", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const rows = await db
    .select({ ...PUBLIC_USER_COLUMNS, requesterId: friendshipsTable.requesterId, addresseeId: friendshipsTable.addresseeId })
    .from(friendshipsTable)
    .innerJoin(usersTable, or(
      and(eq(friendshipsTable.requesterId, me), eq(usersTable.id, friendshipsTable.addresseeId)),
      and(eq(friendshipsTable.addresseeId, me), eq(usersTable.id, friendshipsTable.requesterId)),
    ))
    .where(eq(friendshipsTable.status, "accepted"));
  res.json(rows.map(({ requesterId: _r, addresseeId: _a, ...u }) => u));
});

// List pending incoming + outgoing requests.
router.get("/friends/requests", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;

  const incoming = await db
    .select({ id: friendshipsTable.id, createdAt: friendshipsTable.createdAt, user: PUBLIC_USER_COLUMNS })
    .from(friendshipsTable)
    .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.requesterId))
    .where(and(eq(friendshipsTable.addresseeId, me), eq(friendshipsTable.status, "pending")));

  const outgoing = await db
    .select({ id: friendshipsTable.id, createdAt: friendshipsTable.createdAt, user: PUBLIC_USER_COLUMNS })
    .from(friendshipsTable)
    .innerJoin(usersTable, eq(usersTable.id, friendshipsTable.addresseeId))
    .where(and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.status, "pending")));

  res.json({ incoming, outgoing });
});

// Send a friend request by username.
router.post("/friends/requests", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const parsed = SendFriendRequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const username = parsed.data.username.trim();
  if (!username) { res.status(400).json({ error: "Username is required" }); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.isBot) { res.status(400).json({ error: "Cannot friend a bot" }); return; }
  if (target.id === me) { res.status(400).json({ error: "You cannot friend yourself" }); return; }
  if (await isBlockedEitherWay(me, target.id)) { res.status(400).json({ error: "Cannot send a request to this user" }); return; }

  // Any existing friendship in either direction?
  const [existing] = await db
    .select()
    .from(friendshipsTable)
    .where(or(
      and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.addresseeId, target.id)),
      and(eq(friendshipsTable.requesterId, target.id), eq(friendshipsTable.addresseeId, me)),
    ));

  if (existing) {
    if (existing.status === "accepted") { res.status(409).json({ error: "Already friends" }); return; }
    // They already requested me → accept it instead of creating a duplicate.
    if (existing.addresseeId === me) {
      await db.update(friendshipsTable).set({ status: "accepted" }).where(eq(friendshipsTable.id, existing.id));
      res.status(201).json({ id: existing.id, user: toPublic(target), createdAt: existing.createdAt });
      return;
    }
    res.status(409).json({ error: "Request already sent" });
    return;
  }

  const [created] = await db
    .insert(friendshipsTable)
    .values({ requesterId: me, addresseeId: target.id, status: "pending" })
    .returning();
  res.status(201).json({ id: created.id, user: toPublic(target), createdAt: created.createdAt });
});

router.post("/friends/requests/:id/accept", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const id = parseIdParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select().from(friendshipsTable).where(eq(friendshipsTable.id, id));
  if (!row || row.addresseeId !== me || row.status !== "pending") { res.status(404).json({ error: "Request not found" }); return; }

  await db.update(friendshipsTable).set({ status: "accepted" }).where(eq(friendshipsTable.id, id));
  res.status(204).end();
});

router.post("/friends/requests/:id/decline", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const id = parseIdParam(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select().from(friendshipsTable).where(eq(friendshipsTable.id, id));
  if (!row || row.addresseeId !== me || row.status !== "pending") { res.status(404).json({ error: "Request not found" }); return; }

  await db.delete(friendshipsTable).where(eq(friendshipsTable.id, id));
  res.status(204).end();
});

// Remove a friend or cancel a sent request (either direction).
router.delete("/friends/:userId", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const userId = parseIdParam(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  await db.delete(friendshipsTable).where(or(
    and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.addresseeId, userId)),
    and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.addresseeId, me)),
  ));
  res.status(204).end();
});

type TargetUser = typeof usersTable.$inferSelect;
function toPublic(u: TargetUser) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    nameColor: u.nameColor,
    avatarStyle: u.avatarStyle,
    createdAt: u.createdAt,
  };
}

export default router;
