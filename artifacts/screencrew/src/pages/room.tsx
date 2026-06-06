import { useEffect, useState, useRef, useCallback, useMemo } from "react";
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
  useGetPinnedMessages, getGetPinnedMessagesQueryKey,
  useGetPendingMembers, getGetPendingMembersQueryKey,
  useTogglePin, useApproveMember,
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
  Reply, Star, Megaphone, BarChart3, Hand,
  Lock, Globe, Clock, RefreshCw, StickyNote, Palette,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useSettings } from "@/lib/settings";
import { buildAudioConstraints, buildDisplayConstraints } from "@/lib/media";
import { ThemeToggle } from "@/lib/theme";
import { SettingsModal } from "@/components/settings-modal";
import { ChatPopout } from "@/components/chat-popout";
import { GiphyPicker } from "@/components/giphy-picker";
import { MentionInput, type MentionInputHandle } from "@/components/mention-input";
import {
  MessageContent, containsMention,
  isGifReaction, gifReactionUrl, encodePoll, encodeEmote, POLL_EMOJIS,
} from "@/lib/markdown";
import { avatarSrc, displayNameOf } from "@/lib/avatar";
import { useUpload } from "@/hooks/use-upload";
import { ProfileHoverCard, StatusPicker, STATUS_META } from "@/components/profile-hover";
import { PixelAvatar } from "@/components/pixel-avatar";
import { Spectrum } from "@/components/spectrum";
import type { UserStatus } from "@/lib/settings";
import { ChevronDown } from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const QUICK_REACTIONS = ["👍", "😂", "❤️", "🔥", "👀", "😮", "🎉", "💀"];

const SOUNDBOARD_CLIPS: { id: string; label: string }[] = [
  { id: "beep", label: "Beep" },
  { id: "chime", label: "Chime" },
  { id: "pop", label: "Pop" },
  { id: "join", label: "Join" },
];

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

// A user-chosen name color (hex) overrides the deterministic class palette.
function nameStyle(nameColor?: string | null): React.CSSProperties | undefined {
  return nameColor ? { color: nameColor } : undefined;
}
function nameClass(userId: number, nameColor?: string | null) {
  return nameColor ? "" : chatColor(userId);
}

type OverlayToastData = {
  key: number;
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  nameColor: string | null;
  avatarStyle: string | null;
  content: string;
};

function toastPreview(content: string) {
  const text = content
    .replace(/\[screencrew:image:[^\]]+\]/g, "\u{1F4F7} Photo")
    .replace(/\[screencrew:file:[^:]+:([^\]]+)\]/g, "\u{1F4CE} $1")
    .replace(/\[screencrew:gif:[^\]]+\]/g, "\u{1F3AC} GIF")
    .trim();
  return text || "\u{1F4F7} Photo";
}

// ─── Helper components ───────────────────────────────────────────────────────

