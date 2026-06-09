import { WebSocketServer, WebSocket } from "ws";
import { type IncomingMessage } from "node:http";
import { type Server } from "node:http";
import { verifyToken } from "../middlewares/auth";
import { logger } from "./logger";
import { db, messagesTable, usersTable, roomMembersTable, roomsTable, channelsTable, roleAtLeast, IS_SQLITE } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";

type UserStatus = "online" | "away" | "dnd";

interface ClientState {
  ws: WebSocket;
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  nameColor: string | null;
  avatarStyle: string | null;
  roomId: number | null;
  channelId: number | null;
  speaking: boolean;
  streaming: boolean;
  inVoice: boolean;
  status: UserStatus;
  statusMessage: string | null;
  activity: string | null;
  watching: number[];
  askToWatch: boolean;
  guestRoomId: number | null;
}

const clients = new Map<WebSocket, ClientState>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const liveSockets = new WeakSet<WebSocket>();

const MAX_PAYLOAD_BYTES = 256 * 1024;
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 240;
const EMPTY_EPHEMERAL_GRACE_MS = 10 * 60 * 1000;

function getRoomClients(roomId: number): ClientState[] {
  return Array.from(clients.values()).filter((c) => c.roomId === roomId);
}

function getChannelClients(channelId: number): ClientState[] {
  return Array.from(clients.values()).filter((c) => c.channelId === channelId);
}

async function scheduleEmptyEphemeralRoomCleanup(roomId: number): Promise<void> {
  if (getRoomClients(roomId).length > 0) return;
  await db
    .update(roomsTable)
    .set({ expiresAt: new Date(Date.now() + EMPTY_EPHEMERAL_GRACE_MS) })
    .where(and(eq(roomsTable.id, roomId), eq(roomsTable.ephemeral, true)));
}

function broadcast(roomId: number, message: object, exclude?: WebSocket): void {
  const payload = JSON.stringify(message);
  for (const client of getRoomClients(roomId)) {
    if (client.ws !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function broadcastChannel(channelId: number, message: object, exclude?: WebSocket): void {
  const payload = JSON.stringify(message);
  for (const client of getChannelClients(channelId)) {
    if (client.ws !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function broadcastPresence(roomId: number): void {
  const entries = getRoomClients(roomId).map((c) => ({
    userId: c.userId,
    username: c.username,
    displayName: c.displayName,
    avatarUrl: c.avatarUrl,
    nameColor: c.nameColor,
    avatarStyle: c.avatarStyle,
    online: true,
    speaking: c.speaking,
    streaming: c.streaming,
    inVoice: c.inVoice,
    channelId: c.channelId,
    status: c.status,
    statusMessage: c.statusMessage,
    activity: c.activity,
    watching: c.watching,
    askToWatch: c.askToWatch,
  }));
  const payload = JSON.stringify({ type: "presence_update", roomId, entries });
  for (const client of getRoomClients(roomId)) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function relayTo(state: ClientState, toUserId: number, message: object): void {
  const target = Array.from(clients.values()).find(
    (c) => c.userId === toUserId && c.channelId != null && c.channelId === state.channelId
  );
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify(message));
  }
}

// Force any live WebSocket sessions for a kicked/banned user out of a room so
// they immediately stop sending or receiving real-time traffic, regardless of
// whether their client honors the removed_from_room/banned_from_room notice.
export function evictUserFromRoom(roomId: number, userId: number): void {
  for (const client of Array.from(clients.values())) {
    if (client.userId !== userId || client.roomId !== roomId) continue;
    client.roomId = null;
    client.channelId = null;
    client.streaming = false;
    client.speaking = false;
    client.inVoice = false;
    client.watching = [];
  }
  // Reflect the departure to everyone still in the room.
  broadcastPresence(roomId);
}

// True if a member with `role` may view a channel with the given gating.
function canViewChannel(
  role: string | null | undefined,
  channel: { isPrivate: boolean; minViewRole: string },
): boolean {
  const isStaff = role === "owner" || role === "mod";
  if (channel.isPrivate && !isStaff) return false;
  return roleAtLeast(role, channel.minViewRole);
}

// Evict a single user's live sessions from a specific channel (without leaving the room),
// notifying them so the client navigates away. Used when access is revoked dynamically.
function evictSessionFromChannel(client: ClientState): void {
  client.channelId = null;
  client.streaming = false;
  client.speaking = false;
  client.inVoice = false;
  client.watching = [];
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify({ type: "channel_access_revoked" }));
  }
}

// Re-check every client currently joined to a channel against its (possibly updated)
// permissions and evict any who no longer qualify. Call after channel perm changes so
// stale WS subscriptions can't keep receiving traffic until manual leave/rejoin.
export async function revalidateChannelAccess(channelId: number): Promise<void> {
  const joined = getChannelClients(channelId);
  if (joined.length === 0) return;
  const [channel] = await db
    .select({ isPrivate: channelsTable.isPrivate, minViewRole: channelsTable.minViewRole, roomId: channelsTable.roomId })
    .from(channelsTable)
    .where(eq(channelsTable.id, channelId));
  if (!channel) return;

  // Batch all membership lookups into one query instead of one per joined
  // client (was N+1: a channel with N clients ran N membership selects).
  const userIds = Array.from(new Set(joined.map((c) => c.userId)));
  const memberships = await db
    .select({ userId: roomMembersTable.userId, role: roomMembersTable.role, status: roomMembersTable.status })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, channel.roomId), inArray(roomMembersTable.userId, userIds)));
  const membershipByUser = new Map(memberships.map((m) => [m.userId, m]));

  const affectedRooms = new Set<number>();
  for (const client of joined) {
    const membership = membershipByUser.get(client.userId);
    const allowed = membership?.status === "active" && canViewChannel(membership.role, channel);
    if (!allowed) {
      evictSessionFromChannel(client);
      if (client.roomId != null) affectedRooms.add(client.roomId);
    }
  }
  for (const roomId of affectedRooms) broadcastPresence(roomId);
}

