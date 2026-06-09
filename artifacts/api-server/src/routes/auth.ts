import { Router, type IRouter } from "express";
import { db, usersTable, serverInvitesTable } from "@workspace/db";
import { eq, sql, and, or, isNull, lt, gt, notLike } from "drizzle-orm";
import {
  signToken,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "../middlewares/auth";
import { getServerSettings } from "../lib/serverSettings";
import { config } from "../lib/config";
import { RegisterBody, LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

function authUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password, inviteKey } = parsed.data;

  const settings = await getServerSettings();

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(notLike(usersTable.username, "__guest_%"));
  const isOwnerBootstrap = Number(count) === 0 && Boolean(config.adminPassword);
  if (settings.registration === "closed" && !isOwnerBootstrap) {
    res.status(403).json({ error: "Registration is closed on this server" });
    return;
  }
  if (Number(count) >= settings.maxUsers) {
    res.status(403).json({ error: "This server is full" });
    return;
  }

  if (settings.registration === "invite" && !isOwnerBootstrap) {
    if (!inviteKey) {
      res.status(403).json({ error: "An invite key is required to register" });
      return;
    }
    // Atomically consume one use of a valid, unexpired, unexhausted invite.
    const [consumed] = await db
      .update(serverInvitesTable)
      .set({ uses: sql`${serverInvitesTable.uses} + 1` })
      .where(
        and(
          eq(serverInvitesTable.key, inviteKey),
          or(
            isNull(serverInvitesTable.maxUses),
            lt(serverInvitesTable.uses, serverInvitesTable.maxUses)
          ),
          or(
            isNull(serverInvitesTable.expiresAt),
            gt(serverInvitesTable.expiresAt, new Date())
          )
        )
      )
      .returning();
    if (!consumed) {
      res.status(403).json({ error: "Invalid or expired invite key" });
      return;
    }
  }

  const passwordHash = hashPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({ username, passwordHash })
    .returning();

  const token = signToken(user.id);
  res.status(201).json({ token, user: authUser(user) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { username, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (!verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (passwordHashNeedsUpgrade(user.passwordHash)) {
    await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(password) })
      .where(eq(usersTable.id, user.id));
  }

  const token = signToken(user.id);
  res.json({ token, user: authUser(user) });
});

export default router;
