import { useEffect, useState, useCallback, useRef } from "react";

type WebSocketMessage =
  | { type: "presence_update"; roomId: number; entries: any[] }
  | { type: "new_message"; message: any }
  | { type: "reaction_update"; messageId: number; reactions: any[] }
  | { type: "typing_update"; userId: number; username: string; isTyping: boolean }
  | { type: "reads_snapshot"; reads: { userId: number; lastReadMessageId: number }[] }
  | { type: "read_update"; userId: number; lastReadMessageId: number }
  | { type: "message_updated"; message: any }
  | { type: "message_deleted"; messageId: number }
  | { type: "stream_offer"; from: number; sdp: string }
  | { type: "stream_answer"; from: number; sdp: string }
  | { type: "ice_candidate"; from: number; candidate: RTCIceCandidateInit }
  | { type: "audio_offer"; from: number; sdp: string }
  | { type: "audio_answer"; from: number; sdp: string }
  | { type: "audio_ice"; from: number; candidate: RTCIceCandidateInit }
  | { type: "room_updated"; room: any }
  | { type: "soundboard_play"; userId: number; username: string; sound: string }
  | { type: "knock"; roomId: number; user: any }
  | { type: "knock_approved"; roomId: number; room: any }
  | { type: "knock_resolved"; roomId: number; userId: number }
  | { type: "joined_channel"; channelId: number }
  | { type: "channels_updated"; roomId: number }
  | { type: "channel_access_revoked" }
  | { type: "role_updated"; roomId: number; userId: number; role: string }
  | { type: "knock_denied"; roomId: number }
  | { type: "member_removed"; roomId: number; userId: number }
  | { type: "removed_from_room"; roomId: number }
  | { type: "banned_from_room"; roomId: number }
  | { type: "watch_response"; from: number; allow: boolean };

interface UseWebSocketOptions {
  onPresenceUpdate?: (roomId: number, entries: any[]) => void;
  onNewMessage?: (message: any) => void;
  onReactionUpdate?: (messageId: number, reactions: any[]) => void;
  onTypingUpdate?: (userId: number, username: string, isTyping: boolean) => void;
  onReadsSnapshot?: (reads: { userId: number; lastReadMessageId: number }[]) => void;
  onReadUpdate?: (userId: number, lastReadMessageId: number) => void;
  onMessageUpdated?: (message: any) => void;
  onMessageDeleted?: (messageId: number) => void;
  onStreamOffer?: (from: number, sdp: string) => void;
  onStreamAnswer?: (from: number, sdp: string) => void;
  onIceCandidate?: (from: number, candidate: RTCIceCandidateInit) => void;
  onAudioOffer?: (from: number, sdp: string) => void;
  onAudioAnswer?: (from: number, sdp: string) => void;
  onAudioIce?: (from: number, candidate: RTCIceCandidateInit) => void;
  onRoomUpdated?: (room: any) => void;
  onSoundboardPlay?: (userId: number, username: string, sound: string) => void;
  onKnock?: (roomId: number, user: any) => void;
  onKnockApproved?: (roomId: number, room: any) => void;
  onKnockResolved?: (roomId: number, userId: number) => void;
  onJoinedChannel?: (channelId: number) => void;
  onChannelsUpdated?: (roomId: number) => void;
  onChannelAccessRevoked?: () => void;
  onRoleUpdated?: (roomId: number, userId: number, role: string) => void;
  onMemberRemoved?: (roomId: number, userId: number) => void;
  onRemovedFromRoom?: (roomId: number, banned: boolean) => void;
  onWatchResponse?: (from: number, allow: boolean) => void;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Reconnect bookkeeping: exponential backoff with a cap, plus a flag so we don't
  // reconnect after the component intentionally unmounts.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    // Don't open a second socket if one is already open or mid-handshake.
    const rs = wsRef.current?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptsRef.current = 0;
      setIsConnected(true);
      const token = localStorage.getItem("screencrew_token");
      if (token) ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        const o = optionsRef.current;
        switch (data.type) {
          case "presence_update":   o.onPresenceUpdate?.(data.roomId, data.entries); break;
          case "new_message":       o.onNewMessage?.(data.message); break;
          case "reaction_update":   o.onReactionUpdate?.(data.messageId, data.reactions); break;
          case "typing_update":     o.onTypingUpdate?.(data.userId, data.username, data.isTyping); break;
          case "reads_snapshot":    o.onReadsSnapshot?.(data.reads); break;
          case "read_update":       o.onReadUpdate?.(data.userId, data.lastReadMessageId); break;
          case "message_updated":   o.onMessageUpdated?.(data.message); break;
          case "message_deleted":   o.onMessageDeleted?.(data.messageId); break;
          case "stream_offer":      o.onStreamOffer?.(data.from, data.sdp); break;
          case "stream_answer":     o.onStreamAnswer?.(data.from, data.sdp); break;
          case "ice_candidate":     o.onIceCandidate?.(data.from, data.candidate); break;
          case "audio_offer":       o.onAudioOffer?.(data.from, data.sdp); break;
          case "audio_answer":      o.onAudioAnswer?.(data.from, data.sdp); break;
          case "audio_ice":         o.onAudioIce?.(data.from, data.candidate); break;
          case "room_updated":      o.onRoomUpdated?.(data.room); break;
          case "soundboard_play":   o.onSoundboardPlay?.(data.userId, data.username, data.sound); break;
          case "knock":             o.onKnock?.(data.roomId, data.user); break;
          case "knock_approved":    o.onKnockApproved?.(data.roomId, data.room); break;
          case "knock_resolved":    o.onKnockResolved?.(data.roomId, data.userId); break;
          case "joined_channel":    o.onJoinedChannel?.(data.channelId); break;
          case "channels_updated":  o.onChannelsUpdated?.(data.roomId); break;
          case "channel_access_revoked": o.onChannelAccessRevoked?.(); break;
          case "role_updated":      o.onRoleUpdated?.(data.roomId, data.userId, data.role); break;
          case "knock_denied":      o.onKnockResolved?.(data.roomId, -1); break;
          case "member_removed":    o.onMemberRemoved?.(data.roomId, data.userId); break;
          case "removed_from_room": o.onRemovedFromRoom?.(data.roomId, false); break;
          case "banned_from_room":  o.onRemovedFromRoom?.(data.roomId, true); break;
          case "watch_response":    o.onWatchResponse?.(data.from, data.allow); break;
        }
      } catch (e) {
        console.error("Failed to parse websocket message", e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (closedRef.current) return;
      // Exponential backoff with jitter, capped at 15s, so a downed server doesn't
      // get hammered but reconnection is still quick after a brief blip.
      const delay = Math.min(15000, 500 * 2 ** attemptsRef.current) + Math.random() * 500;
      attemptsRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();

    // Reconnect immediately when the network returns or the tab becomes visible
    // again, instead of waiting out the backoff timer.
    const wake = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) { attemptsRef.current = 0; connect(); }
    };
    const onVisible = () => { if (document.visibilityState === "visible") wake(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closedRef.current = true;
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { isConnected, send };
}
