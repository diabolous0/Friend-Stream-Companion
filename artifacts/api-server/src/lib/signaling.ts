import { WebSocketServer, WebSocket } from "ws";
import { type IncomingMessage } from "node:http";
import { type Server } from "node:http";
import { verifyToken } from "../middlewares/auth";
import { logger } from "./logger";
import { db, messagesTable, usersTable, roomMembersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface ClientState {
  ws: WebSocket;
  userId: number;
  username: string;
  roomId: number | null;
  speaking: boolean;
  streaming: boolean;
  inVoice: boolean;
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
    online: true,
    speaking: c.speaking,
    streaming: c.streaming,
    inVoice: c.inVoice,
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
            roomId: null,
            speaking: false,
            streaming: false,
            inVoice: false,
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
            .where(and(eq(roomMembersTable.roomId, roomId), eq(roomMembersTable.userId, state.userId)));

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
          break;
        }

        case "leave_room": {
          if (!state || !state.roomId) return;
          const prevRoom = state.roomId;
          state.roomId = null;
          state.speaking = false;
          state.streaming = false;
          state.inVoice = false;
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

        case "chat_message": {
          if (!state || !state.roomId) return;
          const content = (msg.content as string)?.trim();
          if (!content) return;

          const key = `${state.roomId}:${state.userId}`;
          const t = typingTimers.get(key);
          if (t) { clearTimeout(t); typingTimers.delete(key); }
          broadcast(state.roomId, { type: "typing_update", userId: state.userId, username: state.username, isTyping: false }, ws);

          const [saved] = await db
            .insert(messagesTable)
            .values({ roomId: state.roomId, userId: state.userId, content })
            .returning();

          broadcast(state.roomId, {
            type: "new_message",
            message: {
              id: saved.id,
              roomId: saved.roomId,
              userId: saved.userId,
              username: state.username,
              content: saved.content,
              createdAt: saved.createdAt,
              editedAt: null,
              reactions: [],
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

export function getPresenceSnapshot(roomId: number) {
  return getRoomClients(roomId).map((c) => ({
    userId: c.userId,
    username: c.username,
    online: true,
    speaking: c.speaking,
    streaming: c.streaming,
    inVoice: c.inVoice,
  }));
}
