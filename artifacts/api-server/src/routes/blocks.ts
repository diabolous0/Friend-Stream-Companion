import { Router, type IRouter } from "express";
import { db, usersTable, blocksTable, friendshipsTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { BlockUserBody } from "@workspace/api-zod";

const router: IRouter = Router();

function parseIdParam(value: string | string[]): number {
  return parseInt(Array.isArray(value) ? value[0] : value, 10);
}

// List users I have blocked.
router.get("/blocks", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      nameColor: usersTable.nameColor,
      avatarStyle: usersTable.avatarStyle,
      createdAt: usersTable.createdAt,
    })
    .from(blocksTable)
    .innerJoin(usersTable, eq(usersTable.id, blocksTable.blockedId))
    .where(eq(blocksTable.blockerId, me));
  res.json(rows);
});

// Block a user (also tears down any friendship/request between us).
router.post("/blocks", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const parsed = BlockUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = parsed.data.userId;
  if (userId === me) { res.status(400).json({ error: "You cannot block yourself" }); return; }

  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  await db.insert(blocksTable).values({ blockerId: me, blockedId: userId }).onConflictDoNothing();
  await db.delete(friendshipsTable).where(or(
    and(eq(friendshipsTable.requesterId, me), eq(friendshipsTable.addresseeId, userId)),
    and(eq(friendshipsTable.requesterId, userId), eq(friendshipsTable.addresseeId, me)),
  ));
  res.status(204).end();
});

router.delete("/blocks/:userId", requireAuth, async (req, res): Promise<void> => {
  const me = (req as AuthenticatedRequest).userId!;
  const userId = parseIdParam(req.params.userId);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  await db.delete(blocksTable).where(and(eq(blocksTable.blockerId, me), eq(blocksTable.blockedId, userId)));
  res.status(204).end();
});

export default router;
