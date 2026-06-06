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
  useGetMe,
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
  MonitorUp, Mic, MicOff, Phone, PhoneOff, Headphones,
  Plus, Bell, VolumeX, Volume2,
  Pin, PinOff, X, Settings, Search,
  Users, MessageSquare, Pencil, Trash2, Smile,
  Copy, Check, Share2, ChevronLeft, ExternalLink, Maximize2,
  Paperclip, Loader2,
} from "lucide-react";
import { useSettings } from "@/lib/settings";
import { ThemeToggle } from "@/lib/theme";
import { SettingsModal } from "@/components/settings-modal";
import { ChatPopout } from "@/components/chat-popout";
import { MentionInput, type MentionInputHandle } from "@/components/mention-input";
import { MessageContent, containsMention } from "@/lib/markdown";
import { useUpload } from "@/hooks/use-upload";

// ─── Constants ───────────────────────────────────────────────────────────────

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "👀", "😮", "🎉", "💀"];

// ─── Overlay helpers ──────────────────────────────────────────────────────────
function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.split("+");
  const code = parts[parts.length - 1];
  const ctrl = parts.includes("Ctrl");
  const alt = parts.includes("Alt");
  const shift = parts.includes("Shift");
  return e.code === code && e.ctrlKey === ctrl && e.altKey === alt && e.shiftKey === shift && !e.metaKey;
}

function fmtHotkey(hotkey: string): string {
  return hotkey.split("+").map(p => {
    if (p === "Ctrl") return "⌃";
    if (p === "Alt") return "⌥";
    if (p === "Shift") return "⇧";
    if (p === "Insert") return "Ins";
    if (p === "Backquote") return "`";
    if (/^Key[A-Z]$/.test(p)) return p.slice(3);
    if (/^Digit[0-9]$/.test(p)) return p.slice(5);
    return p;
  }).join("");
}

const AVATAR_BG = [
  "bg-violet-600", "bg-blue-500", "bg-emerald-600", "bg-orange-500",
  "bg-pink-600", "bg-amber-500", "bg-cyan-600", "bg-rose-600",
];
const CHAT_COLORS = [
  "text-violet-400", "text-blue-400", "text-emerald-400", "text-orange-400",
  "text-pink-400", "text-amber-400", "text-cyan-400", "text-rose-400",
];

function avatarBg(userId: number) { return AVATAR_BG[userId % AVATAR_BG.length]; }
function chatColor(userId: number) { return CHAT_COLORS[userId % CHAT_COLORS.length]; }

// ─── Helper components ───────────────────────────────────────────────────────

