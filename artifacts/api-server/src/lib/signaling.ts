import { WebSocketServer, WebSocket } from "ws";
import { type IncomingMessage } from "node:http";
import { type Server } from "node:http";
import { verifyToken } from "../middlewares/auth";
import { logger } from "./logger";
import { db, messagesTable, usersTable, roomMembersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

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
  speaking: boolean;
  streaming: boolean;
  inVoice: boolean;
  status: UserStatus;
  statusMessage: string | null;
  activity: string | null;
}

const clients = new Map<WebSocket, ClientState>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getRoomClients(roomId: number): ClientState[] {
  return Array.from(clients.values()).filter((c) => c.roomId === roomId);
}

function broadcast(roomId: number, message: object, exclude?: WebSocket): void {
  const payload = JSON.stringify(message);
  for (const client of getRoomClients(roomId)) {
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
    status: c.status,
    statusMessage: c.statusMessage,
    activity: c.activity,
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
    (c) => c.userId === toUserId && c.roomId === state.roomId
  );
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify(message));
  }
}

export function setupSignaling(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/ws" });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    logger.info("WebSocket connection established");

    ws.on("message", async (rawData) => {
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
            speaking: false,
            streaming: false,
            inVoice: false,
            status: "online",
            statusMessage: null,
            activity: null,
          });
          ws.send(JSON.stringify({ type: "auth_ok", userId: user.id, username: user.username }));
          logger.info({ userId: user.id }, "WebSocket authenticated");
          break;
        }

        case "join_room": {
          if (!state) { ws.send(JSON.stringify({ type: "error", error: "Not authenticated" })); return; }
          const roomId = msg.roomId as number;

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

        case "leave_room": {
          if (!state || !state.roomId) return;
          const prevRoom = state.roomId;
          state.roomId = null;
          state.speaking = false;
          state.streaming = false;
          state.inVoice = false;
          state.activity = null;
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
          if (!state || !state.roomId) return;
          const isTyping = Boolean(msg.isTyping);
          const key = `${state.roomId}:${state.userId}`;
          const existingTimer = typingTimers.get(key);
          if (existingTimer) clearTimeout(existingTimer);
          typingTimers.delete(key);
          broadcast(state.roomId, { type: "typing_update", userId: state.userId, username: state.username, isTyping }, ws);
          if (isTyping) {
            const timer = setTimeout(() => {
              typingTimers.delete(key);
              broadcast(state.roomId!, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false });
            }, 5000);
            typingTimers.set(key, timer);
          }
          break;
        }

        case "read": {
          if (!state || !state.roomId) return;
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
              .set({ lastReadMessageId: sql`GREATEST(COALESCE(${roomMembersTable.lastReadMessageId}, 0), ${messageId})` })
              .where(and(eq(roomMembersTable.roomId, state.roomId), eq(roomMembersTable.userId, state.userId)))
              .returning({ lastReadMessageId: roomMembersTable.lastReadMessageId });
            if (!updated.length) return;
            broadcast(state.roomId, { type: "read_update", userId: state.userId, lastReadMessageId: updated[0].lastReadMessageId });
          } catch (err) {
            logger.error({ err }, "failed to handle read receipt");
          }
          break;
        }

        case "chat_message": {
          if (!state || !state.roomId) return;
          const content = (msg.content as string)?.trim();
          if (!content) return;

          const key = `${state.roomId}:${state.userId}`;
          const t = typingTimers.get(key);
          if (t) { clearTimeout(t); typingTimers.delete(key); }
          broadcast(state.roomId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false }, ws);

          const replyToId = Number.isInteger(msg.replyToId) ? (msg.replyToId as number) : null;
          let replyToContent: string | null = null;
          let replyToUsername: string | null = null;
          if (replyToId) {
            const [parent] = await db
              .select({ content: messagesTable.content, username: usersTable.username })
              .from(messagesTable)
              .innerJoin(usersTable, eq(messagesTable.userId, usersTable.id))
              .where(and(eq(messagesTable.id, replyToId), eq(messagesTable.roomId, state.roomId)));
            if (parent) {
              replyToContent = parent.content;
              replyToUsername = parent.username;
            }
          }

          const [saved] = await db
            .insert(messagesTable)
            .values({ roomId: state.roomId, userId: state.userId, content, replyToId: replyToContent ? replyToId : null })
            .returning();

          broadcast(state.roomId, {
            type: "new_message",
            message: {
              id: saved.id,
              roomId: saved.roomId,
              userId: saved.userId,
              username: state.username,
              displayName: state.displayName,
              avatarUrl: state.avatarUrl,
              nameColor: state.nameColor,
              avatarStyle: state.avatarStyle,
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
    });

    ws.on("close", () => {
      const state = clients.get(ws);
      if (state?.roomId) {
        const key = `${state.roomId}:${state.userId}`;
        const t = typingTimers.get(key);
        if (t) { clearTimeout(t); typingTimers.delete(key); }
        broadcast(state.roomId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false });
        state.streaming = false;
        state.speaking = false;
        state.inVoice = false;
        broadcastPresence(state.roomId);
      }
      clients.delete(ws);
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
    status: c.status,
    statusMessage: c.statusMessage,
    activity: c.activity,
  }));
}

export function notifyUser(userId: number, message: object): void {
  const payload = JSON.stringify(message);
  for (const client of clients.values()) {
    if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}