// Re-check all channels a user is currently joined to in a room against their
// (possibly lowered) role and evict them from any they can no longer view.
export async function revalidateMemberChannelAccess(roomId: number, userId: number): Promise<void> {
  const sessions = Array.from(clients.values()).filter(
    (c) => c.userId === userId && c.roomId === roomId && c.channelId != null,
  );
  if (sessions.length === 0) return;
  const [membership] = await db
    .select({ role: roomMembersTable.role, status: roomMembersTable.status })
    .from(roomMembersTable)
    .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, userId)));
  // Batch all channel lookups into one query instead of one per session.
  const channelIds = Array.from(new Set(sessions.map((c) => c.channelId!)));
  const channelRows = await db
    .select({ id: channelsTable.id, isPrivate: channelsTable.isPrivate, minViewRole: channelsTable.minViewRole })
    .from(channelsTable)
    .where(inArray(channelsTable.id, channelIds));
  const channelById = new Map(channelRows.map((c) => [c.id, c]));

  let evicted = false;
  for (const client of sessions) {
    const channel = channelById.get(client.channelId!);
    const allowed = channel != null && membership?.status === "active" && canViewChannel(membership.role, channel);
    if (!allowed) {
      evictSessionFromChannel(client);
      evicted = true;
    }
  }
  if (evicted) broadcastPresence(roomId);
}