function Avatar({ username, userId, size = 36, square = false, avatarUrl, avatarStyle }: { username: string; userId: number; size?: number; square?: boolean; avatarUrl?: string | null; avatarStyle?: string | null }) {
  const src = avatarSrc(avatarUrl);
  if (src) {
    return (
      <img src={src} alt={username}
        className={`${square ? "rounded-sm" : "rounded-full"} object-cover select-none shrink-0`}
        style={{ width: size, height: size }} />
    );
  }
  if (avatarStyle === "pixel") {
    return <PixelAvatar userId={userId} size={size} square={square} />;
  }
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

function AudioPlayer({ stream, volume = 100, muted = false }: { stream: MediaStream; volume?: number; muted?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume / 100)); }, [volume]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  return <audio ref={ref} autoPlay muted={muted} />;
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

  const isCreator = !!me && !!room && room.createdBy === me.id;

  const { data: pinnedMessages } = useGetPinnedMessages(roomId, { query: { enabled: !!roomId, queryKey: getGetPinnedMessagesQueryKey(roomId) } });
  const { data: pendingMembers } = useGetPendingMembers(roomId, { query: { enabled: !!roomId && isCreator, queryKey: getGetPendingMembersQueryKey(roomId) } });

  const sendMessageMutation = useSendMessage();
  const toggleReactionMutation = useToggleReaction();
  const updateRoomMutation = useUpdateRoom();
  const leaveRoomMutation = useLeaveRoom();
  const editMessageMutation = useEditMessage();
  const deleteMessageMutation = useDeleteMessage();
  const togglePinMutation = useTogglePin();
  const approveMemberMutation = useApproveMember();

  // ─── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, any>>({});
  const [msgInput, setMsgInput] = useState("");
  const [giphyQuery, setGiphyQuery] = useState<string | null>(null);
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

  const { playEvent, playForUser, playSound } = useSounds(settings);

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

  // Phase E feature state
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [activityInput, setActivityInput] = useState("");
  const [showActivityEdit, setShowActivityEdit] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [gifReactionFor, setGifReactionFor] = useState<number | null>(null);
  const [connHealth, setConnHealth] = useState<Record<number, "good" | "ok" | "poor">>({});
  const [pttActive, setPttActive] = useState(false);
  const [soundboardFlash, setSoundboardFlash] = useState<{ username: string; key: number } | null>(null);
  const myActivityRef = useRef<string>("");

  const [overlayMode, setOverlayMode] = useState(false);
  const [unreadOverlay, setUnreadOverlay] = useState(0);
  const [overlayToasts, setOverlayToasts] = useState<OverlayToastData[]>([]);
  const toastKeyRef = useRef(0);
  const [pillPos, setPillPos] = useState(() => settings.overlayPillPos);
  const pillDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const lastSeenMsgIdRef = useRef(0);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<((msg: any) => void) | null>(null);
  const isSharingRef = useRef(false);
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOnlineRef = useRef<Set<number>>(new Set());
  const presenceRef = useRef<Record<number, any>>({});
  const streamWindow = useDraggable({ x: 360, y: 60 });
  const winResizeRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);

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

  const audioConstraints = useMemo(
    () => buildAudioConstraints(settings),
    [settings.micDeviceId, settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl],
  );

  const { isActive: micActive, startDetection, stopDetection } = useVoiceActivity({
    onSpeakingChange: handleSpeakingChange, threshold: 12, silenceDelay: 500,
    audioConstraints,
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
    const giphyMatch = value.match(/^\/giphy(?:\s+([\s\S]*))?$/i);
    if (giphyMatch) {
      setGiphyQuery(giphyMatch[1]?.trim() ?? "");
      sendTypingStop();
      return;
    }
    setGiphyQuery(null);
    if (!value.trim()) { sendTypingStop(); return; }
    if (!isTypingRef.current) { isTypingRef.current = true; sendRef.current?.({ type: "typing", isTyping: true }); }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(sendTypingStop, 4000);
  }, [sendTypingStop]);

  // ─── Reactions ─────────────────────────────────────────────────────────────
  const applyReactionUpdate = useCallback((messageId: number, reactions: any[]) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m));
    playEvent("reaction");
  }, [playEvent]);

  // ─── WebRTC ────────────────────────────────────────────────────────────────
  const {
    remoteStreams, remoteAudioStreams,
    isSharing, isInVoice,
    startSharing, stopSharing,
    handleOffer, handleAnswer, handleIceCandidate, sendOffer,
    joinVoice, leaveVoice,
    sendAudioOffer, handleAudioOffer, handleAudioAnswer, handleAudioIce,
    setMicEnabled, getConnectionStats,
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
      let doPlayLeave = false;
      const presentIds = new Set<number>(entries.map((e: any) => e.userId as number));
      setPresence(prev => {
        const next = { ...prev };
        entries.forEach((e: any) => {
          const wasOnline = prevOnlineRef.current.has(e.userId);
          if (e.online && !wasOnline && e.userId !== me?.id) doPlayJoin = true;
          if (!e.online && wasOnline && e.userId !== me?.id) doPlayLeave = true;
          if (e.online) prevOnlineRef.current.add(e.userId); else prevOnlineRef.current.delete(e.userId);
          if (e.inVoice && !prev[e.userId]?.inVoice && e.userId !== me?.id && isInVoice) voiceOfferTargets.push(e.userId);
          next[e.userId] = e;
        });
        // Presence snapshots only include connected users; anyone previously
        // online but absent from this snapshot has left the room.
        prevOnlineRef.current.forEach((uid) => {
          if (!presentIds.has(uid)) {
            if (uid !== me?.id) doPlayLeave = true;
            if (next[uid]) next[uid] = { ...next[uid], online: false, speaking: false, streaming: false, inVoice: false };
          }
        });
        return next;
      });
      prevOnlineRef.current.forEach((uid) => { if (!presentIds.has(uid)) prevOnlineRef.current.delete(uid); });
      if (doPlayJoin) playEvent("join");
      if (doPlayLeave) playEvent("leave");
      voiceOfferTargets.forEach(id => sendAudioOffer(id));
    },
    onNewMessage: (msg) => {
      if (msg.roomId !== roomId) return;
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
      if (msg.userId !== me?.id) {
        const mentioned = me?.username ? containsMention(msg.content, me.username) : false;
        playForUser(msg.userId, mentioned ? "mention" : "message");
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
    onRoomUpdated: () => { queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); },
    onSoundboardPlay: (userId, username, sound) => {
      if (userId !== me?.id) playSound(sound, true);
      setSoundboardFlash({ username, key: Date.now() });
    },
    onKnock: (rid, user) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetPendingMembersQueryKey(roomId) });
      playEvent("knock");
      if (notifPermRef.current === "granted") {
        new Notification(`${user?.username ?? "Someone"} wants to join`, { tag: `screencrew-knock-${roomId}`, body: room?.name ?? "" });
      }
    },
    onKnockApproved: (rid) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
    },
    onKnockResolved: (rid) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetPendingMembersQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
    },
  });

  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { if (isConnected && roomId) send({ type: "join_room", roomId }); }, [isConnected, roomId, send]);

  // Broadcast our chosen status to the room
  useEffect(() => {
    if (!isConnected || !roomId) return;
    send({ type: "status", status: settings.myStatus, statusMessage: settings.myStatusMessage });
  }, [isConnected, roomId, settings.myStatus, settings.myStatusMessage, send]);

  const setMyStatus = useCallback((status: UserStatus, message: string) => {
    setSetting("myStatus", status);
    setSetting("myStatusMessage", message);
  }, [setSetting]);

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
    await startSharing(roomId, {
      displayConstraints: buildDisplayConstraints(settings),
      codec: settings.videoCodec,
      bitrate: settings.videoBitrate,
    });
    if (members && me) members.forEach(m => { if (m.id !== me.id) sendOffer(m.id); });
  };

  // Append a freshly-sent message immediately (dedup by id; the WS echo may also
  // arrive, so guard against duplicates the same way onNewMessage does).
  const appendOwnMessage = useCallback((msg: any) => {
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
  }, []);

  const postMessage = useCallback((content: string) => {
    const replyToId = replyingTo?.id;
    sendMessageMutation.mutate(
      { roomId, data: replyToId ? { content, replyToId } : { content } },
      { onSuccess: appendOwnMessage },
    );
    setReplyingTo(null);
  }, [roomId, replyingTo, sendMessageMutation, appendOwnMessage]);

  // Expand client-side slash commands into a message content string, or null to skip sending
  const expandSlashCommand = useCallback((raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("/")) return raw;
    const sp = trimmed.indexOf(" ");
    const cmd = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
    const rest = sp === -1 ? "" : trimmed.slice(sp + 1).trim();
    switch (cmd) {
      case "/me":
        return rest ? encodeEmote(me?.username ?? "", rest) : null;
      case "/shrug":
        return `${rest ? rest + " " : ""}¯\\_(ツ)_/¯`;
      case "/flip":
        return `🪙 flips a coin: **${Math.random() < 0.5 ? "Heads" : "Tails"}**`;
      case "/roll": {
        const sides = Math.max(2, Math.min(1000, parseInt(rest, 10) || 6));
        return `🎲 rolls a d${sides}: **${1 + Math.floor(Math.random() * sides)}**`;
      }
      case "/poll": {
        const segs = rest.split("|").map(s => s.trim()).filter(Boolean);
        if (segs.length < 3) return raw; // need question + 2 options; fall back to plain text
        const [q, ...options] = segs;
        return encodePoll({ q, options: options.slice(0, 10) });
      }
      default:
        return raw;
    }
  }, [me?.username]);

  const handleSendMsg = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (/^\/giphy(?:\s|$)/i.test(msgInput)) return; // picker handles posting GIFs
    if (!msgInput.trim()) return;
    sendTypingStop();
    const expanded = expandSlashCommand(msgInput);
    if (expanded === null) { setMsgInput(""); return; }
    postMessage(expanded);
    setMsgInput("");
  };

  const handlePickGif = (url: string) => {
    postMessage(`[screencrew:gif:${url}]`);
    setMsgInput("");
    setGiphyQuery(null);
    msgInputRef.current?.focus();
  };

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (r) => {
      const isImage = r.contentType.startsWith("image/");
      const token = isImage
        ? `[screencrew:image:${r.objectPath}]`
        : `[screencrew:file:${r.objectPath}:${r.name}]`;
      sendMessageMutation.mutate({ roomId, data: { content: token } }, { onSuccess: appendOwnMessage });
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

  const handleTogglePin = useCallback((messageId: number) => {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, pinned: !m.pinned } : m));
    togglePinMutation.mutate({ roomId, messageId }, {
      onSettled: () => queryClient.invalidateQueries({ queryKey: getGetPinnedMessagesQueryKey(roomId) }),
    });
  }, [roomId, togglePinMutation, queryClient]);

  const handleApproveMember = useCallback((userId: number) => {
    approveMemberMutation.mutate({ roomId, userId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPendingMembersQueryKey(roomId) });
        queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
      },
    });
  }, [roomId, approveMemberMutation, queryClient]);

  const playSoundboard = useCallback((sound: string) => {
    playSound(sound, true);
    sendRef.current?.({ type: "soundboard", sound });
  }, [playSound]);

  const sendGifReaction = useCallback((messageId: number, url: string) => {
    handleToggleReaction(messageId, `gif:${url}`);
    setGifReactionFor(null);
  }, [handleToggleReaction]);

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
    const stream = await joinVoice({ audioConstraints, gain: settings.micGain });
    if (!stream) return;
    send({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: true });
    Object.values(presenceRef.current)
      .filter((p: any) => p.inVoice && p.userId !== me?.id)
      .forEach((p: any) => sendAudioOffer(p.userId));
  }, [joinVoice, audioConstraints, settings.micGain, send, me?.id, sendAudioOffer]);

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

  const handleUpdateRoom = useCallback((data: Parameters<typeof updateRoomMutation.mutate>[0]["data"]) => {
    updateRoomMutation.mutate({ roomId, data }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); },
    });
  }, [updateRoomMutation, roomId, queryClient]);

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
      } else if (matchesHotkey(e, settings.settingsHotkey)) {
        e.preventDefault();
        setShowSettings(s => !s);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [settings.overlayHotkey, settings.settingsHotkey]);

  // ─── Push-to-talk ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (settings.voiceMode !== "ptt" || !micActive) { setMicEnabled(true); setPttActive(false); return; }
    setMicEnabled(false); // mic muted until key held in PTT mode
    setPttActive(false);
    const down = (e: KeyboardEvent) => {
      if (e.code !== settings.pttKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      setMicEnabled(true); setPttActive(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== settings.pttKey) return;
      setMicEnabled(false); setPttActive(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); setMicEnabled(true); };
  }, [settings.voiceMode, settings.pttKey, micActive, setMicEnabled]);

  // ─── Idle / AFK auto-status ──────────────────────────────────────────────
  useEffect(() => {
    if (!settings.autoAfk) return;
    let afk = false;
    let timer: ReturnType<typeof setTimeout>;
    const ms = Math.max(1, settings.afkMinutes) * 60_000;
    const reset = () => {
      if (afk) { afk = false; sendRef.current?.({ type: "status", status: "online" }); }
      clearTimeout(timer);
      timer = setTimeout(() => { afk = true; sendRef.current?.({ type: "status", status: "away" }); }, ms);
    };
    const evs = ["mousemove", "keydown", "mousedown", "touchstart"] as const;
    evs.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); evs.forEach(ev => window.removeEventListener(ev, reset)); };
  }, [settings.autoAfk, settings.afkMinutes]);

  // ─── Connection health polling ───────────────────────────────────────────
  useEffect(() => {
    if (!isInVoice && Object.keys(remoteStreams).length === 0) { setConnHealth({}); return; }
    let stop = false;
    const poll = async () => {
      const stats = await getConnectionStats();
      if (!stop) setConnHealth(stats);
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(id); };
  }, [isInVoice, remoteStreams, getConnectionStats]);

  // ─── Watched-friend online notifications ─────────────────────────────────
  const prevWatchedOnlineRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const watched = new Set(settings.watchedUsers);
    const nextOnline = new Set<number>();
    Object.values(presence).forEach((p: any) => { if (p?.online) nextOnline.add(p.userId); });
    nextOnline.forEach(uid => {
      if (uid === me?.id) return;
      if (watched.has(uid) && !prevWatchedOnlineRef.current.has(uid)) {
        const p: any = presence[uid];
        const name = p ? displayNameOf(p) : "A friend";
        playEvent("join");
        if (notifPermRef.current === "granted") {
          new Notification(`${name} is online`, { tag: `screencrew-watch-${uid}`, body: room?.name ?? "" });
        }
      }
    });
    prevWatchedOnlineRef.current = nextOnline;
  }, [presence, settings.watchedUsers, me?.id, room?.name, playEvent]);

  // ─── Broadcast my activity tag ───────────────────────────────────────────
  useEffect(() => {
    if (!isConnected) return;
    if (myActivityRef.current === activityInput) return;
    myActivityRef.current = activityInput;
    sendRef.current?.({ type: "activity", activity: activityInput.trim() || null });
  }, [activityInput, isConnected]);

  // ─── Apply room theme accent ─────────────────────────────────────────────
  useEffect(() => {
    if (!room?.themeColor) return;
    const el = document.documentElement;
    const prev = el.style.getPropertyValue("--room-accent");
    el.style.setProperty("--room-accent", room.themeColor);
    return () => { el.style.setProperty("--room-accent", prev); };
  }, [room?.themeColor]);

  // ─── Soundboard flash auto-clear ─────────────────────────────────────────
  useEffect(() => {
    if (!soundboardFlash) return;
    const t = setTimeout(() => setSoundboardFlash(null), 1500);
    return () => clearTimeout(t);
  }, [soundboardFlash]);

  useEffect(() => {
    const maxId = messages.reduce((mx, m) => (m.id > mx ? m.id : mx), 0);
    if (overlayMode && maxId > lastSeenMsgIdRef.current) {
      const fresh = messages.filter(m => m.id > lastSeenMsgIdRef.current && m.userId !== me?.id);
      if (fresh.length) {
        setUnreadOverlay(u => u + fresh.length);
        setOverlayToasts(prev => [
          ...prev,
          ...fresh.map(m => ({
            key: ++toastKeyRef.current,
            userId: m.userId,
            username: m.username,
            displayName: m.displayName ?? null,
            avatarUrl: m.avatarUrl ?? null,
            nameColor: m.nameColor ?? null,
            avatarStyle: m.avatarStyle ?? null,
            content: m.content,
          })),
        ].slice(-3));
      }
    }
    if (maxId > lastSeenMsgIdRef.current) lastSeenMsgIdRef.current = maxId;
  }, [messages, overlayMode, me?.id]);

  useEffect(() => {
    if (!overlayMode) { setUnreadOverlay(0); setOverlayToasts([]); }
  }, [overlayMode]);

  const dismissToast = useCallback((key: number) => {
    setOverlayToasts(prev => prev.filter(t => t.key !== key));
  }, []);

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

  const onWinResizeDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    winResizeRef.current = { sx: e.clientX, sy: e.clientY, w: settings.windowSize.w, h: settings.windowSize.h };
  };
  const onWinResizeMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!winResizeRef.current) return;
    const w = Math.max(280, Math.min(560, winResizeRef.current.w + e.clientX - winResizeRef.current.sx));
    const h = Math.max(380, Math.min(900, winResizeRef.current.h + e.clientY - winResizeRef.current.sy));
    setSetting("windowSize", { w, h });
  };
  const onWinResizeUp = () => { winResizeRef.current = null; };

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
          <AudioPlayer key={uid} stream={stream}
            volume={settings.userVolumes[uid] ?? 100}
            muted={!!settings.userMuted[uid]} />
        ))}
      </div>

      {/* ── Main Panel ── */}
      <div className={`relative flex flex-col bg-card border shadow-2xl overflow-hidden transition-[opacity,transform] ${classic ? "rounded-sm border-primary/20" : "rounded-2xl border-border/50"} ${overlayMode ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"}`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={{
          width: settings.windowSize.w, height: settings.windowSize.h,
          ...(settings.panelOpacity < 100 ? {
            backgroundColor: `hsl(var(--card) / ${settings.panelOpacity}%)`,
            ...(settings.blurBackground ? { backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" } as React.CSSProperties : {}),
          } : {}),
        }}>

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

        {/* ── Room banner ── */}
        {!overlayMode && room.bannerUrl && (
          <div className="mx-4 mb-2 rounded-xl overflow-hidden border border-border/30 shrink-0">
            <img src={room.bannerUrl} alt="" className="w-full h-16 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
        )}

        {/* ── Room notes ── */}
        {!overlayMode && room.notes && (
          <div className="px-4 mb-2 shrink-0">
            <button onClick={() => setShowNotes(s => !s)}
              className="w-full flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
              <StickyNote className="w-3 h-3 shrink-0 text-primary/60" />
              <span className="font-semibold uppercase tracking-widest">Notes</span>
              <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showNotes ? "rotate-180" : ""}`} />
            </button>
            {showNotes && (
              <div className="mt-1.5 text-xs text-foreground/80 bg-muted/20 border border-border/30 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
                {room.notes}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-0">
        {/* ── FRIENDS ── */}
        <div className="px-4 shrink-0" style={{ order: settings.panelOrder === "friends" ? 0 : 2 }}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Friends</span>
            <div className="flex items-center gap-0.5">
              <button onClick={toggleMic}
                title={micActive ? (settings.voiceMode === "ptt" ? `Push-to-talk (${fmtHotkey(settings.pttKey)})` : "Mute mic") : "Enable mic"}
                className={`relative p-1 rounded-md transition-colors ${micActive ? (settings.voiceMode === "ptt" && !pttActive ? "text-amber-400/80" : localSpeaking ? "text-green-400" : "text-primary/80") : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                {micActive && settings.voiceMode === "ptt" && (
                  <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${pttActive ? "bg-green-400" : "bg-amber-400"}`} />
                )}
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
              <button onClick={() => { setShowActivityEdit(s => !s); setShowSoundboard(false); }} title="Set activity"
                className={`p-1 rounded-md transition-colors ${showActivityEdit || activityInput ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setShowSoundboard(s => !s); setShowActivityEdit(false); }} title="Soundboard"
                className={`p-1 rounded-md transition-colors ${showSoundboard ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <Megaphone className="w-3.5 h-3.5" />
              </button>
              {isCreator && pendingMembers && pendingMembers.length > 0 && (
                <button onClick={() => setShowPending(s => !s)} title="Pending requests"
                  className="relative p-1 rounded-md text-amber-400 hover:text-amber-300 transition-colors">
                  <Hand className="w-3.5 h-3.5" />
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 text-[8px] font-bold text-black flex items-center justify-center">{pendingMembers.length}</span>
                </button>
              )}
              <button onClick={() => setShowInvite(true)} title="Invite"
                className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Activity tag input */}
          {showActivityEdit && (
            <div className="mb-2.5 flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-primary/60 shrink-0" />
              <Input value={activityInput} onChange={e => setActivityInput(e.target.value.slice(0, 80))}
                onKeyDown={e => e.key === "Enter" && setShowActivityEdit(false)}
                placeholder="What are you playing?"
                className="h-7 rounded-lg bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
              {activityInput && (
                <button onClick={() => setActivityInput("")} className="text-muted-foreground/40 hover:text-foreground shrink-0" title="Clear">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Soundboard panel */}
          {showSoundboard && (
            <div className="mb-2.5 grid grid-cols-4 gap-1">
              {SOUNDBOARD_CLIPS.map(clip => (
                <button key={clip.id} onClick={() => playSoundboard(clip.id)}
                  className="text-[10px] rounded-lg bg-muted/30 hover:bg-primary/15 border border-border/30 hover:border-primary/30 py-1.5 transition-colors text-foreground/80">
                  {clip.label}
                </button>
              ))}
            </div>
          )}

          {/* Pending join requests (creator) */}
          {isCreator && showPending && pendingMembers && pendingMembers.length > 0 && (
            <div className="mb-2.5 space-y-1">
              {pendingMembers.map((pm: any) => (
                <div key={pm.id} className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2 py-1.5">
                  <Hand className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs flex-1 truncate">{displayNameOf(pm) || pm.username} wants to join</span>
                  <button onClick={() => handleApproveMember(pm.id)} disabled={approveMemberMutation.isPending}
                    className="text-[10px] font-semibold rounded-md bg-primary/20 hover:bg-primary/30 text-primary px-2 py-0.5 transition-colors disabled:opacity-40">
                    Approve
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Friend rows */}
          {!settings.friendsCollapsed && (
          <div className="space-y-0.5 mb-3">
            {members?.map(member => {
              const isMe = member.id === me.id;
              const p = presence[member.id];
              const online = isMe ? isConnected : p?.online;
              const speaking = isMe ? localSpeaking : p?.speaking;
              const streaming = isMe ? isSharing : p?.streaming;
              const inVoice = isMe ? isInVoice : p?.inVoice;

              const userStatus: UserStatus = isMe ? settings.myStatus : ((p?.status as UserStatus) ?? "online");
              const statusMsg = isMe ? settings.myStatusMessage : (p?.statusMessage ?? "");

              const activityLabel = speaking ? "Speaking" : streaming ? "Streaming" : inVoice ? "In Voice" : null;
              const activityColor = speaking ? "text-green-400" : streaming ? "text-primary" : inVoice ? "text-violet-400" : "";

              let statusLabel: string, statusColor: string;
              if (!online) { statusLabel = "Offline"; statusColor = "text-muted-foreground/25"; }
              else if (activityLabel) { statusLabel = activityLabel; statusColor = activityColor; }
              else { statusLabel = statusMsg || STATUS_META[userStatus].label; statusColor = STATUS_META[userStatus].text; }

              const dotColor = !online ? "bg-muted-foreground/20"
                : userStatus === "away" ? "bg-amber-400"
                : userStatus === "dnd" ? "bg-red-400" : "bg-green-400";

              const memNameColor = isMe ? me.nameColor : (p?.nameColor ?? member.nameColor);
              const memAvatarStyle = isMe ? me.avatarStyle : (p?.avatarStyle ?? member.avatarStyle);
              const memAudioStream = isMe ? null : remoteAudioStreams[member.id];

              const profile = {
                userId: member.id,
                username: member.username,
                displayName: isMe ? me.displayName : (p?.displayName ?? member.displayName),
                avatarUrl: isMe ? me.avatarUrl : (p?.avatarUrl ?? member.avatarUrl),
                steamUrl: isMe ? me.steamUrl : member.steamUrl,
                discordUrl: isMe ? me.discordUrl : member.discordUrl,
                nameColor: memNameColor,
                avatarStyle: memAvatarStyle,
                status: userStatus,
                statusMessage: statusMsg,
                online,
                isMe,
              };

              const rowInner = (
                <div className={`flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-muted/20 transition-colors group ${isMe ? "cursor-pointer" : ""}`}>
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <Avatar username={member.username} userId={member.id} size={36} square={classic}
                      avatarUrl={isMe ? me.avatarUrl : (p?.avatarUrl ?? member.avatarUrl)} avatarStyle={memAvatarStyle} />
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card transition-colors ${dotColor}`} />
                    {speaking && <div className="absolute inset-0 rounded-full border border-green-400/40 animate-ping" />}
                  </div>
                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate flex items-center gap-1">
                      <span className={`truncate ${nameClass(member.id, memNameColor)}`} style={nameStyle(memNameColor)}>{displayNameOf(isMe ? me : { displayName: p?.displayName, username: member.username }) || member.username}</span>
                      {isMe && <span className="text-muted-foreground/40 font-normal shrink-0">(you)</span>}
                      {!isMe && online && connHealth[member.id] && (
                        <span title={`Connection: ${connHealth[member.id]}`}
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${connHealth[member.id] === "good" ? "bg-green-400" : connHealth[member.id] === "ok" ? "bg-amber-400" : "bg-red-400"}`} />
                      )}
                    </p>
                    {p?.activity && online && !activityLabel ? (
                      <p className="text-xs leading-tight mt-0.5 truncate text-primary/70 flex items-center gap-1">
                        <BarChart3 className="w-3 h-3 shrink-0" /> {p.activity}
                      </p>
                    ) : (
                      <p className={`text-xs leading-tight mt-0.5 truncate ${statusColor}`}>{statusLabel}</p>
                    )}
                  </div>
                  {/* Right icon */}
                  {speaking ? (
                    settings.spectrumViz
                      ? <Spectrum stream={memAudioStream} active height={12} color="rgb(74 222 128)" />
                      : <Waveform />
                  ) : streaming && !isMe ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewingStreamOf(member.id); streamWindow.setPos({ x: Math.min(340, window.innerWidth - 470), y: 60 }); }}
                      className="p-1 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Watch stream">
                      <MonitorUp className="w-4 h-4" />
                    </button>
                  ) : inVoice ? (
                    <Headphones className="w-3.5 h-3.5 text-violet-400/60 shrink-0" />
                  ) : isMe ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                  ) : null}
                </div>
              );

              return isMe ? (
                <StatusPicker key={member.id} status={settings.myStatus} statusMessage={settings.myStatusMessage} onChange={setMyStatus}>
                  {rowInner}
                </StatusPicker>
              ) : (
                <ProfileHoverCard key={member.id} user={profile} square={classic} enableUserSound
                  volume={settings.userVolumes[String(member.id)] ?? 100}
                  muted={!!settings.userMuted[String(member.id)]}
                  onVolumeChange={(v) => setSetting("userVolumes", { ...settings.userVolumes, [String(member.id)]: v })}
                  onMuteToggle={() => setSetting("userMuted", { ...settings.userMuted, [String(member.id)]: !settings.userMuted[String(member.id)] })}
                  watched={settings.watchedUsers.includes(member.id)}
                  onWatchToggle={() => setSetting("watchedUsers", settings.watchedUsers.includes(member.id)
                    ? settings.watchedUsers.filter(u => u !== member.id)
                    : [...settings.watchedUsers, member.id])}>
                  {rowInner}
                </ProfileHoverCard>
              );
            })}
          </div>
          )}
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-border/25 shrink-0" style={{ order: 1 }} />

        {/* ── CHAT ── */}
        <div className="flex flex-col min-h-0" style={{ order: settings.panelOrder === "friends" ? 2 : 0, flex: settings.chatCollapsed ? "none" : "1 1 0%" }}>
        {settings.chatCollapsed ? (
          <div className="px-4 py-2.5">
            <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Chat (hidden)</span>
          </div>
        ) : settings.chatPopout ? (
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

            {/* Pinned messages bar */}
            {pinnedMessages && pinnedMessages.length > 0 && (
              <div className="px-4 shrink-0">
                <button onClick={() => setShowPins(s => !s)}
                  className="w-full flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary py-1 transition-colors">
                  <Pin className="w-3 h-3 shrink-0" />
                  <span className="font-medium">{pinnedMessages.length} pinned</span>
                  <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${showPins ? "rotate-180" : ""}`} />
                </button>
                {showPins && (
                  <div className="space-y-1 mb-1.5 max-h-28 overflow-y-auto">
                    {pinnedMessages.map((pm: any) => (
                      <div key={pm.id} className="flex items-start gap-1.5 text-[11px] bg-muted/20 border border-border/30 rounded-lg px-2 py-1">
                        <span className={`font-semibold shrink-0 ${nameClass(pm.userId, pm.nameColor)}`} style={nameStyle(pm.nameColor)}>{displayNameOf(pm) || pm.username}:</span>
                        <span className="text-foreground/70 truncate flex-1">{toastPreview(pm.content)}</span>
                        {isCreator && (
                          <button onClick={() => handleTogglePin(pm.id)} className="text-muted-foreground/40 hover:text-destructive shrink-0" title="Unpin">
                            <PinOff className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 min-h-0 px-4">
              <ScrollArea className="h-full">
                <div className={`pr-1 pb-2 ${settings.compactMessages ? "space-y-0" : "space-y-0.5"}`} style={{ fontFamily: "var(--chat-font)" }}>
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
                              <span className={`text-sm font-semibold shrink-0 ${nameClass(msg.userId, msg.nameColor)}`} style={nameStyle(msg.nameColor)}>{displayNameOf(msg) || msg.username}</span>
                            </div>
                            <Input value={editContent} onChange={e => setEditContent(e.target.value)}
                              onKeyDown={e => e.key === "Escape" && (setEditingMsgId(null), setEditContent(""))}
                              className="h-7 rounded-lg bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-sm ml-0"
                              autoFocus />
                            <span className="text-[10px] text-muted-foreground/30 ml-0.5">Enter · Esc to cancel</span>
                          </form>
                        ) : (
                          <div className={`flex items-baseline flex-wrap gap-x-1.5 leading-relaxed ${tSize}`}>
                            {msg.replyToId && (
                              <div className="basis-full flex items-center gap-1 text-[11px] text-muted-foreground/50 truncate mb-0.5 pl-1 border-l-2 border-primary/30">
                                <Reply className="w-3 h-3 shrink-0" />
                                <span className="font-medium text-primary/60">{msg.replyToUsername ?? "msg"}</span>
                                <span className="truncate">{toastPreview(msg.replyToContent ?? "")}</span>
                              </div>
                            )}
                            {settings.showTimestamps && <span className="text-[11px] text-muted-foreground/40 shrink-0">{timeStr}</span>}
                            {avatarSrc(msg.avatarUrl) ? (
                              <img src={avatarSrc(msg.avatarUrl)!} alt=""
                                className="w-4 h-4 rounded-full object-cover self-center shrink-0" />
                            ) : msg.avatarStyle === "pixel" ? (
                              <span className="self-center shrink-0"><PixelAvatar userId={msg.userId} size={16} /></span>
                            ) : null}
                            <span className={`font-semibold shrink-0 ${nameClass(msg.userId, msg.nameColor)}`} style={nameStyle(msg.nameColor)}>{displayNameOf(msg) || msg.username}</span>
                            <span className={`${tSize} text-foreground/85`}>
                              <MessageContent content={msg.content} searchQuery={searchQuery} myUsername={me.username} />
                              {msg.editedAt && <span className="text-[10px] text-muted-foreground/30 ml-1">(edited)</span>}
                            </span>
                          </div>
                        )}
                        {/* Message actions */}
                        {!isEditing && isHovered && (
                          <div className="absolute right-1 top-0.5 flex items-center gap-0.5 bg-card border border-border/40 rounded-lg px-1 py-0.5 shadow-sm">
                            <button onClick={() => { setReplyingTo(msg); msgInputRef.current?.focus(); }}
                              className="p-0.5 text-muted-foreground/40 hover:text-primary transition-colors" title="Reply">
                              <Reply className="w-3 h-3" />
                            </button>
                            {isCreator && (
                              <button onClick={() => handleTogglePin(msg.id)}
                                className={`p-0.5 transition-colors ${msg.pinned ? "text-primary" : "text-muted-foreground/40 hover:text-primary"}`} title={msg.pinned ? "Unpin" : "Pin"}>
                                <Pin className="w-3 h-3" />
                              </button>
                            )}
                            {isOwn && <>
                              <button onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content); }}
                                className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" title="Edit">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => handleDeleteMsg(msg.id)}
                                className="p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors" title="Delete">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>}
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
                            <button onClick={() => setGifReactionFor(f => f === msg.id ? null : msg.id)}
                              className={`leading-none w-6 h-6 flex items-center justify-center rounded-lg transition-all ${gifReactionFor === msg.id ? "bg-primary/15 text-primary" : "hover:bg-primary/10 text-muted-foreground/60"}`}
                              title="GIF reaction">
                              <span className="text-[9px] font-bold">GIF</span>
                            </button>
                          </div>
                        )}
                        {gifReactionFor === msg.id && (
                          <div className="mt-1">
                            <GiphyPicker query="" onPick={(url) => sendGifReaction(msg.id, url)} onClose={() => setGifReactionFor(null)} />
                          </div>
                        )}
                        {/* Reaction bubbles */}
                        {reactions.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            {reactions.map((r: any) => {
                              const isMine = (r.userIds as number[]).includes(me.id);
                              const gif = isGifReaction(r.emoji);
                              return (
                                <button key={r.emoji} onClick={() => handleToggleReaction(msg.id, r.emoji)}
                                  className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${isMine ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-muted/20 text-muted-foreground hover:border-primary/30"}`}>
                                  {gif
                                    ? <img src={gifReactionUrl(r.emoji)} alt="gif" className="h-6 w-auto rounded object-cover" />
                                    : <span>{r.emoji}</span>}
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
              {replyingTo && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 bg-muted/20 border border-border/30 rounded-lg px-2 py-1 mb-1.5">
                  <Reply className="w-3 h-3 text-primary/60 shrink-0" />
                  <span className="text-primary/70 font-medium shrink-0">{displayNameOf(replyingTo) || replyingTo.username}</span>
                  <span className="truncate flex-1">{toastPreview(replyingTo.content)}</span>
                  <button onClick={() => setReplyingTo(null)} className="text-muted-foreground/40 hover:text-foreground shrink-0" title="Cancel reply">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {giphyQuery !== null && (
                <GiphyPicker query={giphyQuery} onPick={handlePickGif} onClose={() => { setGiphyQuery(null); setMsgInput(""); }} />
              )}
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
        </div>
        </div>

        {/* Resize grip */}
        <div onPointerDown={onWinResizeDown} onPointerMove={onWinResizeMove} onPointerUp={onWinResizeUp}
          title="Drag to resize"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-40 text-muted-foreground/30 hover:text-primary/60 transition-colors"
          style={{ touchAction: "none" }}>
          <svg viewBox="0 0 10 10" className="w-full h-full"><path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
        </div>

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
          <div className={`relative aspect-video transition-shadow ${presence[viewingStreamOf]?.speaking ? "ring-2 ring-green-400/70 ring-inset" : ""}`}>
            {activeStream ? <StreamVideo stream={activeStream} muted={streamMuted} /> : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-2">
                <MonitorUp className="w-10 h-10 opacity-30" />
                <span className="text-sm">Waiting for signal…</span>
              </div>
            )}
            {settings.spectrumViz && presence[viewingStreamOf]?.speaking && (
              <div className="absolute bottom-2 right-2 bg-black/40 rounded-md px-1.5 py-1 backdrop-blur-sm">
                <Spectrum stream={remoteAudioStreams[viewingStreamOf]} active bars={12} height={20} color="rgb(74 222 128)" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Soundboard flash ── */}
      {soundboardFlash && !overlayMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-card/95 border border-primary/40 rounded-full px-3 py-1.5 shadow-2xl backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none">
          <Megaphone className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-foreground/80"><span className="font-semibold text-primary">{soundboardFlash.username}</span> played a sound</span>
        </div>
      )}

      {/* ── Invite Modal ── */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="bg-card border-border/50 rounded-2xl max-w-xs p-0 overflow-hidden shadow-2xl max-h-[90vh]">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/20 shrink-0">
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Share2 className="w-4 h-4 text-primary" /> Invite to {room.name}
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 py-6 flex flex-col gap-5 overflow-y-auto">
            <div className="text-center">
              <p className="text-[11px] text-muted-foreground/60 uppercase tracking-widest mb-3">Invite Code</p>
              <div className="font-mono text-4xl font-bold tracking-[0.3em] select-all bg-muted/20 border border-border/30 rounded-xl px-6 py-4 text-primary text-center">
                {room.inviteCode}
              </div>
              {room.inviteExpiresAt && (
                <p className="text-[10px] text-amber-400/80 mt-2 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" /> Expires {new Date(room.inviteExpiresAt).toLocaleString()}
                </p>
              )}
            </div>
            <Button className="w-full rounded-xl font-medium gap-2" onClick={copyCode}>
              {codeCopied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Code</>}
            </Button>

            {isCreator && (
              <div className="space-y-4 pt-2 border-t border-border/20">
                <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Room Settings</p>

                {/* Privacy */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    {room.isPrivate ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Globe className="w-3.5 h-3.5 text-muted-foreground/50" />}
                    <span>{room.isPrivate ? "Private (knock to join)" : "Open"}</span>
                  </div>
                  <button onClick={() => handleUpdateRoom({ isPrivate: !room.isPrivate })} disabled={updateRoomMutation.isPending}
                    className={`relative w-9 h-5 rounded-full transition-colors ${room.isPrivate ? "bg-primary" : "bg-muted/50"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${room.isPrivate ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </div>

                {/* Invite expiry */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm shrink-0">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground/50" /> Expiry
                  </div>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {([
                      { label: "1h", ms: 3600_000 },
                      { label: "24h", ms: 86400_000 },
                      { label: "Never", ms: 0 },
                    ]).map(({ label, ms }) => (
                      <button key={label} onClick={() => handleUpdateRoom({ inviteExpiresAt: ms ? new Date(Date.now() + ms).toISOString() : null })}
                        disabled={updateRoomMutation.isPending}
                        className="text-[10px] px-2 py-1 rounded-md bg-muted/30 hover:bg-primary/15 hover:text-primary border border-border/30 transition-colors">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Regenerate code */}
                <button onClick={() => handleUpdateRoom({ regenerateCode: true })} disabled={updateRoomMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" /> New Invite Code
                </button>

                {/* Theme color */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <Palette className="w-3.5 h-3.5 text-muted-foreground/50" /> Accent
                  </div>
                  <div className="flex items-center gap-1.5">
                    {["#22d3ee", "#a78bfa", "#f472b6", "#4ade80", "#fbbf24", "#fb7185"].map(hex => (
                      <button key={hex} onClick={() => handleUpdateRoom({ themeColor: hex })}
                        className={`w-5 h-5 rounded-full transition-all ${room.themeColor === hex ? "ring-2 ring-offset-1 ring-offset-card ring-white scale-110" : "hover:scale-105 opacity-70"}`}
                        style={{ backgroundColor: hex }} />
                    ))}
                    {room.themeColor && (
                      <button onClick={() => handleUpdateRoom({ themeColor: null })} title="Clear accent"
                        className="text-muted-foreground/40 hover:text-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Banner */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm"><MonitorUp className="w-3.5 h-3.5 text-muted-foreground/50" /> Banner URL</div>
                  <Input defaultValue={room.bannerUrl ?? ""} key={`banner-${room.bannerUrl}`}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (room.bannerUrl ?? "")) handleUpdateRoom({ bannerUrl: v || null }); }}
                    placeholder="https://…/banner.png"
                    className="h-8 rounded-lg bg-muted/25 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm"><StickyNote className="w-3.5 h-3.5 text-muted-foreground/50" /> Room Notes</div>
                  <Textarea defaultValue={room.notes ?? ""} key={`notes-${room.notes}`}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (room.notes ?? "")) handleUpdateRoom({ notes: v || null }); }}
                    placeholder="Pinned info, rules, links…" rows={3}
                    className="rounded-lg bg-muted/25 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs resize-none" />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Overlay Pill ── */}
      {overlayMode && overlayToasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 pointer-events-none">
          {overlayToasts.map(t => (
            <OverlayToast
              key={t.key}
              toast={t}
              square={classic}
              onDismiss={dismissToast}
              onOpen={() => { setOverlayMode(false); setUnreadOverlay(0); }}
            />
          ))}
        </div>
      )}

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

function OverlayToast({ toast, square, onDismiss, onOpen }: {
  toast: OverlayToastData;
  square: boolean;
  onDismiss: (key: number) => void;
  onOpen: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const key = toast.key;
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onDismiss(key), 5000);
    return () => clearTimeout(t);
  }, [paused, onDismiss, key]);

  const name = displayNameOf({ displayName: toast.displayName, username: toast.username }) || toast.username;

  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto w-[260px] flex items-start gap-2.5 bg-card/95 border border-primary/30 rounded-2xl pl-2.5 pr-2 py-2.5 shadow-2xl backdrop-blur-sm cursor-pointer hover:border-primary/50 transition-colors animate-in slide-in-from-right-4 fade-in duration-300">
      <Avatar username={toast.username} userId={toast.userId} size={34} square={square} avatarUrl={toast.avatarUrl} avatarStyle={toast.avatarStyle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold truncate ${nameClass(toast.userId, toast.nameColor)}`} style={nameStyle(toast.nameColor)}>{name}</span>
          <MessageSquare className="w-3 h-3 text-primary/40 shrink-0 ml-auto" />
        </div>
        <p className="text-xs text-foreground/75 mt-0.5 line-clamp-2 break-words">{toastPreview(toast.content)}</p>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDismiss(key); }}
        className="text-muted-foreground/30 hover:text-foreground transition-colors shrink-0 -mt-0.5"
        title="Dismiss">
        <X className="w-3 h-3" />
      </button>
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
