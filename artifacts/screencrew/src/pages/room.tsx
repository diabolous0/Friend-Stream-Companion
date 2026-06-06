import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetRoom, getGetRoomQueryKey,
  useGetRoomMembers, getGetRoomMembersQueryKey,
  useGetRoomPresence, getGetRoomPresenceQueryKey,
  useGetRoomMessages, getGetRoomMessagesQueryKey,
  useSendMessage,
  useToggleReaction,
  useGetMe
} from "@workspace/api-client-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MonitorUp, StopCircle, Volume2, VolumeX,
  ChevronLeft, Mic, MicOff, Share2, Copy, Check,
  Pin, PinOff, X
} from "lucide-react";

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "👀", "😮", "🎉", "💀"];

const USER_COLORS = [
  "text-cyan-400", "text-violet-400", "text-green-400",
  "text-orange-400", "text-pink-400", "text-yellow-400",
  "text-blue-400", "text-rose-400",
];
function getUserColor(userId: number) {
  return USER_COLORS[userId % USER_COLORS.length];
}

function useDraggable(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 420, dragRef.current.px + (e.clientX - dragRef.current.sx))),
      y: Math.max(0, Math.min(window.innerHeight - 260, dragRef.current.py + (e.clientY - dragRef.current.sy))),
    });
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  return { pos, setPos, onPointerDown, onPointerMove, onPointerUp };
}

function StreamVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-contain bg-black" />;
}