function Avatar({ username, userId, size = 36, square = false }: { username: string; userId: number; size?: number; square?: boolean }) {
  return (
    <div className={`${avatarBg(userId)} ${square ? "rounded-sm" : "rounded-full"} flex items-center justify-center text-white font-bold select-none shrink-0`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}>
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}

function Waveform() {
  return (
    <div className="flex items-end gap-px shrink-0">
      {[3, 5, 7, 5, 3, 6, 4].map((h, i) => (
        <div key={i} className="w-0.5 bg-green-400 rounded-full"
          style={{ height: h, animation: "waveform 0.8s ease-in-out infinite", animationDelay: `${i * 80}ms` }} />
      ))}
    </div>
  );
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
      x: Math.max(0, Math.min(window.innerWidth - 460, dragRef.current.px + e.clientX - dragRef.current.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 280, dragRef.current.py + e.clientY - dragRef.current.sy)),
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

// ─── Room page ────────────────────────────────────────────────────────────────

export default function Room() {
  const [, params] = useRoute("/room/:roomId");
  const roomId = params?.roomId ? parseInt(params.roomId, 10) : 0;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { settings, set: setSetting } = useSettings();
  const classic = settings.uiTheme === "classic";

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

  // ─── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, any>>({});
  const [msgInput, setMsgInput] = useState("");
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<number, string>>({});
  const [reads, setReads] = useState<Record<number, number>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const msgInputRef = useRef<MentionInputHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { playMessage, playReaction, playJoin } = useSounds(!settings.soundEnabled);

  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const notifPermRef = useRef<NotificationPermission>("default");

  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [viewingStreamOf, setViewingStreamOf] = useState<number | null>(null);
  const [streamMuted, setStreamMuted] = useState(false);
  const [streamPinned, setStreamPinned] = useState(false);

  const [overlayMode, setOverlayMode] = useState(false);
  const [unreadOverlay, setUnreadOverlay] = useState(0);
  const [pillPos, setPillPos] = useState(() => settings.overlayPillPos);
  const pillDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const prevMsgCountRef = useRef(0);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<((msg: any) => void) | null>(null);
  const isSharingRef = useRef(false);
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOnlineRef = useRef<Set<number>>(new Set());
  const presenceRef = useRef<Record<number, any>>({});
  const streamWindow = useDraggable({ x: 360, y: 60 });

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

  const lastMsgId = messages.length ? messages[messages.length - 1].id : null;

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setNotifPermission(Notification.permission);
      notifPermRef.current = Notification.permission;
    }
  }, []);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  // ─── Voice activity ─────────────────────────────────────────────────────────
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
        const mentioned = me?.username ? containsMention(msg.content, me.username) : false;
        if (notifPermRef.current === "granted" && (document.visibilityState === "hidden" || mentioned)) {
          new Notification(mentioned ? `${msg.username} mentioned you` : msg.username, {
            body: msg.content, tag: `screencrew-room-${roomId}`, silent: !mentioned,
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
    onReadsSnapshot: (rs) => {
      const map: Record<number, number> = {};
      rs.forEach(r => { map[r.userId] = r.lastReadMessageId; });
      setReads(map);
    },
    onReadUpdate: (userId, lastReadMessageId) => {
      setReads(prev => (prev[userId] ?? 0) >= lastReadMessageId ? prev : { ...prev, [userId]: lastReadMessageId });
    },
    onMessageUpdated: (msg) => { setMessages(prev => prev.map(m => m.id === msg.id ? { ...msg } : m)); },
    onMessageDeleted: (messageId) => { setMessages(prev => prev.filter(m => m.id !== messageId)); },
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

  // ─── Read receipts ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isConnected || !roomId || lastMsgId == null) return;
    if (document.visibilityState !== "visible" || overlayMode) return;
    sendRef.current?.({ type: "read", messageId: lastMsgId });
  }, [isConnected, roomId, lastMsgId, overlayMode]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && !overlayMode && lastMsgId != null) {
        sendRef.current?.({ type: "read", messageId: lastMsgId });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lastMsgId, overlayMode]);
  useEffect(() => () => { cleanup(); stopDetection(); }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleStartShare = async () => {
    await startSharing(roomId);
    if (members && me) members.forEach(m => { if (m.id !== me.id) sendOffer(m.id); });
  };

  const handleSendMsg = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!msgInput.trim()) return;
    sendTypingStop();
    sendMessageMutation.mutate({ roomId, data: { content: msgInput } });
    setMsgInput("");
  };

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (r) => {
      const isImage = r.contentType.startsWith("image/");
      const token = isImage
        ? `[screencrew:image:${r.objectPath}]`
        : `[screencrew:file:${r.objectPath}:${r.name}]`;
      sendMessageMutation.mutate({ roomId, data: { content: token } });
    },
  });

  const handleFiles = useCallback((files: File[]) => {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) continue;
      void uploadFile(file);
    }
  }, [uploadFile]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setIsDragging(true); }
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

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
      const older = await getRoomMessages(roomId, { before: messages[0].id, limit: 50 });
      if (!older || older.length < 50) setHasMore(false);
      if (older?.length) setMessages(prev => [...older, ...prev]);
    } finally { setLoadingMore(false); }
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

  const handleRenameByName = (name: string) => {
    if (!name.trim() || name === room?.name) return;
    updateRoomMutation.mutate({ roomId, data: { name } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); setShowSettings(false); },
    });
  };

  const handleLeaveRoom = () => {
    leaveRoomMutation.mutate({ roomId }, { onSuccess: () => setLocation("/rooms") });
  };

  const requestNotifPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm); notifPermRef.current = perm;
  }, []);

  const copyCode = useCallback(() => {
    if (!room) return;
    navigator.clipboard.writeText(room.inviteCode).then(() => {
      setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
    });
  }, [room]);

  // ─── Overlay hotkey ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (matchesHotkey(e, settings.overlayHotkey)) {
        e.preventDefault();
        setOverlayMode(m => !m);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [settings.overlayHotkey]);

  useEffect(() => {
    if (overlayMode && messages.length > prevMsgCountRef.current) {
      setUnreadOverlay(u => u + (messages.length - prevMsgCountRef.current));
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, overlayMode]);

  useEffect(() => {
    if (!overlayMode) setUnreadOverlay(0);
  }, [overlayMode]);

  const pillOnPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pillDragRef.current = { sx: e.clientX, sy: e.clientY, px: pillPos.x, py: pillPos.y };
  }, [pillPos]);

  const pillOnPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!pillDragRef.current) return;
    setPillPos({
      x: Math.max(0, Math.min(window.innerWidth - 220, pillDragRef.current.px + e.clientX - pillDragRef.current.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 40,  pillDragRef.current.py + e.clientY - pillDragRef.current.sy)),
    });
  }, []);

  const pillOnPointerUp = useCallback(() => {
    pillDragRef.current = null;
    setSetting("overlayPillPos", pillPos);
  }, [pillPos, setSetting]);

  // ─── Derived ───────────────────────────────────────────────────────────────
  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const typingNames = Object.entries(typingUsers)
    .filter(([uid]) => Number(uid) !== me?.id)
    .map(([, n]) => n);

  const onlineCount = Object.values(presence).filter((p: any) => p?.online).length;

  if (!me || !room) {
    return (
      <div className="h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const activeStream = viewingStreamOf ? remoteStreams[viewingStreamOf] : null;
  const viewingUser = members?.find(m => m.id === viewingStreamOf);

  const readersByMessage: Record<number, { id: number; username: string }[]> = {};
  if (members) {
    for (const member of members) {
      if (member.id === me.id) continue;
      const rid = reads[member.id];
      if (rid == null) continue;
      (readersByMessage[rid] ??= []).push(member);
    }
  }

  return (
    <div className={`h-[100dvh] flex items-center justify-center relative overflow-hidden transition-colors ${overlayMode ? "bg-transparent" : "bg-background"}`}>

      {/* Hidden audio for voice calls */}
      <div className="hidden" aria-hidden>
        {Object.entries(remoteAudioStreams).map(([uid, stream]) => (
          <AudioPlayer key={uid} stream={stream} />
        ))}
      </div>

      {/* ── Main Panel ── */}
      <div className={`relative w-[320px] h-[580px] flex flex-col bg-card border shadow-2xl overflow-hidden transition-all ${classic ? "rounded-sm border-primary/20" : "rounded-2xl border-border/50"} ${overlayMode ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"}`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={settings.panelOpacity < 100 ? {
          backgroundColor: `hsl(var(--card) / ${settings.panelOpacity}%)`,
          ...(settings.blurBackground ? { backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as React.CSSProperties : {}),
        } : undefined}>

        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/60 rounded-2xl pointer-events-none">
            <Paperclip className="w-8 h-8 text-primary" />
            <span className="text-sm font-semibold text-primary">Drop files to share</span>
          </div>
        )}

        {/* Title bar */}
        {classic ? (
          <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b border-primary/20 shrink-0">
            <Link href="/rooms">
              <button className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary font-mono transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" /> ROOMS
              </button>
            </Link>
            <span className="font-mono text-sm text-primary tracking-widest uppercase truncate max-w-[120px]">{room.name}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSetting("soundEnabled", !settings.soundEnabled)} title={settings.soundEnabled ? "Mute sounds" : "Unmute sounds"}
                className={`text-muted-foreground/50 hover:text-muted-foreground transition-colors ${!settings.soundEnabled ? "text-muted-foreground/25" : ""}`}>
                {!settings.soundEnabled ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <div className={`w-2 h-2 rounded-full transition-colors ${isConnected ? "bg-primary shadow-[0_0_5px_theme(colors.primary)]" : "bg-muted-foreground/30"}`} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <MonitorUp className="w-3.5 h-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground truncate">{room.name}</span>
              <div className={`w-2 h-2 rounded-full shrink-0 transition-colors ${isConnected ? "bg-green-400 shadow-[0_0_5px_#4ade80]" : "bg-muted-foreground/30"}`} />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setSetting("soundEnabled", !settings.soundEnabled)} title={settings.soundEnabled ? "Mute sounds" : "Unmute sounds"}
                className="w-3 h-3 rounded-full bg-yellow-400/80 hover:bg-yellow-400 transition-colors" />
              <Link href="/rooms">
                <div className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer" />
              </Link>
            </div>
          </div>
        )}

        {/* ── FRIENDS ── */}
        <div className="px-4 shrink-0">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Friends</span>
            <div className="flex items-center gap-0.5">
              <button onClick={toggleMic} title={micActive ? "Mute mic" : "Enable mic"}
                className={`p-1 rounded-md transition-colors ${micActive ? (localSpeaking ? "text-green-400" : "text-primary/80") : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              </button>
              <button onClick={isSharing ? stopSharing : handleStartShare} title={isSharing ? "Stop sharing" : "Share screen"}
                className={`p-1 rounded-md transition-colors ${isSharing ? "text-primary animate-pulse" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <MonitorUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={isInVoice ? handleLeaveVoice : handleJoinVoice} title={isInVoice ? "Leave voice" : "Join voice"}
                className={`p-1 rounded-md transition-colors ${isInVoice ? "text-violet-400 animate-pulse" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {isInVoice ? <PhoneOff className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
              </button>
              <button onClick={notifPermission === "default" ? requestNotifPermission : undefined}
                title={notifPermission === "granted" ? "Notifications on" : "Enable notifications"}
                className={`p-1 rounded-md transition-colors ${notifPermission === "granted" ? "text-primary/60" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <Bell className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setShowInvite(true)} title="Invite"
                className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Friend rows */}
          <div className="space-y-0.5 mb-3">
            {members?.map(member => {
              const isMe = member.id === me.id;
              const p = presence[member.id];
              const online = isMe ? isConnected : p?.online;
              const speaking = isMe ? localSpeaking : p?.speaking;
              const streaming = isMe ? isSharing : p?.streaming;
              const inVoice = isMe ? isInVoice : p?.inVoice;

              const statusLabel = speaking ? "Speaking" : streaming ? "Streaming" : inVoice ? "In Voice" : online ? "Online" : "Offline";
              const statusColor = speaking ? "text-green-400" : streaming ? "text-primary" : inVoice ? "text-violet-400" : online ? "text-muted-foreground/50" : "text-muted-foreground/25";

              return (
                <div key={member.id} className="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-muted/20 transition-colors group">
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <Avatar username={member.username} userId={member.id} size={36} square={classic} />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card transition-colors ${online ? "bg-green-400" : "bg-muted-foreground/20"}`} />
                    {speaking && <div className="absolute inset-0 rounded-full border border-green-400/40 animate-ping" />}
                  </div>
                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">
                      {member.username}{isMe && <span className="text-muted-foreground/40 font-normal"> (you)</span>}
                    </p>
                    <p className={`text-xs leading-tight mt-0.5 ${statusColor}`}>{statusLabel}</p>
                  </div>
                  {/* Right icon */}
                  {speaking ? (
                    <Waveform />
                  ) : streaming && !isMe ? (
                    <button
                      onClick={() => { setViewingStreamOf(member.id); streamWindow.setPos({ x: Math.min(340, window.innerWidth - 470), y: 60 }); }}
                      className="p-1 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Watch stream">
                      <MonitorUp className="w-4 h-4" />
                    </button>
                  ) : inVoice ? (
                    <Headphones className="w-3.5 h-3.5 text-violet-400/60 shrink-0" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-border/25 shrink-0" />

        {/* ── CHAT ── */}
        {settings.chatPopout ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/40 px-4">
            <ExternalLink className="w-8 h-8 opacity-30" />
            <p className="text-xs text-center">Chat is floating<br />
              <button onClick={() => setSetting("chatPopout", false)} className="text-primary/60 hover:text-primary underline underline-offset-2 mt-1 text-xs">
                Dock it back
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="px-4 pt-3 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                  Chat
                  {searchQuery && filteredMessages.length !== messages.length && (
                    <span className="ml-1.5 text-primary/60">{filteredMessages.length}/{messages.length}</span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setSetting("chatPopout", true)} title="Pop out chat"
                    className="p-1 rounded-md text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  <button onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
                    className={`p-1 rounded-md transition-colors ${showSearch ? "text-primary bg-primary/10" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                    <Search className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {showSearch && (
                <div className="mb-2 relative">
                  <Input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Escape" && (setShowSearch(false), setSearchQuery(""))}
                    placeholder="Search…"
                    className="h-8 rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs pr-8" />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 min-h-0 px-4">
              <ScrollArea className="h-full">
                <div className={`pr-1 pb-2 ${settings.compactMessages ? "space-y-0" : "space-y-0.5"}`}>
                  {hasMore && !searchQuery && (
                    <button onClick={loadMoreMessages} disabled={loadingMore}
                      className="w-full text-center text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 py-1 transition-colors disabled:opacity-30">
                      {loadingMore ? "Loading…" : "↑ Load older"}
                    </button>
                  )}
                  {filteredMessages.length === 0 && (
                    <p className="text-xs text-muted-foreground/40 text-center py-4">
                      {searchQuery ? "No messages match" : "No messages yet — say hi!"}
                    </p>
                  )}
                  {filteredMessages.map(msg => {
                    const isOwn = msg.userId === me.id;
                    const isHovered = hoveredMsgId === msg.id;
                    const isEditing = editingMsgId === msg.id;
                    const reactions: any[] = msg.reactions ?? [];
                    const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const tSize = settings.fontSize === "sm" ? "text-xs" : settings.fontSize === "lg" ? "text-base" : "text-sm";
                    return (
                      <div key={msg.id}
                        className={`relative group/msg px-2 -mx-2 rounded-xl hover:bg-muted/15 transition-colors ${settings.compactMessages ? "py-0.5" : "py-1"}`}
                        onMouseEnter={() => setHoveredMsgId(msg.id)}
                        onMouseLeave={() => setHoveredMsgId(null)}>
                        {isEditing ? (
                          <form onSubmit={handleEditMsg}>
                            <div className="flex items-baseline gap-1.5 mb-0.5">
                              {settings.showTimestamps && <span className="text-[11px] text-muted-foreground/40 shrink-0">{timeStr}</span>}
                              <span className={`text-sm font-semibold shrink-0 ${chatColor(msg.userId)}`}>{msg.username}</span>
                            </div>
                            <Input value={editContent} onChange={e => setEditContent(e.target.value)}
                              onKeyDown={e => e.key === "Escape" && (setEditingMsgId(null), setEditContent(""))}
                              className="h-7 rounded-lg bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-sm ml-0"
                              autoFocus />
                            <span className="text-[10px] text-muted-foreground/30 ml-0.5">Enter · Esc to cancel</span>
                          </form>
                        ) : (
                          <div className={`flex items-baseline flex-wrap gap-x-1.5 leading-relaxed ${tSize}`}>
                            {settings.showTimestamps && <span className="text-[11px] text-muted-foreground/40 shrink-0">{timeStr}</span>}
                            <span className={`font-semibold shrink-0 ${chatColor(msg.userId)}`}>{msg.username}</span>
                            <span className={`${tSize} text-foreground/85`}>
                              <MessageContent content={msg.content} searchQuery={searchQuery} myUsername={me.username} />
                              {msg.editedAt && <span className="text-[10px] text-muted-foreground/30 ml-1">(edited)</span>}
                            </span>
                          </div>
                        )}
                        {/* Own message actions */}
                        {isOwn && !isEditing && isHovered && (
                          <div className="absolute right-1 top-0.5 flex items-center gap-0.5 bg-card border border-border/40 rounded-lg px-1 py-0.5 shadow-sm">
                            <button onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content); }}
                              className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" title="Edit">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => handleDeleteMsg(msg.id)}
                              className="p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors" title="Delete">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {/* Quick reactions on hover */}
                        {isHovered && !isEditing && (
                          <div className="flex items-center gap-0.5 mt-1 flex-wrap">
                            {QUICK_REACTIONS.map(emoji => (
                              <button key={emoji} onClick={() => handleToggleReaction(msg.id, emoji)}
                                className="text-sm leading-none w-6 h-6 flex items-center justify-center rounded-lg hover:bg-primary/10 hover:scale-125 transition-all">
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Reaction bubbles */}
                        {reactions.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            {reactions.map((r: any) => {
                              const isMine = (r.userIds as number[]).includes(me.id);
                              return (
                                <button key={r.emoji} onClick={() => handleToggleReaction(msg.id, r.emoji)}
                                  className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${isMine ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-muted/20 text-muted-foreground hover:border-primary/30"}`}>
                                  <span>{r.emoji}</span>
                                  <span className="text-[10px] ml-0.5">{r.count}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {/* Read receipts */}
                        {readersByMessage[msg.id]?.length > 0 && (
                          <div className="flex items-center gap-0.5 mt-1">
                            {readersByMessage[msg.id].map(r => (
                              <div key={r.id} title={`Seen by ${r.username}`}
                                className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${avatarBg(r.id)}`}>
                                {r.username[0]?.toUpperCase()}
                              </div>
                            ))}
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
            {typingNames.length > 0 && (
              <div className="px-5 pb-1 shrink-0 flex items-center gap-1.5">
                <div className="flex gap-0.5 items-end">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1 h-1 rounded-full bg-muted-foreground/40"
                      style={{ animation: "typing-bounce 1s ease-in-out infinite", animationDelay: `${i * 200}ms` }} />
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground/50 truncate">
                  {typingNames.length === 1 ? `${typingNames[0]} is typing` : `${typingNames[0]} and ${typingNames.length - 1} others are typing`}
                </span>
              </div>
            )}

            {/* Message input */}
            <div className="px-4 py-3 shrink-0">
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
              <div className="relative flex items-end gap-1.5">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!isConnected || isUploading}
                  title="Attach file" className="mb-0.5 p-2 rounded-xl text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40 shrink-0">
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                </button>
                <div className="relative flex-1">
                  <MentionInput
                    ref={msgInputRef}
                    value={msgInput}
                    onChange={handleMsgInputChange}
                    onSubmit={handleSendMsg}
                    members={members ?? []}
                    disabled={!isConnected}
                    placeholder="Message…  (@ to mention, drag/paste files)"
                    onFilesPasted={handleFiles}
                    className="rounded-xl bg-muted/25 border border-transparent focus-visible:border-primary/25 focus-visible:outline-none text-sm px-3 py-2 pr-8 placeholder:text-muted-foreground/40 text-foreground" />
                  <button type="button" className="absolute right-2.5 bottom-2 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors">
                    <Smile className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Bottom nav */}
        <div className="flex items-center justify-around border-t border-border/20 px-4 pb-4 pt-2 shrink-0">
          <NavBtn active icon={<Users className="w-5 h-5" />} />
          <NavBtn onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchQuery(""); }}
            active={showSearch}
            icon={<MessageSquare className="w-5 h-5" />} />
          <NavBtn onClick={() => setShowSettings(true)} icon={<Settings className="w-5 h-5" />} />
        </div>
      </div>

      {/* ── Floating Stream Window ── */}
      {viewingStreamOf && !overlayMode && (
        <div className="fixed z-50 w-[440px] rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-[#0a0a0f]"
          style={{ left: streamWindow.pos.x, top: streamWindow.pos.y }}>
          <div className="flex items-center justify-between px-4 py-2.5 bg-card/95 border-b border-border/30 cursor-grab active:cursor-grabbing select-none"
            onPointerDown={streamPinned ? undefined : streamWindow.onPointerDown}
            onPointerMove={streamPinned ? undefined : streamWindow.onPointerMove}
            onPointerUp={streamPinned ? undefined : streamWindow.onPointerUp}>
            <div className="flex items-center gap-2">
              <MonitorUp className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-sm font-medium">{viewingUser?.username} is streaming</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setStreamPinned(p => !p)} className={`p-1.5 rounded-lg transition-colors ${streamPinned ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground"}`}>
                {streamPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setStreamMuted(m => !m)} className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground transition-colors">
                {streamMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setViewingStreamOf(null)} className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-destructive transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="aspect-video">
            {activeStream ? <StreamVideo stream={activeStream} muted={streamMuted} /> : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-2">
                <MonitorUp className="w-10 h-10 opacity-30" />
                <span className="text-sm">Waiting for signal…</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Invite Modal ── */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-xs p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/20">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" /> Invite to {room.name}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-6 flex flex-col items-center gap-5">
            <div className="text-center">
              <p className="text-[11px] text-muted-foreground/60 uppercase tracking-widest mb-3">Invite Code</p>
              <div className="font-mono text-4xl font-bold tracking-[0.3em] select-all bg-muted/20 border border-border/30 rounded-xl px-6 py-4 text-primary">
                {room.inviteCode}
              </div>
            </div>
            <Button className="w-full rounded-xl font-medium gap-2" onClick={copyCode}>
              {codeCopied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Code</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Overlay Pill ── */}
      {overlayMode && (
        <div className="fixed z-50 select-none"
          style={{ left: pillPos.x, top: pillPos.y }}>
          <div
            className="flex items-center gap-2 bg-card/95 border border-primary/30 rounded-full px-3 py-1.5 shadow-2xl cursor-grab active:cursor-grabbing backdrop-blur-sm"
            onPointerDown={pillOnPointerDown}
            onPointerMove={pillOnPointerMove}
            onPointerUp={pillOnPointerUp}>
            <div className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? "bg-green-400 shadow-[0_0_4px_#4ade80]" : "bg-muted-foreground/30"}`} />
            <span className="text-xs font-semibold text-foreground/90 max-w-[90px] truncate">{room.name}</span>
            <span className="text-[10px] text-muted-foreground/50">{onlineCount} online</span>
            {unreadOverlay > 0 && (
              <span className="text-[10px] font-bold text-primary bg-primary/15 rounded-full px-1.5 min-w-[18px] text-center">
                {unreadOverlay > 99 ? "99+" : unreadOverlay}
              </span>
            )}
            <span className="font-mono text-[9px] text-muted-foreground/30">{fmtHotkey(settings.overlayHotkey)}</span>
            <button
              className="text-muted-foreground/40 hover:text-foreground transition-colors"
              onClick={() => { setOverlayMode(false); setUnreadOverlay(0); }}
              onPointerDown={e => e.stopPropagation()}
              title="Restore panel">
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Settings Modal ── */}
      <SettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        roomName={room.name}
        onRename={handleRenameByName}
        isRenaming={updateRoomMutation.isPending}
        showLeaveConfirm={showLeaveConfirm}
        onLeaveStart={() => setShowLeaveConfirm(true)}
        onLeaveCancel={() => setShowLeaveConfirm(false)}
        onLeaveConfirm={handleLeaveRoom}
        isLeaving={leaveRoomMutation.isPending}
      />

      {/* ── Chat Pop-out ── */}
      {settings.chatPopout && !overlayMode && (
        <ChatPopout
          messages={filteredMessages}
          me={me}
          members={members ?? []}
          readersByMessage={readersByMessage}
          onFilesDropped={handleFiles}
          settings={settings}
          isConnected={isConnected}
          typingNames={typingNames}
          msgInput={msgInput}
          onMsgInputChange={handleMsgInputChange}
          onSend={handleSendMsg}
          onFiles={handleFiles}
          isUploading={isUploading}
          editingMsgId={editingMsgId}
          editContent={editContent}
          onEditStart={(id, content) => { setEditingMsgId(id); setEditContent(content); }}
          onEditSave={handleEditMsg}
          onEditCancel={() => { setEditingMsgId(null); setEditContent(""); }}
          onEditContentChange={setEditContent}
          onDelete={handleDeleteMsg}
          onReaction={handleToggleReaction}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMoreMessages}
          defaultPos={settings.chatPopoutPos}
          onPosChange={pos => setSetting("chatPopoutPos", pos)}
          onClose={() => setSetting("chatPopout", false)}
          messagesEndRef={messagesEndRef}
        />
      )}
    </div>
  );
}

function NavBtn({ icon, active, onClick }: { icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`relative flex items-center justify-center p-2 rounded-xl transition-colors ${active ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
      {icon}
      {active && <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-foreground rounded-full" />}
    </button>
  );
}
