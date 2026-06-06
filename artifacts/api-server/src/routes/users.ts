import { Router, type IRouter } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { db, usersTable } from "@workspace/db";
import { UpdateMeBody } from "@workspace/api-zod";
import { eq } from "drizzle-orm";
import { refreshUserProfile } from "../lib/signaling";

const router: IRouter = Router();

function publicUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    steamUrl: user.steamUrl,
    discordUrl: user.discordUrl,
    avatarUrl: user.avatarUrl,
    nameColor: user.nameColor,
    avatarStyle: user.avatarStyle,
    createdAt: user.createdAt,
  };
}

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authReq.userId!));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

router.patch("/users/me", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid profile data" });
    return;
  }

  const empty = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim();

  const updates: Partial<typeof usersTable.$inferInsert> = {
    displayName: empty(parsed.data.displayName),
    email: empty(parsed.data.email),
    steamUrl: empty(parsed.data.steamUrl),
    discordUrl: empty(parsed.data.discordUrl),
    avatarUrl: empty(parsed.data.avatarUrl),
    nameColor: empty(parsed.data.nameColor),
    avatarStyle: empty(parsed.data.avatarStyle),
  };
  for (const key of Object.keys(updates) as (keyof typeof updates)[]) {
    if (updates[key] === undefined) delete updates[key];
  }

  if (Object.keys(updates).length === 0) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authReq.userId!));
    if (!user) { res.status(401).json({ error: "User not found" }); return; }
    res.json(publicUser(user));
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, authReq.userId!))
    .returning();
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  refreshUserProfile(user.id, { displayName: user.displayName, avatarUrl: user.avatarUrl, nameColor: user.nameColor, avatarStyle: user.avatarStyle });
  res.json(publicUser(user));
});

export default router;
