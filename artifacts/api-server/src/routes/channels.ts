import { Router, type IRouter } from "express";
import { db, roomMembersTable, channelsTable, messagesTable, CHANNEL_TYPES, ROOM_ROLES, roleAtLeast } from "@workspace/db";
import { eq, and, max } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { CreateChannelBody, UpdateChannelBody } from "@workspace/api-zod";
import { broadcastToRoom, revalidateChannelAccess } from "../lib/signaling";

const router: IRouter = Router();

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

function parseIdParam(value: string | string[]): number {
  return parseInt(Array.isArray(value) ? value[0] : value, 10);
}

router.get("/rooms/:roomId/channels", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseIdParam(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }

  const channels = await db
    .select()
    .from(channelsTable)
    .where(eq(channelsTable.roomId, roomId))
    .orderBy(channelsTable.position, channelsTable.id);

  const staff = isStaffRole(membership.role);
  res.json(channels.filter((c) =>
    (staff || !c.isPrivate) && roleAtLeast(membership.role, c.minViewRole),
  ));
});

router.post("/rooms/:roomId/channels", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseIdParam(req.params.roomId);
  if (isNaN(roomId)) { res.status(400).json({ error: "Invalid room ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }
  if (!isStaffRole(membership.role)) { res.status(403).json({ error: "Only owner/mod can manage channels" }); return; }

  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const name = parsed.data.name.trim();
  if (!name) { res.status(400).json({ error: "Name cannot be empty" }); return; }
  const type = parsed.data.type ?? "text";
  if (!CHANNEL_TYPES.includes(type)) { res.status(400).json({ error: "Invalid channel type" }); return; }
  const minViewRole = parsed.data.minViewRole ?? "member";
  const minSendRole = parsed.data.minSendRole ?? "member";
  if (!ROOM_ROLES.includes(minViewRole) || !ROOM_ROLES.includes(minSendRole)) { res.status(400).json({ error: "Invalid role" }); return; }

  const [{ value }] = await db
    .select({ value: max(channelsTable.position) })
    .from(channelsTable)
    .where(eq(channelsTable.roomId, roomId));
  const position = (value ?? 0) + 1;

  const [channel] = await db
    .insert(channelsTable)
    .values({ roomId, name, type, isPrivate: parsed.data.isPrivate ?? false, minViewRole, minSendRole, position })
    .returning();

  broadcastToRoom(roomId, { type: "channels_updated", roomId });
  res.status(201).json(channel);
});

router.patch("/rooms/:roomId/channels/:channelId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseIdParam(req.params.roomId);
  const channelId = parseIdParam(req.params.channelId);
  if (isNaN(roomId) || isNaN(channelId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }
  if (!isStaffRole(membership.role)) { res.status(403).json({ error: "Only owner/mod can manage channels" }); return; }

  const parsed = UpdateChannelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.id, channelId), eq(channelsTable.roomId, roomId)));
  if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }

  const data = parsed.data;
  const updates: Partial<typeof channelsTable.$inferInsert> = {};
  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) { res.status(400).json({ error: "Name cannot be empty" }); return; }
    updates.name = name;
  }
  if (data.type !== undefined) {
    if (!CHANNEL_TYPES.includes(data.type)) { res.status(400).json({ error: "Invalid channel type" }); return; }
    updates.type = data.type;
  }
  if (data.isPrivate !== undefined) updates.isPrivate = data.isPrivate;
  if (data.position !== undefined) updates.position = data.position;
  if (data.minViewRole !== undefined) {
    if (!ROOM_ROLES.includes(data.minViewRole)) { res.status(400).json({ error: "Invalid role" }); return; }
    updates.minViewRole = data.minViewRole;
  }
  if (data.minSendRole !== undefined) {
    if (!ROOM_ROLES.includes(data.minSendRole)) { res.status(400).json({ error: "Invalid role" }); return; }
    updates.minSendRole = data.minSendRole;
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const [updated] = await db
    .update(channelsTable)
    .set(updates)
    .where(eq(channelsTable.id, channelId))
    .returning();

  broadcastToRoom(roomId, { type: "channels_updated", roomId });
  // Tightened minViewRole/isPrivate may revoke access for currently-joined clients — evict them.
  if (data.minViewRole !== undefined || data.isPrivate !== undefined) {
    await revalidateChannelAccess(channelId);
  }
  res.json(updated);
});

router.delete("/rooms/:roomId/channels/:channelId", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const roomId = parseIdParam(req.params.roomId);
  const channelId = parseIdParam(req.params.channelId);
  if (isNaN(roomId) || isNaN(channelId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const membership = await getActiveMembership(roomId, authReq.userId!);
  if (!membership) { res.status(403).json({ error: "Not a member" }); return; }
  if (!isStaffRole(membership.role)) { res.status(403).json({ error: "Only owner/mod can manage channels" }); return; }

  const [channel] = await db
    .select()
    .from(channelsTable)
    .where(and(eq(channelsTable.id, channelId), eq(channelsTable.roomId, roomId)));
  if (!channel) { res.status(404).json({ error: "Channel not found" }); return; }

  const allChannels = await db.select({ id: channelsTable.id }).from(channelsTable).where(eq(channelsTable.roomId, roomId));
  if (allChannels.length <= 1) { res.status(400).json({ error: "Cannot delete the last channel" }); return; }

  // Reassign this channel's messages to the room's first remaining channel so history isn't orphaned.
  const fallback = allChannels.find((c) => c.id !== channelId)!;
  await db.update(messagesTable).set({ channelId: fallback.id }).where(eq(messagesTable.channelId, channelId));
  await db.delete(channelsTable).where(eq(channelsTable.id, channelId));

  broadcastToRoom(roomId, { type: "channels_updated", roomId });
  res.status(204).end();
});

export default router;
