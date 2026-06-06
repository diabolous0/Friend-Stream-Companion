import { useEffect, useState, useCallback, useRef } from "react";

type WebSocketMessage =
  | { type: "presence_update"; roomId: number; entries: any[] }
  | { type: "new_message"; message: any }
  | { type: "reaction_update"; messageId: number; reactions: any[] }
  | { type: "typing_update"; userId: number; username: string; isTyping: boolean }
  | { type: "message_updated"; message: any }
  | { type: "message_deleted"; messageId: number }
  | { type: "stream_offer"; from: number; sdp: string }
  | { type: "stream_answer"; from: number; sdp: string }
  | { type: "ice_candidate"; from: number; candidate: RTCIceCandidateInit }
  | { type: "audio_offer"; from: number; sdp: string }
  | { type: "audio_answer"; from: number; sdp: string }
  | { type: "audio_ice"; from: number; candidate: RTCIceCandidateInit };

interface UseWebSocketOptions {
  onPresenceUpdate?: (roomId: number, entries: any[]) => void;
  onNewMessage?: (message: any) => void;
  onReactionUpdate?: (messageId: number, reactions: any[]) => void;
  onTypingUpdate?: (userId: number, username: string, isTyping: boolean) => void;
  onMessageUpdated?: (message: any) => void;
  onMessageDeleted?: (messageId: number) => void;
  onStreamOffer?: (from: number, sdp: string) => void;
  onStreamAnswer?: (from: number, sdp: string) => void;
  onIceCandidate?: (from: number, candidate: RTCIceCandidateInit) => void;
  onAudioOffer?: (from: number, sdp: string) => void;
  onAudioAnswer?: (from: number, sdp: string) => void;
  onAudioIce?: (from: number, candidate: RTCIceCandidateInit) => void;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
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
          case "message_updated":   o.onMessageUpdated?.(data.message); break;
          case "message_deleted":   o.onMessageDeleted?.(data.messageId); break;
          case "stream_offer":      o.onStreamOffer?.(data.from, data.sdp); break;
          case "stream_answer":     o.onStreamAnswer?.(data.from, data.sdp); break;
          case "ice_candidate":     o.onIceCandidate?.(data.from, data.candidate); break;
          case "audio_offer":       o.onAudioOffer?.(data.from, data.sdp); break;
          case "audio_answer":      o.onAudioAnswer?.(data.from, data.sdp); break;
          case "audio_ice":         o.onAudioIce?.(data.from, data.candidate); break;
        }
      } catch (e) {
        console.error("Failed to parse websocket message", e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, [connect]);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { isConnected, send };
}