export function setupSignaling(server: Server): void {
  const wss = new WebSocketServer({
    server,
    path: "/api/ws",
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  // Remove half-open clients that disappear without completing a WebSocket
  // close handshake. This keeps long-running self-hosted servers lightweight.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!liveSockets.has(ws)) {
        ws.terminate();
        continue;
      }
      liveSockets.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  server.once("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    logger.info("WebSocket connection established");
    liveSockets.add(ws);

    let rateWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    const authTimeout = setTimeout(() => {
      if (!clients.has(ws)) {
        ws.close(1008, "Authentication timeout");
      }
    }, AUTH_TIMEOUT_MS);
    authTimeout.unref();

    ws.on("pong", () => liveSockets.add(ws));

    ws.on("message", async (rawData) => {
      const now = Date.now();
      if (now - rateWindowStartedAt >= RATE_LIMIT_WINDOW_MS) {
        rateWindowStartedAt = now;
        messagesInWindow = 0;
      }
      messagesInWindow += 1;
      if (messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
        ws.close(1008, "Message rate limit exceeded");
        return;
      }

      try {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(rawData.toString());
        } catch {
          return;
        }

        const state = clients.get(ws);

        switch (msg.type) {
        case "auth": {
          const token = msg.token as string;
          const payload = verifyToken(token);
          if (!payload) {
            ws.send(JSON.stringify({ type: "error", error: "Invalid token" }));
            ws.close();
            return;
          }
          const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
          if (!user) {
            ws.send(JSON.stringify({ type: "error", error: "User not found" }));
            ws.close();
            return;
          }
          clients.set(ws, {
            ws,
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            nameColor: user.nameColor,
            avatarStyle: user.avatarStyle,
            roomId: null,
            channelId: null,
            speaking: false,
            streaming: false,
            inVoice: false,
            status: "online",
            statusMessage: null,
            activity: null,
            watching: [],
            askToWatch: false,
            guestRoomId: payload.guestRoomId ?? null,
          });
          clearTimeout(authTimeout);
          ws.send(JSON.stringify({ type: "auth_ok", userId: user.id, username: user.username }));
          logger.info({ userId: user.id }, "WebSocket authenticated");
          break;
        }

        case "join_room": {
          if (!state) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
          const roomId = msg.roomId as number;
          if (state.guestRoomId !== null && state.guestRoomId !== roomId) {
            ws.send(JSON.stringify({ type: "error", error: "Guest access is limited to this Quick Call" }));
            return;
          }

          const [membership] = await db
            .select()
            .from(roomMembersTable)
            .where(and(
              eq(roomMembersTable.roomId, roomId),
              eq(roomMembersTable.userId, state.userId),
              eq(roomMembersTable.status, "active"),
            ));

          if (!membership) {
            ws.send(JSON.stringify({ type: "error", error: "Not a member of this room" }));
            return;
          }

          if (state.roomId && state.roomId !== roomId) {
            broadcastPresence(state.roomId);
          }

          state.roomId = roomId;
          ws.send(JSON.stringify({ type: "joined_room", roomId }));
          broadcastPresence(roomId);

          const reads = await db
            .select({ userId: roomMembersTable.userId, lastReadMessageId: roomMembersTable.lastReadMessageId })
            .from(roomMembersTable)
            .where(eq(roomMembersTable.roomId, roomId));
          ws.send(JSON.stringify({ type: "reads_snapshot", reads: reads.filter((r) => r.lastReadMessageId != null) }));
          break;
        }

        case "join_channel": {
          if (!state) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
          const channelId = Number(msg.channelId);
          if (!Number.isInteger(channelId)) return;

          const [channel] = await db.select().from(channelsTable).where(eq(channelsTable.id, channelId));
          if (!channel) { ws.send(JSON.stringify({ type: "error", error: "Channel not found" })); return; }
          if (state.guestRoomId !== null && state.guestRoomId !== channel.roomId) {
            ws.send(JSON.stringify({ type: "error", error: "Guest access is limited to this Quick Call" }));
            return;
          }

          const [membership] = await db
            .select()
            .from(roomMembersTable)
            .where(and(
              eq(roomMembersTable.roomId, channel.roomId),
              eq(roomMembersTable.userId, state.userId),
              eq(roomMembersTable.status, "active"),
            ));
          if (!membership) { ws.send(JSON.stringify({ type: "error", error: "Not a member of this room" })); return; }

          const isStaff = membership.role === "owner" || membership.role === "mod";
          if (channel.isPrivate && !isStaff) {
            ws.send(JSON.stringify({ type: "error", error: "Channel is private" }));
            return;
          }
          if (!roleAtLeast(membership.role, channel.minViewRole)) {
            ws.send(JSON.stringify({ type: "error", error: "No access to this channel" }));
            return;
          }

          // Leaving the previous channel resets the per-channel voice/stream state.
          state.roomId = channel.roomId;
          state.channelId = channelId;
          state.speaking = false;
          state.streaming = false;
          state.inVoice = false;
          state.watching = [];
          ws.send(JSON.stringify({ type: "joined_channel", channelId }));
          broadcastPresence(channel.roomId);
          break;
        }

        case "leave_room": {
          if (!state || !state.roomId) return;
          const prevRoom = state.roomId;
          state.roomId = null;
          state.channelId = null;
          state.speaking = false;
          state.streaming = false;
          state.inVoice = false;
          state.activity = null;
          state.watching = [];
          broadcastPresence(prevRoom);
          break;
        }

        case "presence": {
          if (!state || !state.roomId) return;
          state.speaking = Boolean(msg.speaking);
          state.streaming = Boolean(msg.streaming);
          state.inVoice = Boolean(msg.inVoice);
          broadcastPresence(state.roomId);
          break;
        }

        case "watching": {
          if (!state || !state.roomId) return;
          const ids = Array.isArray(msg.watching)
            ? Array.from(new Set(msg.watching.filter((v): v is number => Number.isInteger(v)))).slice(0, 50)
            : [];
          state.watching = ids;
          broadcastPresence(state.roomId);
          break;
        }

        case "status": {
          if (!state) return;
          const allowed: UserStatus[] = ["online", "away", "dnd"];
          const next = allowed.includes(msg.status as UserStatus) ? (msg.status as UserStatus) : "online";
          state.status = next;
          const rawMsg = typeof msg.statusMessage === "string" ? msg.statusMessage.trim().slice(0, 120) : "";
          state.statusMessage = rawMsg.length > 0 ? rawMsg : null;
          if (state.roomId) broadcastPresence(state.roomId);
          break;
        }

        case "activity": {
          if (!state) return;
          const rawActivity = typeof msg.activity === "string" ? msg.activity.trim().slice(0, 80) : "";
          state.activity = rawActivity.length > 0 ? rawActivity : null;
          if (state.roomId) broadcastPresence(state.roomId);
          break;
        }

        case "soundboard": {
          if (!state || !state.roomId) return;
          const sound = typeof msg.sound === "string" ? msg.sound.trim().slice(0, 200) : "";
          if (!sound) return;
          broadcast(state.roomId, {
            type: "soundboard_play",
            userId: state.userId,
            username: state.username,
            sound,
          });
          break;
        }

        case "typing": {
          if (!state || !state.roomId || !state.channelId) return;
          const channelId = state.channelId;
          const isTyping = Boolean(msg.isTyping);
          const key = `${channelId}:${state.userId}`;
          const existingTimer = typingTimers.get(key);
          if (existingTimer) clearTimeout(existingTimer);
          typingTimers.delete(key);
          broadcastChannel(channelId, { type: "typing_update", userId: state.userId, username: state.username, isTyping }, ws);
          if (isTyping) {
            const timer = setTimeout(() => {
              typingTimers.delete(key);
              broadcastChannel(channelId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false });
            }, 5000);
            typingTimers.set(key, timer);
          }
          break;
        }

        case "read": {
          if (!state || !state.roomId || !state.channelId) return;
          const channelId = state.channelId;
          const messageId = Number(msg.messageId);
          if (!Number.isInteger(messageId) || messageId <= 0) return;
          try {
            const [message] = await db
              .select({ id: messagesTable.id })
              .from(messagesTable)
              .where(and(eq(messagesTable.id, messageId), eq(messagesTable.roomId, state.roomId)));
            if (!message) return;
            const updated = await db
              .update(roomMembersTable)
              .set({
                lastReadMessageId: IS_SQLITE
                  ? sql`MAX(COALESCE(${roomMembersTable.lastReadMessageId}, 0), ${messageId})`
                  : sql`GREATEST(COALESCE(${roomMembersTable.lastReadMessageId}, 0), ${messageId})`,
              })
              .where(and(eq(roomMembersTable.roomId, state.roomId), eq(roomMembersTable.userId, state.userId)))
              .returning({ lastReadMessageId: roomMembersTable.lastReadMessageId });
            if (!updated.length) return;
            broadcastChannel(channelId, { type: "read_update", userId: state.userId, lastReadMessageId: updated[0].lastReadMessageId });
          } catch (err) {
            logger.error({ err }, "failed to handle read receipt");
          }
          break;
        }

        case "chat_message": {
          if (!state || !state.roomId || !state.channelId) return;
          const channelId = state.channelId;
          const content = (msg.content as string)?.trim();
          if (!content) return;

          const [channel] = await db.select().from(channelsTable).where(eq(channelsTable.id, channelId));
          if (!channel || channel.roomId !== state.roomId) return;
          const [membership] = await db
            .select({ role: roomMembersTable.role })
            .from(roomMembersTable)
            .where(and(eq(roomMembersTable.roomId, state.roomId), eq(roomMembersTable.userId, state.userId)));
          const isStaff = membership?.role === "owner" || membership?.role === "mod";
          if (channel.type === "announcement" && !isStaff) {
            ws.send(JSON.stringify({ type: "error", error: "Only staff can post in announcement channels" }));
            return;
          }
          if (!roleAtLeast(membership?.role, channel.minViewRole)) {
            ws.send(JSON.stringify({ type: "error", error: "No access to this channel" }));
            return;
          }
          if (!roleAtLeast(membership?.role, channel.minSendRole)) {
            ws.send(JSON.stringify({ type: "error", error: "You don't have permission to post in this channel" }));
            return;
          }

          const key = `${channelId}:${state.userId}`;
          const t = typingTimers.get(key);
          if (t) { clearTimeout(t); typingTimers.delete(key); }
          broadcastChannel(channelId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false }, ws);

          const replyToId = Number.isInteger(msg.replyToId) ? (msg.replyToId as number) : null;
          let replyToContent: string | null = null;
          let replyToUsername: string | null = null;
          if (replyToId) {
            const [parent] = await db
              .select({ content: messagesTable.content, username: usersTable.username })
              .from(messagesTable)
              .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
              .where(and(eq(messagesTable.id, replyToId), eq(messagesTable.channelId, channelId)));
            if (parent) {
              replyToContent = parent.content;
              replyToUsername = parent.username;
            }
          }

          const [saved] = await db
            .insert(messagesTable)
            .values({ roomId: state.roomId, channelId, userId: state.userId, content, replyToId: replyToContent ? replyToId : null })
            .returning();

          broadcastChannel(channelId, {
            type: "new_message",
            message: {
              id: saved.id,
              roomId: saved.roomId,
              channelId: saved.channelId,
              userId: saved.userId,
              username: state.username,
              displayName: state.displayName,
              avatarUrl: state.avatarUrl,
              nameColor: state.nameColor,
              avatarStyle: state.avatarStyle,
              isBot: false,
              content: saved.content,
              createdAt: saved.createdAt,
              editedAt: null,
              reactions: [],
              pinned: false,
              replyToId: saved.replyToId,
              replyToContent,
              replyToUsername,
            },
          });
          break;
        }

        case "stream_offer": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "stream_offer", from: state.userId, sdp: msg.sdp });
          break;
        }

        case "stream_answer": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "stream_answer", from: state.userId, sdp: msg.sdp });
          break;
        }

        case "watch_prefs": {
          if (!state || !state.roomId) return;
          state.askToWatch = !!msg.askToWatch;
          broadcastPresence(state.roomId);
          break;
        }

        case "watch_response": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "watch_response", from: state.userId, allow: !!msg.allow });
          break;
        }

        case "ice_candidate": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "ice_candidate", from: state.userId, candidate: msg.candidate });
          break;
        }

        case "audio_offer": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "audio_offer", from: state.userId, sdp: msg.sdp });
          break;
        }

        case "audio_answer": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "audio_answer", from: state.userId, sdp: msg.sdp });
          break;
        }

        case "audio_ice": {
          if (!state || !state.roomId) return;
          relayTo(state, msg.to as number, { type: "audio_ice", from: state.userId, candidate: msg.candidate });
          break;
        }

          default:
            break;
        }
      } catch (err) {
        // Database or signaling failures must not become unhandled promise
        // rejections that can destabilize a long-running self-hosted server.
        logger.error({ err }, "Failed to handle WebSocket message");
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", error: "Unable to process message" }));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      const state = clients.get(ws);
      const previousRoomId = state?.roomId ?? null;
      if (state?.roomId) {
        if (state.channelId) {
          const key = `${state.channelId}:${state.userId}`;
          const t = typingTimers.get(key);
          if (t) { clearTimeout(t); typingTimers.delete(key); }
          broadcastChannel(state.channelId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false });
        }
        state.streaming = false;
        state.speaking = false;
        state.inVoice = false;
        broadcastPresence(state.roomId);
      }
      clients.delete(ws);
      if (previousRoomId !== null) {
        scheduleEmptyEphemeralRoomCleanup(previousRoomId).catch((err) =>
          logger.error({ err, roomId: previousRoomId }, "Failed to schedule empty ephemeral room cleanup"),
        );
      }
      logger.info("WebSocket disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
    });
  });

  logger.info("WebSocket signaling server attached at /api/ws");
}

