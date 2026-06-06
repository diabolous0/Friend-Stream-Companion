import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetRoom, getGetRoomQueryKey,
  useGetRoomMembers, getGetRoomMembersQueryKey,
  useGetRoomPresence, getGetRoomPresenceQueryKey,
  useGetRoomMessages, getGetRoomMessagesQueryKey,
  getRoomMessages,
  useSendMessage, useToggleReaction,
  useUpdateRoom, useLeaveRoom,
  useEditMessage, useDeleteMessage,
  useGetMe
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { useSounds } from "@/hooks/use-sounds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MonitorUp, Volume2, VolumeX, ChevronLeft, Mic, MicOff,
  Share2, Copy, Check, Pin, PinOff, X, Settings, Search,
  LogOut, Phone, PhoneOff, Headphones, Pencil, Trash2, Bell,
} from "lucide-react";

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "👀", "😮", "🎉", "💀"];
const USER_COLORS = [
  "text-cyan-400", "text-violet-400", "text-green-400", "text-orange-400",
  "text-pink-400", "text-yellow-400", "text-blue-400", "text-rose-400",
];
function getUserColor(userId: number) { return USER_COLORS[userId % USER_COLORS.length]; }

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts: React.ReactNode[] = [];
  const lc = text.toLowerCase(), lq = query.toLowerCase();
  let start = 0, idx = lc.indexOf(lq, 0);
  while (idx !== -1) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(<mark key={idx} className="bg-primary/30 text-foreground not-italic rounded-sm px-0">{text.slice(idx, idx + query.length)}</mark>);
    start = idx + query.length;
    idx = lc.indexOf(lq, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return <>{parts}</>;
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

function AudioPlayer({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export default function Room() {
  const [, params] = useRoute("/room/:roomId");
  const roomId = params?.roomId ? parseInt(params.roomId, 10) : 0;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe();
  const { data: room } = useGetRoom(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomQueryKey(roomId) } });
  const { data: members } = useGetRoomMembers(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMembersQueryKey(roomId) } });
  const { data: initialPresence } = useGetRoomPresence(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomPresenceQueryKey(roomId) } });
  const { data: initialMessages } = useGetRoomMessages(roomId, undefined, { query: { enabled: !!roomId, queryKey: getGetRoomMessagesQueryKey(roomId) } });

  const sendMessageMutation = useSendMessage();
  const toggleReactionMutation = useToggleReaction();
  const updateRoomMutation = useUpdateRoom();
  const leaveRoomMutation = useLeaveRoom();
  const editMessageMutation = useEditMessage();
  const deleteMessageMutation = useDeleteMessage();

  // ─── Core state ────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, any>>({});
  const [msgInput, setMsgInput] = useState("");
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, string>>({});

  // ─── Search ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── Pagination ────────────────────────────────────────────────────────────
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // ─── Edit / delete ─────────────────────────────────────────────────────────
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  // ─── Sounds ────────────────────────────────────────────────────────────────
  const [soundsMuted, setSoundsMuted] = useState(false);
  const { playMessage, playReaction, playJoin } = useSounds(soundsMuted);

  // ─── Notifications ─────────────────────────────────────────────────────────
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const notifPermRef = useRef<NotificationPermission>("default");

  // ─── Settings / invite ─────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // ─── Stream window ─────────────────────────────────────────────────────────
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [viewingStreamOf, setViewingStreamOf] = useState<number | null>(null);
  const [streamMuted, setStreamMuted] = useState(false);
  const [streamPinned, setStreamPinned] = useState(false);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<((msg: any) => void) | null>(null);
  const isSharingRef = useRef(false);
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOnlineRef = useRef<Set<number>>(new Set());
  const presenceRef = useRef<Record<number, any>>({});

  const streamWindow = useDraggable({ x: Math.min(420, window.innerWidth - 440), y: 80 });

  // ─── Presence ref sync ─────────────────────────────────────────────────────
  useEffect(() => { presenceRef.current = presence; }, [presence]);

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (roomId) localStorage.setItem(`screencrew_visited_${roomId}`, new Date().toISOString());
  }, [roomId]);

  useEffect(() => {
    if (initialMessages) { setMessages(initialMessages); setHasMore(initialMessages.length >= 50); }
  }, [initialMessages]);

  useEffect(() => {
    if (initialPresence) {
      const map: Record<number, any> = {};
      initialPresence.forEach((p: any) => (map[p.userId] = p));
      setPresence(map);
      prevOnlineRef.current = new Set(initialPresence.filter((p: any) => p.online).map((p: any) => p.userId as number));
    }
  }, [initialPresence]);

  useEffect(() => { if (room) setRenameValue(room.name); }, [room]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPermission(Notification.permission);
      notifPermRef.current = Notification.permission;
    }
  }, []);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") { e.preventDefault(); setShowSearch(true); }
      if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ─── Voice activity ────────────────────────────────────────────────────────
  const handleSpeakingChange = useCallback((speaking: boolean) => {
    setLocalSpeaking(speaking);
    sendRef.current?.({ type: "presence", speaking, streaming: isSharingRef.current, inVoice: false });
  }, []);

  const { isActive: micActive, startDetection, stopDetection } = useVoiceActivity({
    onSpeakingChange: handleSpeakingChange, threshold: 12, silenceDelay: 500,
  });

  const toggleMic = useCallback(async () => {
    if (micActive) { stopDetection(); sendRef.current?.({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: false }); }
    else await startDetection();
  }, [micActive, startDetection, stopDetection]);

  // ─── Typing ────────────────────────────────────────────────────────────────
  const sendTypingStop = useCallback(() => {
    if (typingStopTimerRef.current) { clearTimeout(typingStopTimerRef.current); typingStopTimerRef.current = null; }
    if (isTypingRef.current) { isTypingRef.current = false; sendRef.current?.({ type: "typing", isTyping: false }); }
  }, []);

  const handleMsgInputChange = useCallback((value: string) => {
    setMsgInput(value);
    if (!value.trim()) { sendTypingStop(); return; }
    if (!isTypingRef.current) { isTypingRef.current = true; sendRef.current?.({ type: "typing", isTyping: true }); }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(sendTypingStop, 4000);
  }, [sendTypingStop]);

  // ─── Reactions ─────────────────────────────────────────────────────────────
  const applyReactionUpdate = useCallback((messageId: number, reactions: any[]) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    playReaction();
  }, [playReaction]);

  // ─── WebRTC ────────────────────────────────────────────────────────────────
  const {
    remoteStreams, remoteAudioStreams,
    isSharing, isInVoice,
    startSharing, stopSharing,
    handleOffer, handleAnswer, handleIceCandidate, sendOffer,
    joinVoice, leaveVoice,
    sendAudioOffer, handleAudioOffer, handleAudioAnswer, handleAudioIce,
    cleanup,
  } = useWebRTC(
    (msg) => sendRef.current?.(msg),
    () => { isSharingRef.current = true; sendRef.current?.({ type: "presence", speaking: false, streaming: true, inVoice: isInVoice }); },
    () => { isSharingRef.current = false; sendRef.current?.({ type: "presence", speaking: false, streaming: false, inVoice: isInVoice }); },
  );

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  const { isConnected, send } = useWebSocket({
    onPresenceUpdate: (rid, entries) => {
      if (rid !== roomId) return;
      const voiceOfferTargets: number[] = [];
      let doPlayJoin = false;
      setPresence(prev => {
        const next = { ...prev };
        entries.forEach((e: any) => {
          const wasOnline = prevOnlineRef.current.has(e.userId);
          if (e.online && !wasOnline && e.userId !== me?.id) doPlayJoin = true;
          if (e.online) prevOnlineRef.current.add(e.userId); else prevOnlineRef.current.delete(e.userId);
          if (e.inVoice && !prev[e.userId]?.inVoice && e.userId !== me?.id && isInVoice) voiceOfferTargets.push(e.userId);
          next[e.userId] = e;
        });
        return next;
      });
      if (doPlayJoin) playJoin();
      voiceOfferTargets.forEach(id => sendAudioOffer(id));
    },
    onNewMessage: (msg) => {
      if (msg.roomId !== roomId) return;
      setMessages(prev => [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
      if (msg.userId !== me?.id) {
        playMessage();
        if (document.visibilityState === "hidden" && notifPermRef.current === "granted") {
          new Notification(msg.username, {
            body: msg.content,
            tag: `screencrew-room-${roomId}`,
            silent: true,
          });
        }
      }
    },
    onReactionUpdate: applyReactionUpdate,
    onTypingUpdate: (userId, username, isTyping) => {
      setTypingUsers(prev => {
        if (isTyping) return { ...prev, [userId]: username };
        const next = { ...prev }; delete next[userId]; return next;
      });
    },
    onMessageUpdated: (msg) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...msg } : m));
    },
    onMessageDeleted: (messageId) => {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    },
    onStreamOffer: async (from, sdp) => { await handleOffer(from, sdp); },
    onStreamAnswer: async (from, sdp) => { await handleAnswer(from, sdp); },
    onIceCandidate: async (from, candidate) => { await handleIceCandidate(from, candidate); },
    onAudioOffer: async (from, sdp) => { await handleAudioOffer(from, sdp); },
    onAudioAnswer: async (from, sdp) => { await handleAudioAnswer(from, sdp); },
    onAudioIce: async (from, candidate) => { await handleAudioIce(from, candidate); },
  });

  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { if (isConnected && roomId) send({ type: "join_room", roomId }); }, [isConnected, roomId, send]);
  useEffect(() => () => { cleanup(); stopDetection(); }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleStartShare = async () => {
    await startSharing(roomId);
    if (members && me) members.forEach(m => { if (m.id !== me.id) sendOffer(m.id); });
  };

  const handleSendMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    sendTypingStop();
    sendMessageMutation.mutate({ roomId, data: { content: msgInput } });
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
        }
        return { ...m, reactions: reactions.map((r: any) => r.emoji === emoji ? { ...r, count: r.count + 1, userIds: [...r.userIds, me.id] } : r) };
      }
      return { ...m, reactions: [...reactions, { emoji, count: 1, userIds: [me.id] }] };
    }));
    toggleReactionMutation.mutate({ roomId, messageId, data: { emoji } });
  }, [me, roomId, toggleReactionMutation]);

  const loadMoreMessages = useCallback(async () => {
    if (!messages.length || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const oldest = messages[0].id;
      const older = await getRoomMessages(roomId, { before: oldest, limit: 50 });
      if (!older || older.length < 50) setHasMore(false);
      if (older && older.length > 0) setMessages(prev => [...older, ...prev]);
    } finally {
      setLoadingMore(false);
    }
  }, [messages, loadingMore, hasMore, roomId]);

  const handleEditMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMsgId || !editContent.trim()) return;
    editMessageMutation.mutate(
      { roomId, messageId: editingMsgId, data: { content: editContent } },
      { onSuccess: () => { setEditingMsgId(null); setEditContent(""); } }
    );
  };

  const handleDeleteMsg = useCallback((messageId: number) => {
    deleteMessageMutation.mutate({ roomId, messageId });
  }, [roomId, deleteMessageMutation]);

  const handleJoinVoice = useCallback(async () => {
    const stream = await joinVoice();
    if (!stream) return;
    send({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: true });
    Object.values(presenceRef.current)
      .filter((p: any) => p.inVoice && p.userId !== me?.id)
      .forEach((p: any) => sendAudioOffer(p.userId));
  }, [joinVoice, send, me?.id, sendAudioOffer]);

  const handleLeaveVoice = useCallback(() => {
    leaveVoice();
    send({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: false });
  }, [leaveVoice, send]);

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || renameValue === room?.name) return;
    updateRoomMutation.mutate({ roomId, data: { name: renameValue } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); setShowSettings(false); },
    });
  };

  const handleLeaveRoom = () => {
    leaveRoomMutation.mutate({ roomId }, { onSuccess: () => setLocation("/rooms") });
  };

  const copyCode = useCallback(() => {
    if (!room) return;
    navigator.clipboard.writeText(room.inviteCode).then(() => {
      setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [room]);

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
    notifPermRef.current = perm;
  }, []);

  // ─── Derived ───────────────────────────────────────────────────────────────
  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  if (!me || !room) {
    return <div className="min-h-screen bg-background flex items-center justify-center font-mono text-primary text-xs tracking-widest">CONNECTING TO NODE...</div>;
  }

  const activeStream = viewingStreamOf ? remoteStreams[viewingStreamOf] : null;
  const viewingUser = members?.find(m => m.id === viewingStreamOf);

  return (
    <div className="h-[100dvh] bg-background flex items-center justify-center relative overflow-hidden">

      {/* Hidden audio elements for voice call */}
      <div className="hidden" aria-hidden>
        {Object.entries(remoteAudioStreams).map(([userId, stream]) => (
          <AudioPlayer key={userId} stream={stream} />
        ))}
      </div>

      {/* ── Compact Panel ── */}
      <div className="w-[360px] h-[620px] flex flex-col bg-card border border-border/60 rounded-lg shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm text-muted-foreground hover:text-foreground -ml-1 shrink-0" asChild>
              <Link href="/rooms"><ChevronLeft className="w-3.5 h-3.5" /></Link>
            </Button>
            <span className="font-mono text-sm font-bold text-foreground tracking-wide truncate">{room.name}</span>
            <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isConnected ? "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-muted-foreground/40"}`} />
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={toggleMic} title={micActive ? "Mute mic" : "Activate mic"}
              className={`p-1.5 rounded-sm transition-colors ${micActive ? (localSpeaking ? "text-green-400" : "text-primary/70") : "text-muted-foreground hover:text-foreground"}`}>
              {micActive ? <Mic className={`w-3.5 h-3.5 ${localSpeaking ? "animate-pulse" : ""}`} /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
            <button onClick={isSharing ? stopSharing : handleStartShare} title={isSharing ? "Stop sharing" : "Share screen"}
              className={`p-1.5 rounded-sm transition-colors ${isSharing ? "text-primary animate-pulse" : "text-muted-foreground hover:text-foreground"}`}>
              <MonitorUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={isInVoice ? handleLeaveVoice : handleJoinVoice} title={isInVoice ? "Leave voice call" : "Join voice call"}
              className={`p-1.5 rounded-sm transition-colors ${isInVoice ? "text-violet-400 animate-pulse" : "text-muted-foreground hover:text-foreground"}`}>
              {isInVoice ? <PhoneOff className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => setSoundsMuted(m => !m)} title={soundsMuted ? "Unmute sounds" : "Mute sounds"}
              className={`p-1.5 rounded-sm transition-colors ${soundsMuted ? "text-muted-foreground/40" : "text-muted-foreground hover:text-foreground"}`}>
              {soundsMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <button onClick={notifPermission === "default" ? requestNotifPermission : undefined}
              title={notifPermission === "granted" ? "Notifications on" : notifPermission === "denied" ? "Notifications blocked" : "Enable notifications"}
              className={`p-1.5 rounded-sm transition-colors ${notifPermission === "granted" ? "text-primary/70" : notifPermission === "denied" ? "text-muted-foreground/20" : "text-muted-foreground/50 hover:text-muted-foreground"}`}>
              <Bell className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowInvite(true)} className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowSettings(true)} className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Friends */}
        <div className="shrink-0 px-4 pt-3 pb-1">
          <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-2">Crew</p>
          <div className="space-y-0.5">
            {members?.map(member => {
              const isMe = member.id === me.id;
              const p = presence[member.id];
              const online = isMe ? isConnected : p?.online;
              const speaking = isMe ? localSpeaking : p?.speaking;
              const streaming = isMe ? isSharing : p?.streaming;
              const inVoice = isMe ? isInVoice : p?.inVoice;
              const initials = member.username.substring(0, 2).toUpperCase();
              const statusLabel = speaking ? "Speaking" : streaming ? "Streaming" : inVoice ? "In Voice" : online ? "Online" : "Offline";
              const statusColor = speaking ? "text-green-400" : streaming ? "text-primary" : inVoice ? "text-violet-400" : online ? "text-muted-foreground/60" : "text-muted-foreground/30";
              return (
                <div key={member.id} className="flex items-center gap-2.5 py-1 px-1 rounded-sm hover:bg-muted/20 transition-colors group">
                  <div className="relative shrink-0">
                    <div className="w-8 h-8 rounded-full bg-muted/50 border border-border/40 flex items-center justify-center">
                      <span className="font-mono text-[11px] font-bold text-foreground/80">{initials}</span>
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card transition-colors ${online ? "bg-green-400" : "bg-muted-foreground/30"}`} />
                    {speaking && <div className="absolute -inset-1 rounded-full border border-green-400/50 animate-ping" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className={`font-sans text-sm truncate leading-none ${isMe ? "font-semibold text-foreground" : "text-foreground/90"}`}>
                        {member.username}{isMe && " (You)"}
                      </p>
                      {inVoice && <Headphones className="w-3 h-3 text-violet-400/80 shrink-0" />}
                    </div>
                    <p className={`text-[11px] font-mono mt-0.5 leading-none ${statusColor}`}>{statusLabel}</p>
                  </div>
                  {streaming && !isMe && (
                    <button onClick={() => { setViewingStreamOf(member.id); streamWindow.setPos({ x: Math.min(380, window.innerWidth - 440), y: 80 }); }}
                      className="p-1 rounded-sm text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100">
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
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-4 border-t border-border/20 my-1 shrink-0" />

        {/* Chat header + search toggle */}
        <div className="px-4 pt-1 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
              Chat {searchQuery && filteredMessages.length !== messages.length && (
                <span className="text-primary/70">{filteredMessages.length}/{messages.length}</span>
              )}
            </p>
            <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
              className={`p-1 rounded-sm transition-colors ${showSearch ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
              title="Search messages (/)">
              <Search className="w-3 h-3" />
            </button>
          </div>
          {showSearch && (
            <div className="flex items-center gap-1 mb-1.5">
              <Input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") { setShowSearch(false); setSearchQuery(""); } }}
                placeholder="Search messages…"
                className="h-7 text-xs bg-background/60 border-border/30 focus-visible:ring-primary/40 rounded-sm font-mono flex-1" />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="p-1 text-muted-foreground/50 hover:text-muted-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chat messages */}
        <div className="flex-1 min-h-0 px-4 pb-0">
          <ScrollArea className="h-full">
            <div className="space-y-0.5 pr-2 pb-2">
              {/* Load more */}
              {hasMore && !searchQuery && (
                <button onClick={loadMoreMessages} disabled={loadingMore}
                  className="w-full text-center font-mono text-[10px] text-primary/40 hover:text-primary/70 py-1.5 transition-colors disabled:opacity-40">
                  {loadingMore ? "Loading…" : "↑ Load older messages"}
                </button>
              )}
              {filteredMessages.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground/40 text-center py-4">
                  {searchQuery ? "No messages match" : "No messages yet"}
                </p>
              )}
              {filteredMessages.map(msg => {
                const isHovered = hoveredMsgId === msg.id;
                const isEditing = editingMsgId === msg.id;
                const isOwn = msg.userId === me.id;
                const reactions: any[] = msg.reactions ?? [];
                return (
                  <div key={msg.id}
                    className="group/msg relative rounded-sm px-1 py-1 -mx-1 hover:bg-muted/10 transition-colors"
                    onMouseEnter={() => setHoveredMsgId(msg.id)}
                    onMouseLeave={() => setHoveredMsgId(null)}>
                    <div className="flex items-start gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0 mt-0.5 w-10 text-right">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`font-mono text-[11px] font-semibold mr-1.5 ${getUserColor(msg.userId)}`}>{msg.username}</span>
                        {isEditing ? (
                          <form onSubmit={handleEditMsg} className="mt-0.5">
                            <Input value={editContent} onChange={e => setEditContent(e.target.value)}
                              onKeyDown={e => { if (e.key === "Escape") { setEditingMsgId(null); setEditContent(""); } }}
                              className="h-6 text-sm bg-background/80 border-primary/30 rounded-sm focus-visible:ring-primary/40 font-sans"
                              autoFocus />
                            <span className="font-mono text-[9px] text-muted-foreground/30">Enter to save · Esc to cancel</span>
                          </form>
                        ) : (
                          <span className="font-sans text-sm text-foreground/90 break-words">
                            {highlight(msg.content, searchQuery)}
                            {msg.editedAt && <span className="font-mono text-[9px] text-muted-foreground/30 ml-1">(edited)</span>}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Own message actions */}
                    {isOwn && !isEditing && isHovered && (
                      <div className="absolute right-1 top-1 flex items-center gap-0.5 bg-card/95 border border-border/30 rounded-sm px-1 py-0.5">
                        <button onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content); }}
                          className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" title="Edit">
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={() => handleDeleteMsg(msg.id)}
                          className="p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors" title="Delete">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                    {/* Quick reactions */}
                    {isHovered && !isEditing && (
                      <div className="flex items-center gap-0.5 mt-1 ml-12 flex-wrap">
                        {QUICK_REACTIONS.map(emoji => (
                          <button key={emoji} onClick={() => handleToggleReaction(msg.id, emoji)}
                            className="text-sm leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-primary/10 hover:scale-125 transition-all">
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Reaction bubbles */}
                    {reactions.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1 ml-12">
                        {reactions.map((r: any) => {
                          const isMine = (r.userIds as number[]).includes(me.id);
                          return (
                            <button key={r.emoji} onClick={() => handleToggleReaction(msg.id, r.emoji)}
                              className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${isMine ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-muted/20 text-muted-foreground hover:border-primary/30"}`}>
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

        {/* Typing indicator */}
        {(() => {
          const names = Object.entries(typingUsers).filter(([uid]) => Number(uid) !== me.id).map(([, n]) => n);
          if (!names.length) return null;
          const label = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : `${names[0]} and ${names.length - 1} others are typing`;
          return (
            <div className="px-4 pb-1 shrink-0 flex items-center gap-1.5">
              <div className="flex gap-0.5 items-end">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1 h-1 rounded-full bg-primary/50"
                    style={{ animation: "typing-bounce 1s ease-in-out infinite", animationDelay: `${i * 200}ms` }} />
                ))}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/50 truncate">{label}</span>
            </div>
          );
        })()}

        {/* Message input */}
        <div className="px-4 py-3 border-t border-border/20 shrink-0">
          <form onSubmit={handleSendMsg} className="flex gap-2">
            <Input value={msgInput} onChange={e => handleMsgInputChange(e.target.value)}
              placeholder="Message…" disabled={!isConnected}
              className="h-8 text-sm bg-background/60 border-border/40 focus-visible:ring-primary/50 rounded-sm font-sans" />
            <Button type="submit" size="sm" disabled={!msgInput.trim() || !isConnected}
              className="h-8 px-4 rounded-sm font-mono text-xs uppercase shrink-0">Send</Button>
          </form>
        </div>
      </div>

      {/* ── Floating Stream Window ── */}
      {viewingStreamOf && (
        <div className="fixed z-50 w-[420px] rounded-lg overflow-hidden border border-primary/30 shadow-2xl bg-black"
          style={{ left: streamWindow.pos.x, top: streamWindow.pos.y }}>
          <div className="flex items-center justify-between px-3 py-2 bg-card/95 border-b border-border/30 cursor-grab active:cursor-grabbing select-none"
            onPointerDown={streamPinned ? undefined : streamWindow.onPointerDown}
            onPointerMove={streamPinned ? undefined : streamWindow.onPointerMove}
            onPointerUp={streamPinned ? undefined : streamWindow.onPointerUp}>
            <div className="flex items-center gap-2">
              <MonitorUp className="w-3.5 h-3.5 text-primary/70" />
              <span className="font-mono text-xs text-foreground/80 uppercase tracking-wide">{viewingUser?.username} is streaming</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setStreamPinned(p => !p)} className={`p-1 rounded-sm transition-colors ${streamPinned ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
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
            {activeStream ? <StreamVideo stream={activeStream} muted={streamMuted} /> : (
              <div className="w-full h-full bg-black flex flex-col items-center justify-center text-primary/40 font-mono text-xs gap-2">
                <MonitorUp className="w-8 h-8 opacity-40" />
                <span>Waiting for signal…</span>
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
              Share this code with your crew.<br />They enter it on the rooms screen to join.
            </p>
            <Button className="w-full font-mono uppercase tracking-widest rounded-sm gap-2" onClick={copyCode}>
              {codeCopied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Code</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Settings Modal ── */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="bg-card border-primary/30 rounded-sm max-w-sm p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-primary/20">
            <DialogTitle className="font-mono text-sm uppercase tracking-widest text-primary flex items-center gap-2">
              <Settings className="w-4 h-4" /> Room Settings
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-6 space-y-6">
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-3">Rename Room</p>
              <form onSubmit={handleRename} className="flex gap-2">
                <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} placeholder="Room name"
                  className="h-9 font-mono text-sm rounded-sm bg-background border-border/40 focus-visible:ring-primary/50 flex-1" />
                <Button type="submit" size="sm" className="h-9 px-4 rounded-sm font-mono text-xs uppercase shrink-0"
                  disabled={updateRoomMutation.isPending || !renameValue.trim() || renameValue === room.name}>
                  {updateRoomMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </form>
            </div>
            <div className="border-t border-border/20" />
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-3">Danger Zone</p>
              {!showLeaveConfirm ? (
                <Button variant="outline" className="w-full rounded-sm font-mono text-xs uppercase border-destructive/30 text-destructive hover:bg-destructive/10 gap-2"
                  onClick={() => setShowLeaveConfirm(true)}>
                  <LogOut className="w-3.5 h-3.5" /> Leave Room
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="font-mono text-xs text-muted-foreground text-center">You'll need the invite code to rejoin.</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 rounded-sm font-mono text-xs" onClick={() => setShowLeaveConfirm(false)}>Cancel</Button>
                    <Button size="sm" className="flex-1 rounded-sm font-mono text-xs uppercase bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                      onClick={handleLeaveRoom} disabled={leaveRoomMutation.isPending}>
                      {leaveRoomMutation.isPending ? "Leaving…" : "Confirm"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
