import { useEffect, useState, useCallback, useRef } from "react";

type WebSocketMessage =
  | { type: "presence_update"; roomId: number; entries: any[] }
  | { type: "new_message"; message: any }
  | { type: "reaction_update"; messageId: number; reactions: any[] }
  | { type: "stream_offer"; from: number; sdp: string }
  | { type: "stream_answer"; from: number; sdp: string }
  | { type: "ice_candidate"; from: number; candidate: RTCIceCandidateInit };

interface UseWebSocketOptions {
  onPresenceUpdate?: (roomId: number, entries: any[]) => void;
  onNewMessage?: (message: any) => void;
  onReactionUpdate?: (messageId: number, reactions: any[]) => void;
  onStreamOffer?: (from: number, sdp: string) => void;
  onStreamAnswer?: (from: number, sdp: string) => void;
  onIceCandidate?: (from: number, candidate: RTCIceCandidateInit) => void;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      const token = localStorage.getItem("screencrew_token");
      if (token) {
        ws.send(JSON.stringify({ type: "auth", token }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data);
        switch (data.type) {
          case "presence_update":
            options.onPresenceUpdate?.(data.roomId, data.entries);
            break;
          case "new_message":
            options.onNewMessage?.(data.message);
            break;
          case "reaction_update":
            options.onReactionUpdate?.(data.messageId, data.reactions);
            break;
          case "stream_offer":
            options.onStreamOffer?.(data.from, data.sdp);
            break;
          case "stream_answer":
            options.onStreamAnswer?.(data.from, data.sdp);
            break;
          case "ice_candidate":
            options.onIceCandidate?.(data.from, data.candidate);
            break;
        }
      } catch (e) {
        console.error("Failed to parse websocket message", e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 3000);
    };
  }, [options]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { isConnected, send };
}
