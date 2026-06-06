import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { PresenceEntry, Message } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

type WsMessage = 
  | { type: "auth", token: string }
  | { type: "join_room", roomId: number }
  | { type: "presence", speaking: boolean, streaming: boolean }
  | { type: "stream_offer", to: number, sdp: string }
  | { type: "stream_answer", to: number, sdp: string }
  | { type: "ice_candidate", to: number, candidate: RTCIceCandidateInit }
  | { type: "presence_update", roomId: number, entries: PresenceEntry[] }
  | { type: "new_message", message: Message }
  | { type: "stream_offer", from: number, sdp: string }
  | { type: "stream_answer", from: number, sdp: string }
  | { type: "ice_candidate", from: number, candidate: RTCIceCandidateInit };

interface WsContextType {
  connected: boolean;
  joinRoom: (roomId: number) => void;
  leaveRoom: () => void;
  updatePresence: (speaking: boolean, streaming: boolean) => void;
  sendOffer: (to: number, sdp: string) => void;
  sendAnswer: (to: number, sdp: string) => void;
  sendIceCandidate: (to: number, candidate: RTCIceCandidateInit) => void;
  onPresenceUpdate: (handler: (entries: PresenceEntry[]) => void) => () => void;
  onNewMessage: (handler: (msg: Message) => void) => () => void;
  onOffer: (handler: (from: number, sdp: string) => void) => () => void;
  onAnswer: (handler: (from: number, sdp: string) => void) => () => void;
  onIceCandidate: (handler: (from: number, candidate: RTCIceCandidateInit) => void) => () => void;
}

const WsContext = createContext<WsContextType | null>(null);

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();
  
  const presenceListeners = useRef<Set<(entries: PresenceEntry[]) => void>>(new Set());
  const messageListeners = useRef<Set<(msg: Message) => void>>(new Set());
  const offerListeners = useRef<Set<(from: number, sdp: string) => void>>(new Set());
  const answerListeners = useRef<Set<(from: number, sdp: string) => void>>(new Set());
  const iceListeners = useRef<Set<(from: number, candidate: RTCIceCandidateInit) => void>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      setConnected(true);
      const token = localStorage.getItem("screencrew_token");
      if (token) {
        ws.send(JSON.stringify({ type: "auth", token }));
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsMessage;
        switch (data.type) {
          case "presence_update":
            presenceListeners.current.forEach(fn => fn(data.entries));
            break;
          case "new_message":
            messageListeners.current.forEach(fn => fn(data.message));
            break;
          case "stream_offer":
            if ('from' in data) offerListeners.current.forEach(fn => fn(data.from, data.sdp));
            break;
          case "stream_answer":
            if ('from' in data) answerListeners.current.forEach(fn => fn(data.from, data.sdp));
            break;
          case "ice_candidate":
            if ('from' in data) iceListeners.current.forEach(fn => fn(data.from, data.candidate));
            break;
        }
      } catch (e) {
        console.error("Failed to parse ws message", e);
      }
    };
    
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 2000);
    };
    
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const send = (msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  return (
    <WsContext.Provider value={{
      connected,
      joinRoom: (roomId) => send({ type: "join_room", roomId }),
      leaveRoom: () => {}, // Handled by closing connection or re-joining
      updatePresence: (speaking, streaming) => send({ type: "presence", speaking, streaming }),
      sendOffer: (to, sdp) => send({ type: "stream_offer", to, sdp }),
      sendAnswer: (to, sdp) => send({ type: "stream_answer", to, sdp }),
      sendIceCandidate: (to, candidate) => send({ type: "ice_candidate", to, candidate }),
      onPresenceUpdate: (fn) => { presenceListeners.current.add(fn); return () => presenceListeners.current.delete(fn); },
      onNewMessage: (fn) => { messageListeners.current.add(fn); return () => messageListeners.current.delete(fn); },
      onOffer: (fn) => { offerListeners.current.add(fn); return () => offerListeners.current.delete(fn); },
      onAnswer: (fn) => { answerListeners.current.add(fn); return () => answerListeners.current.delete(fn); },
      onIceCandidate: (fn) => { iceListeners.current.add(fn); return () => iceListeners.current.delete(fn); },
    }}>
      {children}
    </WsContext.Provider>
  );
}

export function useWs() {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used within WsProvider");
  return ctx;
}