export default function Room() {
  const [, params] = useRoute("/room/:roomId");
  const roomId = params?.roomId ? parseInt(params.roomId, 10) : 0;
  const [, setLocation] = useLocation();

  const { data: me } = useGetMe();
  const { data: room } = useGetRoom(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomQueryKey(roomId) } });
  const { data: members } = useGetRoomMembers(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMembersQueryKey(roomId) } });
  const { data: initialPresence } = useGetRoomPresence(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomPresenceQueryKey(roomId) } });
  const { data: initialMessages } = useGetRoomMessages(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMessagesQueryKey(roomId) } });
  const sendMessage = useSendMessage();
  const toggleReactionMutation = useToggleReaction();

  const [messages, setMessages] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, any>>({});
  const [msgInput, setMsgInput] = useState("");
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [viewingStreamOf, setViewingStreamOf] = useState<number | null>(null);
  const [streamMuted, setStreamMuted] = useState(false);
  const [streamPinned, setStreamPinned] = useState(false);

  const sendRef = useRef<((msg: any) => void) | null>(null);
  const isSharingRef = useRef(false);

  const streamWindow = useDraggable({ x: Math.min(420, window.innerWidth - 440), y: 80 });

  useEffect(() => {
    if (roomId) localStorage.setItem(`screencrew_visited_${roomId}`, new Date().toISOString());
  }, [roomId]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (initialPresence) {
      const map: Record<number, any> = {};
      initialPresence.forEach((p: any) => (map[p.userId] = p));
      setPresence(map);
    }
  }, [initialPresence]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSpeakingChange = useCallback((speaking: boolean) => {
    setLocalSpeaking(speaking);
    sendRef.current?.({ type: "presence", speaking, streaming: isSharingRef.current });
  }, []);

  const { isActive: micActive, hasPermission: micPermission, startDetection, stopDetection } = useVoiceActivity({
    onSpeakingChange: handleSpeakingChange,
    threshold: 12,
    silenceDelay: 500,
  });

  const toggleMic = useCallback(async () => {
    if (micActive) {
      stopDetection();
      sendRef.current?.({ type: "presence", speaking: false, streaming: isSharingRef.current });
    } else {
      await startDetection();
    }
  }, [micActive, startDetection, stopDetection]);

  const applyReactionUpdate = useCallback((messageId: number, reactions: any[]) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
  }, []);

  const { isConnected, send } = useWebSocket({
    onPresenceUpdate: (rid, entries) => {
      if (rid === roomId) {
        setPresence(prev => {
          const next = { ...prev };
          entries.forEach((e: any) => (next[e.userId] = e));
          return next;
        });
      }
    },
    onNewMessage: (msg) => {
      if (msg.roomId === roomId) setMessages(prev => [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
    },
    onReactionUpdate: applyReactionUpdate,
    onStreamOffer: async (from, sdp) => { await handleOffer(from, sdp); },
    onStreamAnswer: async (from, sdp) => { await handleAnswer(from, sdp); },
    onIceCandidate: async (from, candidate) => { await handleIceCandidate(from, candidate); },
  });

  const { remoteStreams, isSharing, startSharing, stopSharing, handleOffer, handleAnswer, handleIceCandidate, sendOffer, cleanup } = useWebRTC(
    send,
    () => { isSharingRef.current = true; send({ type: "presence", speaking: false, streaming: true }); },
    () => { isSharingRef.current = false; send({ type: "presence", speaking: false, streaming: false }); },
  );

  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { if (isConnected && roomId) send({ type: "join_room", roomId }); }, [isConnected, roomId, send]);
  useEffect(() => () => { cleanup(); stopDetection(); }, [cleanup, stopDetection]);

  const handleStartShare = async () => {
    await startSharing(roomId);
    if (members && me) members.forEach(m => { if (m.id !== me.id) sendOffer(m.id); });
  };

  const handleSendMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    sendMessage.mutate({ roomId, data: { content: msgInput } });
    setMsgInput("");
  };

  const handleToggleReaction = useCallback((messageId: number, emoji: string) => {
    if (!me) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      const reactions: any[] = m.reactions ?? [];
      const group = reactions.find((r: any) => r.emoji === emoji);
      if (group) {
        if ((group.userIds as number[]).includes(me.id)) {
          const newCount = group.count - 1;
          if (newCount === 0) return { ...m, reactions: reactions.filter((r: any) => r.emoji !== emoji) };
          return { ...m, reactions: reactions.map((r: any) => r.emoji === emoji ? { ...r, count: newCount, userIds: r.userIds.filter((id: number) => id !== me.id) } : r) };
        } else {
          return { ...m, reactions: reactions.map((r: any) => r.emoji === emoji ? { ...r, count: r.count + 1, userIds: [...r.userIds, me.id] } : r) };
        }
      } else {
        return { ...m, reactions: [...reactions, { emoji, count: 1, userIds: [me.id] }] };
      }
    }));
    toggleReactionMutation.mutate({ roomId, messageId, data: { emoji } });
  }, [me, roomId, toggleReactionMutation]);

  const copyCode = useCallback(() => {
    if (!room) return;
    navigator.clipboard.writeText(room.inviteCode).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [room]);

  if (!me || !room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center font-mono text-primary text-xs tracking-widest">
        CONNECTING TO NODE...
      </div>
    );
  }

  const activeStream = viewingStreamOf ? remoteStreams[viewingStreamOf] : null;
  const viewingUser = members?.find(m => m.id === viewingStreamOf);

  return (
    <div className="h-[100dvh] bg-background flex items-center justify-center relative overflow-hidden">

      {/* ── Compact Panel ── */}
      <div className="w-[360px] h-[620px] flex flex-col bg-card border border-border/60 rounded-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground -ml-1" asChild>
              <Link href="/rooms"><ChevronLeft className="w-3.5 h-3.5" /></Link>
            </Button>
            <span className="font-mono text-sm font-bold text-foreground tracking-wide">{room.name}</span>
            <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isConnected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-muted-foreground/40"}`} />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleMic}
              title={micPermission === false ? "Mic permission denied" : micActive ? "Mute mic" : "Activate mic"}
              className={`p-1.5 rounded-sm transition-colors ${micActive ? (localSpeaking ? "text-green-400" : "text-primary/70") : "text-muted-foreground hover:text-foreground"}`}
            >
              {micActive ? <Mic className={`w-3.5 h-3.5 ${localSpeaking ? "animate-pulse" : ""}`} /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={isSharing ? stopSharing : handleStartShare}
              title={isSharing ? "Stop sharing" : "Share screen"}
              className={`p-1.5 rounded-sm transition-colors ${isSharing ? "text-primary animate-pulse" : "text-muted-foreground hover:text-foreground"}`}
            >
              <MonitorUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowInvite(true)}
              className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Friends */}
        <div className="shrink-0 px-4 pt-3 pb-1">
          <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-2">Friends</p>
          <div className="space-y-0.5">
            {members?.map(member => {
              const isMe = member.id === me.id;
              const p = presence[member.id];
              const online = isMe ? isConnected : p?.online;
              const speaking = isMe ? localSpeaking : p?.speaking;
              const streaming = isMe ? isSharing : p?.streaming;
              const initials = member.username.substring(0, 2).toUpperCase();

              return (
                <div key={member.id} className="flex items-center gap-2.5 py-1.5 px-1 rounded-sm hover:bg-muted/20 transition-colors group">
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-muted/50 border border-border/40 flex items-center justify-center">
                      <span className="font-mono text-[11px] font-bold text-foreground/80">{initials}</span>
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card transition-colors ${online ? "bg-green-400" : "bg-muted-foreground/30"}`} />
                    {speaking && <div className="absolute -inset-1 rounded-full border border-green-400/50 animate-ping" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-sans text-sm truncate leading-none ${isMe ? "font-semibold text-foreground" : "text-foreground/90"}`}>
                      {member.username}{isMe && " (You)"}
                    </p>
                    <p className={`text-[11px] font-mono mt-0.5 leading-none ${speaking ? "text-green-400" : streaming ? "text-primary" : online ? "text-muted-foreground/60" : "text-muted-foreground/30"}`}>
                      {speaking ? "Speaking" : streaming ? "Streaming" : online ? "Online" : "Offline"}
                    </p>
                  </div>
                  {streaming && !isMe && (
                    <button
                      onClick={() => { setViewingStreamOf(member.id); streamWindow.setPos({ x: Math.min(380, window.innerWidth - 440), y: 80 }); }}
                      className="p-1 rounded-sm text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                      title={`Watch ${member.username}'s stream`}
                    >
                      <MonitorUp className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {speaking && (
                    <div className="flex items-end gap-px shrink-0">
                      {[3, 5, 4, 6, 3].map((h, i) => (
                        <div key={i} className="w-0.5 bg-green-400 rounded-full animate-pulse" style={{ height: `${h}px`, animationDelay: `${i * 100}ms` }} />
                      ))}
                    </div>
                  )}
                  {streaming && isMe && <MonitorUp className="w-3.5 h-3.5 text-primary/60 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-4 border-t border-border/20 my-1 shrink-0" />

        {/* Chat */}
        <div className="flex-1 flex flex-col min-h-0 px-4 pt-1 pb-0">
          <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1.5 shrink-0">Chat</p>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5 pr-2 pb-2">
              {messages.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground/40 text-center py-4">No messages yet</p>
              )}
              {messages.map(msg => {
                const isHovered = hoveredMsgId === msg.id;
                const reactions: any[] = msg.reactions ?? [];
                return (
                  <div
                    key={msg.id}
                    className="group/msg relative rounded-sm px-1 py-1 -mx-1 hover:bg-muted/10 transition-colors"
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}
                  >
                    <div className="flex items-start gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0 mt-0.5 w-10 text-right">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`font-mono text-[11px] font-semibold mr-1.5 ${getUserColor(msg.userId)}`}>{msg.username}</span>
                        <span className="font-sans text-sm text-foreground/90 break-words">{msg.content}</span>
                      </div>
                    </div>

                    {/* Emoji picker — shown on hover */}
                    {isHovered && (
                      <div className="flex items-center gap-0.5 mt-1 ml-12 flex-wrap">
                        {QUICK_REACTIONS.map(emoji => (
                          <button
                            key={emoji}
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            className="text-sm leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-primary/10 hover:scale-125 transition-all"
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Reaction pills */}
                    {reactions.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1 ml-12">
                        {reactions.map((r: any) => {
                          const isMine = (r.userIds as number[]).includes(me.id);
                          return (
                            <button
                              key={r.emoji}
                              onClick={() => handleToggleReaction(msg.id, r.emoji)}
                              className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                                isMine
                                  ? "border-primary/50 bg-primary/10 text-primary"
                                  : "border-border/40 bg-muted/20 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                              }`}
                              title={isMine ? `Remove ${r.emoji}` : `React with ${r.emoji}`}
                            >
                              <span>{r.emoji}</span>
                              <span className="font-mono text-[10px] ml-0.5">{r.count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Message Input */}
        <div className="px-4 py-3 border-t border-border/20 shrink-0">
          <form onSubmit={handleSendMsg} className="flex gap-2">
            <Input
              value={msgInput}
              onChange={e => setMsgInput(e.target.value)}
              placeholder="Message..."
              disabled={!isConnected}
              className="h-8 text-sm bg-background/60 border-border/40 focus-visible:ring-primary/50 rounded-sm font-sans"
            />
            <Button type="submit" size="sm" disabled={!msgInput.trim() || !isConnected} className="h-8 px-4 rounded-sm font-mono text-xs uppercase shrink-0">
              Send
            </Button>
          </form>
        </div>
      </div>

      {/* ── Floating Stream Window ── */}
      {viewingStreamOf && (
        <div
          className="fixed z-50 w-[420px] rounded-lg overflow-hidden border border-primary/30 shadow-2xl bg-black"
          style={{ left: streamWindow.pos.x, top: streamWindow.pos.y }}
        >
          <div
            className="flex items-center justify-between px-3 py-2 bg-card/95 border-b border-border/30 cursor-grab active:cursor-grabbing select-none"
            onPointerDown={streamPinned ? undefined : streamWindow.onPointerDown}
            onPointerMove={streamPinned ? undefined : streamWindow.onPointerMove}
            onPointerUp={streamPinned ? undefined : streamWindow.onPointerUp}
          >
            <div className="flex items-center gap-2">
              <MonitorUp className="w-3.5 h-3.5 text-primary/70" />
              <span className="font-mono text-xs text-foreground/80 uppercase tracking-wide">
                {viewingUser?.username} is streaming
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setStreamPinned(p => !p)} className={`p-1 rounded-sm transition-colors ${streamPinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`} title={streamPinned ? "Unpin" : "Pin window"}>
                {streamPinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
              </button>
              <button onClick={() => setStreamMuted(m => !m)} className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
                {streamMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
              <button onClick={() => setViewingStreamOf(null)} className="p-1 rounded-sm text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="aspect-video">
            {activeStream ? (
              <StreamVideo stream={activeStream} muted={streamMuted} />
            ) : (
              <div className="w-full h-full bg-black flex flex-col items-center justify-center text-primary/40 font-mono text-xs gap-2">
                <MonitorUp className="w-8 h-8 opacity-40" />
                <span>Waiting for signal...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Invite Modal ── */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="bg-card border-primary/30 rounded-sm max-w-sm p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-primary/20">
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-primary flex items-center gap-2">
              <Share2 className="w-4 h-4" /> Invite to {room.name}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-3">Access Code</p>
              <div className="font-mono text-4xl font-bold text-primary tracking-[0.3em] select-all bg-background border border-primary/20 rounded-sm px-6 py-4 shadow-[0_0_20px_rgba(0,229,255,0.1)]">
                {room.inviteCode}
              </div>
            </div>
            <p className="font-mono text-xs text-muted-foreground text-center leading-relaxed">
              Share this code with your crew.<br />They can enter it on the rooms screen to join.
            </p>
            <Button className="w-full font-mono uppercase tracking-widest rounded-sm gap-2" onClick={copyCode}>
              {codeCopied ? <><Check className="w-4 h-4" /> Copied to Clipboard</> : <><Copy className="w-4 h-4" /> Copy Code</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