export function broadcastToRoom(roomId: number, message: object): void {
  broadcast(roomId, message);
}

export function refreshUserProfile(
  userId: number,
  profile: { displayName: string | null; avatarUrl: string | null; nameColor: string | null; avatarStyle: string | null },
): void {
  const affectedRooms = new Set<number>();
  for (const state of clients.values()) {
    if (state.userId === userId) {
      state.displayName = profile.displayName;
      state.avatarUrl = profile.avatarUrl;
      state.nameColor = profile.nameColor;
      state.avatarStyle = profile.avatarStyle;
      if (state.roomId !== null) affectedRooms.add(state.roomId);
    }
  }
  for (const roomId of affectedRooms) broadcastPresence(roomId);
}

export function getPresenceSnapshot(roomId: number) {
  return getRoomClients(roomId).map((c) => ({
    userId: c.userId,
    username: c.username,
    online: true,
    speaking: c.speaking,
    streaming: c.streaming,
    inVoice: c.inVoice,
    channelId: c.channelId,
    status: c.status,
    statusMessage: c.statusMessage,
    activity: c.activity,
    askToWatch: c.askToWatch,
  }));
}

export function getVoicePresenceForRooms(roomIds: number[]) {
  const wanted = new Set(roomIds);
  const map = new Map<number, Array<{
    userId: number;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    avatarStyle: string | null;
    channelId: number | null;
  }>>();
  const seen = new Set<string>();
  for (const c of clients.values()) {
    if (c.roomId == null || !c.inVoice || !wanted.has(c.roomId)) continue;
    const dedupeKey = `${c.roomId}:${c.userId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!map.has(c.roomId)) map.set(c.roomId, []);
    map.get(c.roomId)!.push({
      userId: c.userId,
      username: c.username,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      avatarStyle: c.avatarStyle,
      channelId: c.channelId,
    });
  }
  return map;
}

export function notifyUser(userId: number, message: object): void {
  const payload = JSON.stringify(message);
  for (const client of clients.values()) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
