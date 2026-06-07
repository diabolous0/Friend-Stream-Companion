import { Router, type IRouter } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { db, usersTable, serverInvitesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { config } from "../lib/config";
import {
  requireAuth,
  requireAdmin,
  type AuthenticatedRequest,
} from "../middlewares/auth";
import { ClaimAdminBody, CreateInviteBody } from "@workspace/api-zod";

const router: IRouter = Router();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

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
    isAdmin: user.isAdmin,
    createdAt: user.createdAt,
  };
}

// Become admin by presenting the server's configured admin password.
router.post("/admin/claim", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const parsed = ClaimAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (!config.adminPassword) {
    res.status(403).json({ error: "Admin access is not configured on this server" });
    return;
  }
  if (!safeEqual(parsed.data.adminPassword, config.adminPassword)) {
    res.status(403).json({ error: "Incorrect admin password" });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ isAdmin: true })
    .where(eq(usersTable.id, authReq.userId!))
    .returning();
  res.json(publicUser(user));
});

// Server configuration summary (admin only).
router.get("/admin/config", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable);
  res.json({
    serverName: config.serverName,
    registration: config.registration,
    maxUsers: config.maxUsers,
    userCount: Number(count),
  });
});

// List invite keys (admin only).
router.get("/admin/invites", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const invites = await db
    .select()
    .from(serverInvitesTable)
    .orderBy(desc(serverInvitesTable.createdAt));
  res.json(invites);
});

// Create an invite key (admin only).
router.post("/admin/invites", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const key = randomBytes(9).toString("base64url");
  const [invite] = await db
    .insert(serverInvitesTable)
    .values({
      key,
      createdBy: authReq.userId!,
      maxUses: parsed.data.maxUses ?? null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    })
    .returning();
  res.status(201).json(invite);
});

// Revoke an invite key (admin only).
router.delete("/admin/invites/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [deleted] = await db
    .delete(serverInvitesTable)
    .where(eq(serverInvitesTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

export default router;
