import { useEffect, useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetRoom, getGetRoomQueryKey,
  useGetRoomMembers, getGetRoomMembersQueryKey,
  useGetRoomPresence, getGetRoomPresenceQueryKey,
  useGetRoomMessages, getGetRoomMessagesQueryKey,
  useSearchRoomMessages, getSearchRoomMessagesQueryKey,
  getRoomMessages,
  useSendMessage, useToggleReaction,
  useUpdateRoom, useLeaveRoom,
  useEditMessage, useDeleteMessage,
  useGetMe,
  useGetPinnedMessages, getGetPinnedMessagesQueryKey,
  useGetPendingMembers, getGetPendingMembersQueryKey,
  useTogglePin, useApproveMember,
  useGetChannels, getGetChannelsQueryKey,
  useCreateChannel, useUpdateChannel, useDeleteChannel,
  useUpdateMemberRole,
  useDenyMember, useRemoveMember, useBanMember, useUnbanMember,
  useGetBans, getGetBansQueryKey,
  useListFriends, getListFriendsQueryKey,
  useListFriendRequests, getListFriendRequestsQueryKey,
  useSendFriendRequest, useAcceptFriendRequest, useDeclineFriendRequest, useRemoveFriend,
  useListBlocks, getListBlocksQueryKey, useBlockUser, useUnblockUser,
  useListBots, getListBotsQueryKey, useCreateBot, useDeleteBot,
  useGetIceServers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { useStreamPopouts } from "@/hooks/use-stream-popouts";
import { useSounds } from "@/hooks/use-sounds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MonitorUp, Mic, MicOff, Phone, PhoneOff, Headphones, HeadphoneOff,
  Plus, Bell, BellOff, BellRing, AtSign, VolumeX, Volume2,
  Pin, PinOff, X, Settings, Search,
  Users, MessageSquare, Pencil, Trash2, Smile,
  Copy, Check, Share2, ChevronLeft, ExternalLink, Maximize2,
  Paperclip, Loader2,
  Reply, Star, Megaphone, BarChart3, Hand,
  Lock, Globe, Clock, RefreshCw, StickyNote, Palette,
  PictureInPicture2, LayoutGrid, Gauge, Eye,
  Hash, Image as ImageIcon, Shield, ShieldCheck, Crown,
  UserMinus, Ban, Bot,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useSettings, applySkinVars, clearSkinVars, SKIN_PRESETS, FONT_OPTIONS } from "@/lib/settings";
import { buildAudioConstraints, buildDisplayConstraints, VIDEO_QUALITY_LABELS } from "@/lib/media";
import type { VideoQuality, NotifyLevel } from "@/lib/settings";
import { ThemeToggle } from "@/lib/theme";
import { SettingsModal } from "@/components/settings-modal";
import { ChatPopout } from "@/components/chat-popout";
import { GiphyPicker } from "@/components/giphy-picker";
import { MentionInput, type MentionInputHandle } from "@/components/mention-input";
import { LinkPreview, firstPreviewableLink } from "@/components/link-preview";
import {
  MessageContent, containsMention,
  isGifReaction, gifReactionUrl, encodePoll, encodeEmote, POLL_EMOJIS,
} from "@/lib/markdown";
import { avatarSrc, displayNameOf } from "@/lib/avatar";
import { useUpload } from "@/hooks/use-upload";
import { useIsMobile } from "@/hooks/use-mobile";
import { ProfileHoverCard, StatusPicker, STATUS_META } from "@/components/profile-hover";
import { PixelAvatar } from "@/components/pixel-avatar";
import { Spectrum } from "@/components/spectrum";
import type { UserStatus } from "@/lib/settings";
import { ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

function useDraggable(initial: { x: number; y: number }, width = 460) {
  const [pos, setPos] = useState(initial);
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
  }, [pos]);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    // Keep at least a sliver on-screen even for wide/narrow windows.
    const maxX = Math.max(0, window.innerWidth - Math.min(widthRef.current, window.innerWidth) - 4);
    setPos({
      x: Math.max(0, Math.min(maxX, dragRef.current.px + e.clientX - dragRef.current.sx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.py + e.clientY - dragRef.current.sy)),
    });
  }, []);
  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);
  return { pos, setPos, onPointerDown, onPointerMove, onPointerUp };
}

const StreamVideo = forwardRef<HTMLVideoElement, { stream: MediaStream; muted: boolean }>(
  function StreamVideo({ stream, muted }, fwd) {
    const ref = useRef<HTMLVideoElement>(null);
    useImperativeHandle(fwd, () => ref.current!, []);
    useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
    return <video ref={ref} autoPlay playsInline muted={muted} className="w-full h-full object-contain bg-black" />;
  },
);

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
  const { toast } = useToast();
  const { settings, set: setSetting } = useSettings();
  const classic = settings.uiTheme === "classic";
  const isMobile = useIsMobile();

  const { data: me } = useGetMe();
  const { data: room } = useGetRoom(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomQueryKey(roomId) } });
  const { data: members } = useGetRoomMembers(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMembersQueryKey(roomId) } });
  const { data: initialPresence } = useGetRoomPresence(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomPresenceQueryKey(roomId) } });
  const { data: channels } = useGetChannels(roomId, { query: { enabled: !!roomId, queryKey: getGetChannelsQueryKey(roomId) } });

  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const activeChannelIdRef = useRef<number | null>(null);
  useEffect(() => { activeChannelIdRef.current = activeChannelId; }, [activeChannelId]);
  // Drop-in voice: a `?voice=<channelId>` URL param means "land in this voice channel".
  const initialVoiceChannel = useRef<number | null>(
    (() => { const v = new URLSearchParams(window.location.search).get("voice"); const n = v ? Number(v) : NaN; return Number.isInteger(n) ? n : null; })()
  );
  // Deep-link: ?channel=<id> from the nav column picks the initial text channel.
  const initialChannel = useRef<number | null>(
    (() => { const v = new URLSearchParams(window.location.search).get("channel"); const n = v ? Number(v) : NaN; return Number.isInteger(n) ? n : null; })()
  );
  const pendingVoiceJoinRef = useRef<number | null>(null);
  const handleJoinVoiceRef = useRef<(() => Promise<void>) | null>(null);

  const { data: initialMessages } = useGetRoomMessages(
    roomId,
    activeChannelId ? { channelId: activeChannelId } : undefined,
    { query: { enabled: !!roomId && !!activeChannelId, queryKey: getGetRoomMessagesQueryKey(roomId, activeChannelId ? { channelId: activeChannelId } : undefined) } },
  );

  const isCreator = !!me && !!room && room.createdBy === me.id;
  const myRole: string = (members?.find((m: any) => m.id === me?.id)?.role as string) ?? (isCreator ? "owner" : "member");
  const isStaff = myRole === "owner" || myRole === "mod";
  const activeChannel = channels?.find((c: any) => c.id === activeChannelId) ?? null;

  const { data: pinnedMessages } = useGetPinnedMessages(roomId, { query: { enabled: !!roomId, queryKey: getGetPinnedMessagesQueryKey(roomId) } });
  const { data: pendingMembers } = useGetPendingMembers(roomId, { query: { enabled: !!roomId && isStaff, queryKey: getGetPendingMembersQueryKey(roomId) } });
  const { data: bannedUsers } = useGetBans(roomId, { query: { enabled: !!roomId && isStaff, queryKey: getGetBansQueryKey(roomId) } });

  const sendMessageMutation = useSendMessage();
  const toggleReactionMutation = useToggleReaction();
  const updateRoomMutation = useUpdateRoom();
  const leaveRoomMutation = useLeaveRoom();
  const editMessageMutation = useEditMessage();
  const deleteMessageMutation = useDeleteMessage();
  const togglePinMutation = useTogglePin();
  const approveMemberMutation = useApproveMember();
  const createChannelMutation = useCreateChannel();
  const updateChannelMutation = useUpdateChannel();
  const deleteChannelMutation = useDeleteChannel();
  const updateMemberRoleMutation = useUpdateMemberRole();
  const denyMemberMutation = useDenyMember();
  const removeMemberMutation = useRemoveMember();
  const banMemberMutation = useBanMember();
  const unbanMemberMutation = useUnbanMember();

  // ─── Friends / blocks / bots ─────────────────────────────────────────────────
  const { data: friends } = useListFriends({ query: { queryKey: getListFriendsQueryKey() } });
  const { data: friendRequests } = useListFriendRequests({ query: { queryKey: getListFriendRequestsQueryKey() } });
  const { data: blocks } = useListBlocks({ query: { queryKey: getListBlocksQueryKey() } });
  const { data: roomBots } = useListBots(roomId, { query: { enabled: !!roomId && isStaff, queryKey: getListBotsQueryKey(roomId) } });

  const sendFriendRequestMutation = useSendFriendRequest();
  const acceptFriendRequestMutation = useAcceptFriendRequest();
  const declineFriendRequestMutation = useDeclineFriendRequest();
  const removeFriendMutation = useRemoveFriend();
  const blockUserMutation = useBlockUser();
  const unblockUserMutation = useUnblockUser();
  const createBotMutation = useCreateBot();
  const deleteBotMutation = useDeleteBot();

  const blockedIds = useMemo(() => new Set((blocks ?? []).map((b: any) => b.id)), [blocks]);
  const friendIds = useMemo(() => new Set((friends ?? []).map((f: any) => f.id)), [friends]);
  const incomingReqByUser = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of (friendRequests?.incoming ?? [])) m.set(r.user.id, r.id);
    return m;
  }, [friendRequests]);
  const outgoingReqUsers = useMemo(() => new Set((friendRequests?.outgoing ?? []).map((r: any) => r.user.id)), [friendRequests]);

  const friendStateOf = useCallback((userId: number) => {
    if (friendIds.has(userId)) return "friends" as const;
    if (incomingReqByUser.has(userId)) return "pending_in" as const;
    if (outgoingReqUsers.has(userId)) return "pending_out" as const;
    return "none" as const;
  }, [friendIds, incomingReqByUser, outgoingReqUsers]);

  const invalidateFriends = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListFriendRequestsQueryKey() });
  }, [queryClient]);

  const handleAddFriend = useCallback((username: string) => {
    sendFriendRequestMutation.mutate({ data: { username } }, {
      onSuccess: () => { invalidateFriends(); toast({ title: "Friend request sent" }); },
      onError: (err: any) => toast({ title: "Couldn't send request", description: err?.message, variant: "destructive" }),
    });
  }, [sendFriendRequestMutation, invalidateFriends, toast]);

  const handleAcceptFriend = useCallback((requestId: number) => {
    acceptFriendRequestMutation.mutate({ id: requestId }, { onSuccess: invalidateFriends });
  }, [acceptFriendRequestMutation, invalidateFriends]);

  const handleDeclineFriend = useCallback((requestId: number) => {
    declineFriendRequestMutation.mutate({ id: requestId }, { onSuccess: invalidateFriends });
  }, [declineFriendRequestMutation, invalidateFriends]);

  const handleRemoveFriend = useCallback((userId: number) => {
    removeFriendMutation.mutate({ userId }, { onSuccess: invalidateFriends });
  }, [removeFriendMutation, invalidateFriends]);

  const handleBlockUser = useCallback((userId: number) => {
    blockUserMutation.mutate({ data: { userId } }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() }); invalidateFriends(); },
      onError: (err: any) => toast({ title: "Couldn't block", description: err?.message, variant: "destructive" }),
    });
  }, [blockUserMutation, queryClient, invalidateFriends, toast]);

  const handleUnblockUser = useCallback((userId: number) => {
    unblockUserMutation.mutate({ userId }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() }) });
  }, [unblockUserMutation, queryClient]);

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

  // Channel / role management UI state
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"text" | "voice" | "announcement" | "media">("text");
  const [newChannelPrivate, setNewChannelPrivate] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [editChannelName, setEditChannelName] = useState("");
  const [showRoles, setShowRoles] = useState(false);
  const [newChannelMinView, setNewChannelMinView] = useState<"member" | "mod" | "owner">("member");
  const [newChannelMinSend, setNewChannelMinSend] = useState<"member" | "mod" | "owner">("member");
  const [permChannelId, setPermChannelId] = useState<number | null>(null);
  const [showBots, setShowBots] = useState(false);
  const [newBotName, setNewBotName] = useState("");
  const [createdBot, setCreatedBot] = useState<{ name: string; token: string; webhookUrl: string } | null>(null);

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");

  const msgInputRef = useRef<MentionInputHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { playEvent, playForUser, playSound } = useSounds(settings);

  const [notifPermission, setNotifPermission] = useState<NotificationPermission>("default");
  const notifPermRef = useRef<NotificationPermission>("default");

  // Resolve whether an incoming chat message should ping (sound + browser notification).
  // Channel-level setting overrides room-level; "Do not disturb" status mutes everything.
  // Assigned during render (not in an effect) so a message arriving immediately after a
  // settings/status change is gated by the latest preferences, not a stale snapshot.
  const shouldNotifyRef = useRef<(channelId: number | null, mentioned: boolean) => boolean>(() => true);
  shouldNotifyRef.current = (channelId, mentioned) => {
    if (settings.myStatus === "dnd") return false;
    const chLevel = channelId != null ? settings.channelNotify[String(channelId)] : undefined;
    const level = chLevel ?? settings.roomNotify[String(roomId)] ?? "all";
    if (level === "none") return false;
    if (level === "mentions") return mentioned;
    return true;
  };

  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [roomPasswordInput, setRoomPasswordInput] = useState("");

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [viewingStreamOf, setViewingStreamOf] = useState<number | null>(null);
  const [gridView, setGridView] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const [streamMuted, setStreamMuted] = useState(false);
  const [streamPinned, setStreamPinned] = useState(false);
  const streamVideoRef = useRef<HTMLVideoElement>(null);

  // Member management + watch-consent UI state
  const [showBans, setShowBans] = useState(false);
  // Pending "ask before watching" requests addressed to me (the streamer): userIds awaiting my decision
  const [watchRequests, setWatchRequests] = useState<number[]>([]);
  // userIds I've already decided on this share session, so they aren't re-prompted
  const decidedWatchersRef = useRef<Set<number>>(new Set());
  // streamers (userIds) who denied my watch request, to show a "denied" hint
  const [watchDeniedBy, setWatchDeniedBy] = useState<number[]>([]);

  const [bindingClip, setBindingClip] = useState<string | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // Phase E feature state
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [activityInput, setActivityInput] = useState("");
  const [showActivityEdit, setShowActivityEdit] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSoundboard, setShowSoundboard] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [gifReactionFor, setGifReactionFor] = useState<number | null>(null);
  const [connHealth, setConnHealth] = useState<Record<number, "good" | "ok" | "poor">>({});
  const [pttActive, setPttActive] = useState(false);
  const [selfMuted, setSelfMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
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
  const streamWindow = useDraggable({ x: 360, y: 60 }, settings.streamWindowW);
  const overlayStreamWindow = useDraggable({ x: 16, y: 80 }, 260);
  const winResizeRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  const streamWinResizeRef = useRef<{ sx: number; w: number } | null>(null);

  useEffect(() => { presenceRef.current = presence; }, [presence]);

  // ─── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (roomId) localStorage.setItem(`screencrew_visited_${roomId}`, new Date().toISOString());
  }, [roomId]);

  useEffect(() => {
    if (initialMessages) { setMessages(initialMessages); setHasMore(initialMessages.length >= 50); }
  }, [initialMessages]);

  // Default to the first text channel (or first channel) once channels load, and
  // keep the selection valid if the active channel disappears.
  useEffect(() => {
    if (!channels || channels.length === 0) return;
    // Drop-in voice: if we arrived with ?voice=<id> and that voice channel exists, land in it.
    if (initialVoiceChannel.current != null) {
      const target = channels.find((c: any) => c.id === initialVoiceChannel.current && c.type === "voice")
        ?? channels.find((c: any) => c.type === "voice");
      initialVoiceChannel.current = null;
      if (target) { setActiveChannelId(target.id); pendingVoiceJoinRef.current = target.id; return; }
    }
    // Deep-link: honor ?channel=<id> on first resolve if that channel exists.
    if (initialChannel.current != null) {
      const target = channels.find((c: any) => c.id === initialChannel.current);
      initialChannel.current = null;
      if (target) { setActiveChannelId(target.id); return; }
    }
    const stillExists = activeChannelId != null && channels.some((c: any) => c.id === activeChannelId);
    if (stillExists) return;
    const firstText = channels.find((c: any) => c.type === "text") ?? channels[0];
    setActiveChannelId(firstText.id);
  }, [channels, activeChannelId]);

  // Reset chat state when switching channels so we don't show stale messages.
  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setTypingUsers({});
  }, [activeChannelId]);

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
  // Mirror mute/deafen into a ref so the speaking callback (a stable useCallback)
  // never broadcasts "speaking" while silenced.
  const micSilencedRef = useRef(false);
  const handleSpeakingChange = useCallback((speaking: boolean) => {
    const next = speaking && !micSilencedRef.current;
    setLocalSpeaking(next);
    sendRef.current?.({ type: "presence", speaking: next, streaming: isSharingRef.current, inVoice: false });
  }, []);

  const audioConstraints = useMemo(
    () => buildAudioConstraints(settings),
    [settings.micDeviceId, settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl],
  );

  // Map 0–100 sensitivity to an RMS threshold (higher sensitivity = lower threshold).
  const vadThreshold = Math.max(2, Math.round(42 - settings.micSensitivity * 0.4));

  const { isActive: micActive, startDetection, stopDetection } = useVoiceActivity({
    onSpeakingChange: handleSpeakingChange, threshold: vadThreshold, silenceDelay: 500,
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
  const { data: iceData } = useGetIceServers();
  const iceServers = iceData?.iceServers as RTCIceServer[] | undefined;
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
    iceServers,
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
      if (activeChannelIdRef.current != null && msg.channelId != null && msg.channelId !== activeChannelIdRef.current) return;
      setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
      if (msg.userId !== me?.id) {
        const mentioned = me?.username ? containsMention(msg.content, me.username) : false;
        if (shouldNotifyRef.current(msg.channelId ?? null, mentioned)) {
          playForUser(msg.userId, mentioned ? "mention" : "message");
          if (notifPermRef.current === "granted" && (document.visibilityState === "hidden" || mentioned)) {
            new Notification(mentioned ? `${msg.username} mentioned you` : msg.username, {
              body: msg.content, tag: `screencrew-room-${roomId}`, silent: !mentioned,
            });
          }
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
    onChannelsUpdated: (rid) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetChannelsQueryKey(roomId) });
    },
    onChannelAccessRevoked: () => {
      // Server evicted us from the current channel (perms/role changed). Refetch the
      // channel list (the gated channel will disappear) and drop to a viewable one.
      queryClient.invalidateQueries({ queryKey: getGetChannelsQueryKey(roomId) });
      setActiveChannelId(null);
      toast({ title: "Channel access changed", description: "You no longer have access to that channel." });
    },
    onRoleUpdated: (rid) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
    },
    onMemberRemoved: (rid) => {
      if (rid !== roomId) return;
      queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
      queryClient.invalidateQueries({ queryKey: getGetBansQueryKey(roomId) });
    },
    onRemovedFromRoom: (rid, banned) => {
      if (rid !== roomId) return;
      toast({
        title: banned ? "You were banned" : "You were removed",
        description: banned ? "An admin banned you from this room." : "An admin removed you from this room.",
        variant: "destructive",
      });
      setLocation("/rooms");
    },
    onWatchResponse: (from, allow) => {
      if (allow) {
        setWatchDeniedBy(prev => prev.filter(id => id !== from));
        return;
      }
      // Streamer declined our request to watch — stop trying and inform us.
      setWatchDeniedBy(prev => prev.includes(from) ? prev : [...prev, from]);
      setViewingStreamOf(prev => (prev === from ? null : prev));
      const name = members?.find(m => m.id === from);
      toast({ title: "Watch declined", description: `${(name && (displayNameOf(name) || name.username)) || "The streamer"} declined to share their screen with you.` });
    },
  });

  useEffect(() => { sendRef.current = send; }, [send]);
  useEffect(() => { isSharingRef.current = isSharing; }, [isSharing]);

  // Report which streams we're watching so streamers see a viewer count.
  const remoteStreamIds = Object.keys(remoteStreams).map(Number).filter(id => remoteStreams[id]);
  const watchingKey = gridView ? remoteStreamIds.join(",") : String(viewingStreamOf ?? "");
  const watchingIds = gridView ? remoteStreamIds : (viewingStreamOf ? [viewingStreamOf] : []);
  const watchingIdsRef = useRef<number[]>(watchingIds);
  watchingIdsRef.current = watchingIds;
  useEffect(() => {
    if (!isConnected || !roomId) return;
    sendRef.current?.({ type: "watching", watching: watchingIdsRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchingKey, gridView, viewingStreamOf, isConnected, roomId]);
  useEffect(() => {
    if (!isConnected || !roomId) return;
    send({ type: "join_room", roomId });
    // Re-assert watching state after (re)joining so viewer counts rehydrate.
    sendRef.current?.({ type: "watching", watching: watchingIdsRef.current });
  }, [isConnected, roomId, send]);

  // Broadcast our chosen status to the room
  useEffect(() => {
    if (!isConnected || !roomId) return;
    send({ type: "status", status: settings.myStatus, statusMessage: settings.myStatusMessage });
  }, [isConnected, roomId, settings.myStatus, settings.myStatusMessage, send]);

  // Tell the room whether we require approval before others can watch our stream.
  useEffect(() => {
    if (!isConnected || !roomId) return;
    send({ type: "watch_prefs", askToWatch: settings.askToWatch });
  }, [isConnected, roomId, settings.askToWatch, send]);

  // When "ask before watching" is on and I'm sharing, surface a request for each
  // crew member who starts watching me, until I allow or deny them.
  useEffect(() => {
    if (!settings.askToWatch || !isSharing || !me) {
      if (watchRequests.length) setWatchRequests([]);
      return;
    }
    const pending: number[] = [];
    for (const entry of Object.values(presence) as any[]) {
      if (!entry?.online || entry.userId === me.id) continue;
      const wantsMe = Array.isArray(entry.watching) && entry.watching.includes(me.id);
      if (wantsMe && !decidedWatchersRef.current.has(entry.userId)) pending.push(entry.userId);
    }
    setWatchRequests(prev => {
      const same = prev.length === pending.length && prev.every(id => pending.includes(id));
      return same ? prev : pending;
    });
  }, [presence, settings.askToWatch, isSharing, me, watchRequests.length]);

  // Reset watch-consent bookkeeping whenever I start/stop sharing.
  useEffect(() => {
    if (!isSharing) {
      decidedWatchersRef.current.clear();
      setWatchRequests([]);
    }
  }, [isSharing]);

  const allowWatcher = useCallback((uid: number) => {
    decidedWatchersRef.current.add(uid);
    setWatchRequests(prev => prev.filter(id => id !== uid));
    sendRef.current?.({ type: "watch_response", to: uid, allow: true });
    sendOffer(uid);
  }, [sendOffer]);

  const denyWatcher = useCallback((uid: number) => {
    decidedWatchersRef.current.add(uid);
    setWatchRequests(prev => prev.filter(id => id !== uid));
    sendRef.current?.({ type: "watch_response", to: uid, allow: false });
  }, []);

  // Tell the server which channel we're viewing so chat/typing/reads scope to it.
  useEffect(() => {
    if (!isConnected || !roomId || activeChannelId == null) return;
    send({ type: "join_channel", channelId: activeChannelId });
  }, [isConnected, roomId, activeChannelId, send]);

  // Drop-in voice: once we've switched to (and joined) the target voice channel, turn on voice.
  useEffect(() => {
    if (pendingVoiceJoinRef.current == null || !isConnected || isInVoice) return;
    if (activeChannelId !== pendingVoiceJoinRef.current) return;
    pendingVoiceJoinRef.current = null;
    void handleJoinVoiceRef.current?.();
  }, [isConnected, isInVoice, activeChannelId]);

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
    // With "ask before watching" on, withhold offers until I approve each
    // watcher (handled by the watch-consent effect). Otherwise, offer the stream
    // to crew currently in the same channel.
    if (settings.askToWatch) {
      decidedWatchersRef.current.clear();
      return;
    }
    if (members && me) members.forEach(m => {
      if (m.id === me.id) return;
      const p = presenceRef.current[m.id];
      if (activeChannelIdRef.current != null && p?.channelId != null && p.channelId !== activeChannelIdRef.current) return;
      sendOffer(m.id);
    });
  };

  // Append a freshly-sent message immediately (dedup by id; the WS echo may also
  // arrive, so guard against duplicates the same way onNewMessage does).
  const appendOwnMessage = useCallback((msg: any) => {
    setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: msg.reactions ?? [] }]);
  }, []);

  const postMessage = useCallback((content: string) => {
    const replyToId = replyingTo?.id;
    const data: any = { content };
    if (activeChannelId != null) data.channelId = activeChannelId;
    if (replyToId) data.replyToId = replyToId;
    sendMessageMutation.mutate({ roomId, data }, { onSuccess: appendOwnMessage });
    setReplyingTo(null);
  }, [roomId, replyingTo, sendMessageMutation, appendOwnMessage, activeChannelId]);

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
      sendMessageMutation.mutate({ roomId, data: activeChannelIdRef.current != null ? { content: token, channelId: activeChannelIdRef.current } : { content: token } }, { onSuccess: appendOwnMessage });
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
      const older = await getRoomMessages(roomId, { before: messages[0].id, limit: 50, ...(activeChannelId != null ? { channelId: activeChannelId } : {}) });
      if (!older || older.length < 50) setHasMore(false);
      if (older?.length) setMessages(prev => [...older, ...prev]);
    } finally { setLoadingMore(false); }
  }, [messages, loadingMore, hasMore, roomId, activeChannelId]);

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
      .filter((p: any) => p.inVoice && p.userId !== me?.id
        && (activeChannelIdRef.current == null || p.channelId == null || p.channelId === activeChannelIdRef.current))
      .forEach((p: any) => sendAudioOffer(p.userId));
  }, [joinVoice, audioConstraints, settings.micGain, send, me?.id, sendAudioOffer]);

  const handleLeaveVoice = useCallback(() => {
    leaveVoice();
    send({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: false });
  }, [leaveVoice, send]);

  useEffect(() => { handleJoinVoiceRef.current = handleJoinVoice; }, [handleJoinVoice]);

  // Drop into a voice channel: switch to it and turn voice on in one click.
  const handleDropInVoice = useCallback((id: number) => {
    if (id === activeChannelId && isInVoice) return;
    if (isInVoice) handleLeaveVoice();
    setActiveChannelId(id);
    pendingVoiceJoinRef.current = id;
  }, [activeChannelId, isInVoice, handleLeaveVoice]);

  // ─── Channels ──────────────────────────────────────────────────────────────
  const invalidateChannels = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetChannelsQueryKey(roomId) });
  }, [queryClient, roomId]);

  const handleSwitchChannel = useCallback((id: number) => {
    if (id === activeChannelId) return;
    const target = channels?.find((c: any) => c.id === id);
    if (isInVoice && target?.type !== "voice") handleLeaveVoice();
    setActiveChannelId(id);
  }, [activeChannelId, channels, isInVoice, handleLeaveVoice]);

  const handleCreateChannel = useCallback(() => {
    const name = newChannelName.trim();
    if (!name) return;
    createChannelMutation.mutate(
      { roomId, data: { name, type: newChannelType, isPrivate: newChannelPrivate, minViewRole: newChannelMinView, minSendRole: newChannelMinSend } },
      { onSuccess: (ch: any) => {
          invalidateChannels();
          setShowCreateChannel(false);
          setNewChannelName("");
          setNewChannelType("text");
          setNewChannelPrivate(false);
          setNewChannelMinView("member");
          setNewChannelMinSend("member");
          if (ch?.id) setActiveChannelId(ch.id);
        } },
    );
  }, [roomId, newChannelName, newChannelType, newChannelPrivate, newChannelMinView, newChannelMinSend, createChannelMutation, invalidateChannels]);

  const handleSetChannelRole = useCallback((channelId: number, field: "minViewRole" | "minSendRole", value: "member" | "mod" | "owner") => {
    updateChannelMutation.mutate(
      { roomId, channelId, data: { [field]: value } },
      { onSuccess: invalidateChannels },
    );
  }, [roomId, updateChannelMutation, invalidateChannels]);

  const handleCreateBot = useCallback(() => {
    const name = newBotName.trim();
    if (!name) return;
    createBotMutation.mutate({ roomId, data: { name } }, {
      onSuccess: (res: any) => {
        queryClient.invalidateQueries({ queryKey: getListBotsQueryKey(roomId) });
        setCreatedBot({ name, token: res.token, webhookUrl: res.webhookUrl });
        setNewBotName("");
      },
      onError: (err: any) => toast({ title: "Couldn't create bot", description: err?.message, variant: "destructive" }),
    });
  }, [roomId, newBotName, createBotMutation, queryClient, toast]);

  const handleDeleteBot = useCallback((botId: number) => {
    if (!window.confirm("Delete this bot? Its webhook will stop working.")) return;
    deleteBotMutation.mutate({ roomId, botId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBotsQueryKey(roomId) }),
    });
  }, [roomId, deleteBotMutation, queryClient]);

  const handleRenameChannel = useCallback((id: number) => {
    const name = editChannelName.trim();
    if (!name) { setEditingChannelId(null); return; }
    updateChannelMutation.mutate(
      { roomId, channelId: id, data: { name } },
      { onSuccess: () => { invalidateChannels(); setEditingChannelId(null); setEditChannelName(""); } },
    );
  }, [roomId, editChannelName, updateChannelMutation, invalidateChannels]);

  const handleToggleChannelPrivate = useCallback((ch: any) => {
    updateChannelMutation.mutate(
      { roomId, channelId: ch.id, data: { isPrivate: !ch.isPrivate } },
      { onSuccess: invalidateChannels },
    );
  }, [roomId, updateChannelMutation, invalidateChannels]);

  const handleDeleteChannel = useCallback((id: number) => {
    if ((channels?.length ?? 0) <= 1) return;
    deleteChannelMutation.mutate(
      { roomId, channelId: id },
      { onSuccess: () => {
          invalidateChannels();
          if (activeChannelId === id) {
            const next = channels?.find((c: any) => c.id !== id);
            setActiveChannelId(next ? next.id : null);
          }
        } },
    );
  }, [roomId, channels, activeChannelId, deleteChannelMutation, invalidateChannels]);

  const handleSetRole = useCallback((userId: number, role: "owner" | "mod" | "member") => {
    updateMemberRoleMutation.mutate(
      { roomId, userId, data: { role } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) }) },
    );
  }, [roomId, updateMemberRoleMutation, queryClient]);

  const handleDenyMember = useCallback((userId: number) => {
    denyMemberMutation.mutate({ roomId, userId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetPendingMembersQueryKey(roomId) }),
      onError: (err: any) => toast({ title: "Failed to deny", description: err?.message, variant: "destructive" }),
    });
  }, [roomId, denyMemberMutation, queryClient, toast]);

  const handleKickMember = useCallback((userId: number, name: string) => {
    if (!window.confirm(`Remove ${name} from this room?`)) return;
    removeMemberMutation.mutate({ roomId, userId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
        toast({ title: "Member removed", description: `${name} was removed from the room.` });
      },
      onError: (err: any) => toast({ title: "Failed to remove", description: err?.message, variant: "destructive" }),
    });
  }, [roomId, removeMemberMutation, queryClient, toast]);

  const handleBanMember = useCallback((userId: number, name: string) => {
    if (!window.confirm(`Ban ${name}? They will be removed and unable to rejoin until unbanned.`)) return;
    banMemberMutation.mutate({ roomId, userId, data: {} }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRoomMembersQueryKey(roomId) });
        queryClient.invalidateQueries({ queryKey: getGetBansQueryKey(roomId) });
        toast({ title: "Member banned", description: `${name} was banned from the room.` });
      },
      onError: (err: any) => toast({ title: "Failed to ban", description: err?.message, variant: "destructive" }),
    });
  }, [roomId, banMemberMutation, queryClient, toast]);

  const handleUnbanMember = useCallback((userId: number) => {
    unbanMemberMutation.mutate({ roomId, userId }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBansQueryKey(roomId) }),
      onError: (err: any) => toast({ title: "Failed to unban", description: err?.message, variant: "destructive" }),
    });
  }, [roomId, unbanMemberMutation, queryClient, toast]);

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

  // ─── Push-to-talk / self-mute ─────────────────────────────────────────────
  // Self-mute and deafen always win: when active, the mic stays off regardless
  // of voice mode or push-to-talk key.
  const micSilenced = selfMuted || deafened;
  useEffect(() => {
    micSilencedRef.current = micSilenced;
    if (micSilenced) {
      // Stop appearing "speaking" the instant we go silent.
      setLocalSpeaking(false);
      sendRef.current?.({ type: "presence", speaking: false, streaming: isSharingRef.current, inVoice: false });
    }
  }, [micSilenced]);
  useEffect(() => {
    if (micSilenced) { setMicEnabled(false); setPttActive(false); return; }
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
  }, [micSilenced, settings.voiceMode, settings.pttKey, micActive, setMicEnabled]);

  // ─── Mute / deafen hotkeys ─────────────────────────────────────────────────
  // Deafening implies muting (you can't be heard while you can't hear); undeafen
  // restores the mic to whatever the mute toggle says.
  const toggleSelfMute = useCallback(() => setSelfMuted(m => !m), []);
  const toggleDeafen = useCallback(() => setDeafened(d => !d), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return; // ignore key-repeat so a held key doesn't oscillate the toggle
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (matchesHotkey(e, settings.muteHotkey)) { e.preventDefault(); toggleSelfMute(); }
      else if (matchesHotkey(e, settings.deafenHotkey)) { e.preventDefault(); toggleDeafen(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [settings.muteHotkey, settings.deafenHotkey, toggleSelfMute, toggleDeafen]);

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

  // ─── Apply room skin (creator-set, scoped to the window so it never fights
  //     the user's global personal theme) ─────────────────────────────────────
  useEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    const skin = room?.themeSkin ? SKIN_PRESETS.find(s => s.id === room.themeSkin) : null;
    if (!skin) {
      clearSkinVars(el);
      el.style.removeProperty("--radius");
      el.style.removeProperty("--app-font-sans");
      el.style.removeProperty("--app-font-mono");
      return;
    }
    applySkinVars(el, skin.colors);
    el.style.setProperty("--radius", skin.windowStyle === "squared" ? "0px" : "0.5rem");
    const font = FONT_OPTIONS.find(f => f.id === skin.font)?.stack ?? FONT_OPTIONS[0].stack;
    el.style.setProperty("--app-font-sans", font);
    el.style.setProperty("--app-font-mono", font);
    return () => {
      clearSkinVars(el);
      el.style.removeProperty("--radius");
      el.style.removeProperty("--app-font-sans");
      el.style.removeProperty("--app-font-mono");
    };
  }, [room?.themeSkin]);

  // ─── Soundboard hotkeys: play bound clip on keypress ──────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bindingClip || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      const hit = Object.entries(settings.soundboardHotkeys).find(([, k]) => k === key);
      if (hit) { e.preventDefault(); playSoundboard(hit[0]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.soundboardHotkeys, playSoundboard, bindingClip]);

  // ─── Soundboard hotkey binding capture ────────────────────────────────────
  useEffect(() => {
    if (!bindingClip) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setBindingClip(null); return; }
      const key = e.key.toLowerCase();
      if (key === " " || key.length === 1) {
        const next = { ...settings.soundboardHotkeys };
        for (const id of Object.keys(next)) if (next[id] === key) delete next[id];
        next[bindingClip] = key;
        setSetting("soundboardHotkeys", next);
      }
      setBindingClip(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bindingClip, settings.soundboardHotkeys, setSetting]);

  // ─── Picture-in-picture for the active stream ─────────────────────────────
  const handlePip = useCallback(async () => {
    const v = streamVideoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* user denied or unsupported */ }
  }, []);

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
  const visibleMessages = useMemo(
    () => messages.filter(m => m.userId === me?.id || !blockedIds.has(m.userId)),
    [messages, blockedIds, me?.id],
  );
  const filteredMessages = searchQuery.trim()
    ? visibleMessages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : visibleMessages;

  // Debounced server-side search across the full room history.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const searchEnabled = showSearch && debouncedSearch.length >= 2 && !!roomId;
  const { data: searchResults, isFetching: searchFetching } = useSearchRoomMessages(
    roomId, { q: debouncedSearch, limit: 40 },
    { query: { enabled: searchEnabled, queryKey: getSearchRoomMessagesQueryKey(roomId, { q: debouncedSearch, limit: 40 }) } }
  );
  // Surface only history matches not already visible in the current loaded view.
  const loadedIds = useMemo(() => new Set(messages.map(m => m.id)), [messages]);
  const historyResults = (searchResults ?? []).filter((m: any) => !loadedIds.has(m.id));

  const typingNames = Object.entries(typingUsers)
    .filter(([uid]) => Number(uid) !== me?.id)
    .map(([, n]) => n);

  const onlineCount = Object.values(presence).filter((p: any) => p?.online).length;

  // Detached pop-out windows (drag a stream onto another monitor).
  const streamPopouts = useStreamPopouts();
  const updatePopoutStreams = streamPopouts.updateStreams;
  useEffect(() => {
    updatePopoutStreams(remoteStreams as Record<number, MediaStream | null | undefined>);
  }, [remoteStreams, updatePopoutStreams]);

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

  const onStreamResizeDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    streamWinResizeRef.current = { sx: e.clientX, w: settings.streamWindowW };
  };
  const onStreamResizeMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!streamWinResizeRef.current) return;
    const w = Math.max(280, Math.min(900, streamWinResizeRef.current.w + e.clientX - streamWinResizeRef.current.sx));
    setSetting("streamWindowW", w);
  };
  const onStreamResizeUp = () => { streamWinResizeRef.current = null; };

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
            muted={deafened || !!settings.userMuted[uid]} />
        ))}
      </div>

      {/* ── Main Panel ── */}
      <div ref={windowRef} className={`relative flex flex-col bg-card border shadow-2xl overflow-hidden transition-[opacity,transform] ${classic ? "rounded-sm border-primary/20" : "rounded-2xl border-border/50"} ${overlayMode ? "opacity-0 pointer-events-none scale-95" : "opacity-100 scale-100"}`}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        style={{
          width: isMobile ? "100vw" : settings.windowSize.w,
          height: isMobile ? "100dvh" : settings.windowSize.h,
          maxWidth: "100vw", maxHeight: "100dvh",
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
              {room.ephemeral && (
                <span className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400/80 text-[10px] font-mono uppercase tracking-wider" title="Temporary room — auto-deleted after inactivity">
                  <Clock className="w-2.5 h-2.5" /> Temp
                </span>
              )}
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
        {/* ── CHANNELS ── */}
        <div className="px-4 shrink-0 pt-1" style={{ order: -1 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">Channels</span>
            <div className="flex items-center gap-0.5">
              {(myRole === "owner") && (
                <button onClick={() => setShowRoles(s => !s)} title="Manage roles"
                  className={`p-1 rounded-md transition-colors ${showRoles ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <Shield className="w-3.5 h-3.5" />
                </button>
              )}
              {isStaff && (
                <button onClick={() => setShowBans(s => !s)} title="Banned users"
                  className={`p-1 rounded-md transition-colors ${showBans ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <Ban className="w-3.5 h-3.5" />
                </button>
              )}
              {isStaff && (
                <button onClick={() => setShowBots(s => !s)} title="Bots & webhooks"
                  className={`p-1 rounded-md transition-colors ${showBots ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <Bot className="w-3.5 h-3.5" />
                </button>
              )}
              {isStaff && (
                <button onClick={() => setShowCreateChannel(s => !s)} title="Create channel"
                  className={`p-1 rounded-md transition-colors ${showCreateChannel ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {showCreateChannel && isStaff && (
            <div className="mb-2.5 space-y-1.5 bg-muted/20 border border-border/30 rounded-lg p-2">
              <Input value={newChannelName} onChange={e => setNewChannelName(e.target.value.slice(0, 40))}
                onKeyDown={e => { if (e.key === "Enter") handleCreateChannel(); }}
                placeholder="channel-name" autoFocus
                className="h-7 rounded-md bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
              <div className="flex items-center gap-1">
                {(["text", "voice", "announcement", "media"] as const).map(t => {
                  const Icon = t === "text" ? Hash : t === "voice" ? Volume2 : t === "announcement" ? Megaphone : ImageIcon;
                  return (
                    <button key={t} onClick={() => setNewChannelType(t)} title={t}
                      className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] transition-colors ${newChannelType === t ? "bg-primary/20 text-primary" : "bg-muted/20 text-muted-foreground/60 hover:text-foreground"}`}>
                      <Icon className="w-3 h-3" />
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 cursor-pointer">
                <input type="checkbox" checked={newChannelPrivate} onChange={e => setNewChannelPrivate(e.target.checked)} className="accent-primary" />
                <Lock className="w-3 h-3" /> Private (staff only)
              </label>
              {newChannelType !== "voice" && (
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">View
                    <select value={newChannelMinView} onChange={e => setNewChannelMinView(e.target.value as any)}
                      className="mt-0.5 w-full text-[10px] bg-muted/30 border border-border/30 rounded-md px-1 py-0.5 text-foreground focus:outline-none">
                      <option value="member">Members</option>
                      <option value="mod">Mods+</option>
                      <option value="owner">Owner only</option>
                    </select>
                  </label>
                  <label className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">Post
                    <select value={newChannelMinSend} onChange={e => setNewChannelMinSend(e.target.value as any)}
                      className="mt-0.5 w-full text-[10px] bg-muted/30 border border-border/30 rounded-md px-1 py-0.5 text-foreground focus:outline-none">
                      <option value="member">Members</option>
                      <option value="mod">Mods+</option>
                      <option value="owner">Owner only</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="flex items-center gap-1 justify-end">
                <button onClick={() => { setShowCreateChannel(false); setNewChannelName(""); }}
                  className="text-[10px] px-2 py-0.5 rounded-md text-muted-foreground/60 hover:text-foreground">Cancel</button>
                <button onClick={handleCreateChannel} disabled={!newChannelName.trim() || createChannelMutation.isPending}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-40">Create</button>
              </div>
            </div>
          )}

          {showBots && isStaff && (
            <div className="mb-2.5 space-y-2 bg-muted/20 border border-border/30 rounded-lg p-2">
              <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest flex items-center gap-1"><Bot className="w-3 h-3" /> Bots & webhooks</p>
              <div className="flex items-center gap-1">
                <Input value={newBotName} onChange={e => setNewBotName(e.target.value.slice(0, 40))}
                  onKeyDown={e => { if (e.key === "Enter") handleCreateBot(); }}
                  placeholder="Bot name"
                  className="h-7 rounded-md bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
                <button onClick={handleCreateBot} disabled={!newBotName.trim() || createBotMutation.isPending}
                  className="text-[10px] font-semibold px-2 py-1 rounded-md bg-primary/20 hover:bg-primary/30 text-primary disabled:opacity-40 shrink-0">Add</button>
              </div>
              {createdBot && (
                <div className="space-y-1 bg-background/60 border border-primary/30 rounded-md p-2">
                  <p className="text-[10px] text-primary/80 font-semibold">{createdBot.name} created — copy the token now, it won't be shown again.</p>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 truncate text-[9px] bg-muted/40 rounded px-1.5 py-1 text-foreground/80">{createdBot.token}</code>
                    <button onClick={() => navigator.clipboard?.writeText(createdBot.token)} title="Copy token"
                      className="p-1 rounded-md text-muted-foreground/60 hover:text-primary"><Copy className="w-3 h-3" /></button>
                  </div>
                  <p className="text-[9px] text-muted-foreground/60 break-all">POST {createdBot.webhookUrl} → {`{ token, content, channelId? }`}</p>
                  <button onClick={() => setCreatedBot(null)} className="text-[9px] text-muted-foreground/50 hover:text-foreground">Dismiss</button>
                </div>
              )}
              {(roomBots ?? []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40">No bots yet.</p>
              ) : (
                (roomBots ?? []).map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <Bot className="w-3 h-3 text-cyan-400/70 shrink-0" />
                    <span className="text-xs flex-1 truncate">{b.name}</span>
                    <button onClick={() => handleDeleteBot(b.id)} disabled={deleteBotMutation.isPending}
                      className="text-[10px] font-semibold rounded-md bg-destructive/15 hover:bg-destructive/25 text-destructive px-2 py-0.5 transition-colors disabled:opacity-40">
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {showRoles && myRole === "owner" && (
            <div className="mb-2.5 space-y-1 bg-muted/20 border border-border/30 rounded-lg p-2">
              <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-1">Roles</p>
              {members?.map((m: any) => {
                const r = (m.role as string) ?? (m.id === room?.createdBy ? "owner" : "member");
                const isRoomOwner = m.id === room?.createdBy;
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate flex items-center gap-1">
                      {r === "owner" ? <Crown className="w-3 h-3 text-amber-400 shrink-0" /> : r === "mod" ? <ShieldCheck className="w-3 h-3 text-primary/70 shrink-0" /> : null}
                      {displayNameOf(m) || m.username}
                    </span>
                    {isRoomOwner ? (
                      <span className="text-[9px] text-amber-400/70 uppercase">owner</span>
                    ) : (
                      <select value={r === "owner" ? "member" : r}
                        onChange={e => handleSetRole(m.id, e.target.value as "mod" | "member")}
                        className="text-[10px] bg-muted/30 border border-border/30 rounded-md px-1 py-0.5 text-foreground focus:outline-none">
                        <option value="member">member</option>
                        <option value="mod">mod</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showBans && isStaff && (
            <div className="mb-2.5 space-y-1 bg-muted/20 border border-border/30 rounded-lg p-2">
              <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-1">Banned</p>
              {(bannedUsers ?? []).length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40">No banned users.</p>
              ) : (
                (bannedUsers ?? []).map((b: any) => (
                  <div key={b.id} className="flex items-center gap-2">
                    <Ban className="w-3 h-3 text-destructive/70 shrink-0" />
                    <span className="text-xs flex-1 truncate">{b.displayName || b.username}</span>
                    <button onClick={() => handleUnbanMember(b.id)} disabled={unbanMemberMutation.isPending}
                      className="text-[10px] font-semibold rounded-md bg-primary/20 hover:bg-primary/30 text-primary px-2 py-0.5 transition-colors disabled:opacity-40">
                      Unban
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="space-y-0.5 mb-3">
            {(channels ?? []).slice().sort((a: any, b: any) => (a.position - b.position) || (a.id - b.id)).map((ch: any) => {
              const Icon = ch.type === "voice" ? Volume2 : ch.type === "announcement" ? Megaphone : ch.type === "media" ? ImageIcon : Hash;
              const active = ch.id === activeChannelId;
              const voiceOccupants = ch.type === "voice"
                ? Object.values(presence).filter((p: any) => p?.online && p?.inVoice && p?.channelId === ch.id)
                : [];
              const meInThisVoice = ch.type === "voice" && isInVoice && activeChannelId === ch.id;
              const voiceCount = voiceOccupants.length;
              if (editingChannelId === ch.id) {
                return (
                  <div key={ch.id} className="flex items-center gap-1 px-1">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    <Input value={editChannelName} onChange={e => setEditChannelName(e.target.value.slice(0, 40))}
                      onKeyDown={e => { if (e.key === "Enter") handleRenameChannel(ch.id); if (e.key === "Escape") setEditingChannelId(null); }}
                      onBlur={() => handleRenameChannel(ch.id)} autoFocus
                      className="h-6 rounded-md bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-xs" />
                  </div>
                );
              }
              return (
                <div key={ch.id}>
                  <div
                    className={`group flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-colors ${active ? "bg-primary/15 text-primary" : "text-muted-foreground/70 hover:bg-muted/20 hover:text-foreground"}`}
                    onClick={() => ch.type === "voice" ? handleDropInVoice(ch.id) : handleSwitchChannel(ch.id)}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-sm truncate flex-1">{ch.name}</span>
                    {ch.isPrivate && <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />}
                    {voiceCount > 0 && <span className="text-[10px] text-violet-400/70 shrink-0">{voiceCount}</span>}
                    {ch.type !== "voice" && (() => {
                      const muted = settings.channelNotify[String(ch.id)] === "none";
                      return (
                        <button onClick={(e) => {
                          e.stopPropagation();
                          const next = { ...settings.channelNotify };
                          if (muted) delete next[String(ch.id)]; else next[String(ch.id)] = "none";
                          setSetting("channelNotify", next);
                        }}
                          title={muted ? "Unmute channel" : "Mute channel"}
                          className={`p-0.5 rounded shrink-0 transition-opacity ${muted ? "text-red-400/70 hover:text-red-400" : "text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100"}`}>
                          {muted ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                        </button>
                      );
                    })()}
                    {isStaff && (
                      <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); handleToggleChannelPrivate(ch); }}
                          title={ch.isPrivate ? "Make public" : "Make private"}
                          className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground">
                          {ch.isPrivate ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingChannelId(ch.id); setEditChannelName(ch.name); }}
                          title="Rename" className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground">
                          <Pencil className="w-3 h-3" />
                        </button>
                        {ch.type !== "voice" && (
                          <button onClick={(e) => { e.stopPropagation(); setPermChannelId(p => p === ch.id ? null : ch.id); }}
                            title="Permissions" className={`p-0.5 rounded hover:text-foreground ${permChannelId === ch.id ? "text-primary/80" : "text-muted-foreground/50"}`}>
                            <Shield className="w-3 h-3" />
                          </button>
                        )}
                        {(channels?.length ?? 0) > 1 && (
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteChannel(ch.id); }}
                            title="Delete channel" className="p-0.5 rounded text-muted-foreground/50 hover:text-red-400">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {isStaff && permChannelId === ch.id && ch.type !== "voice" && (
                    <div className="ml-6 mt-1 mb-1 grid grid-cols-2 gap-1.5 bg-muted/20 border border-border/30 rounded-md p-1.5">
                      <label className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">View
                        <select value={ch.minViewRole ?? "member"} onClick={e => e.stopPropagation()} onChange={e => handleSetChannelRole(ch.id, "minViewRole", e.target.value as any)}
                          className="mt-0.5 w-full text-[10px] bg-muted/30 border border-border/30 rounded-md px-1 py-0.5 text-foreground focus:outline-none">
                          <option value="member">Members</option>
                          <option value="mod">Mods+</option>
                          <option value="owner">Owner only</option>
                        </select>
                      </label>
                      <label className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">Post
                        <select value={ch.minSendRole ?? "member"} onClick={e => e.stopPropagation()} onChange={e => handleSetChannelRole(ch.id, "minSendRole", e.target.value as any)}
                          className="mt-0.5 w-full text-[10px] bg-muted/30 border border-border/30 rounded-md px-1 py-0.5 text-foreground focus:outline-none">
                          <option value="member">Members</option>
                          <option value="mod">Mods+</option>
                          <option value="owner">Owner only</option>
                        </select>
                      </label>
                    </div>
                  )}
                  {ch.type === "voice" && voiceOccupants.length > 0 && (
                    <div className="ml-6 mt-0.5 mb-0.5 flex flex-col gap-0.5">
                      {voiceOccupants.map((p: any) => (
                        <div key={p.userId} className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                          <span className="relative shrink-0">
                            <PixelAvatar userId={p.userId} size={14} square={classic} />
                            {p.speaking && <span className="absolute inset-0 rounded-full border border-green-400/60 animate-ping" />}
                          </span>
                          <span className={`truncate ${p.speaking ? "text-green-400" : ""}`}>
                            {p.displayName || p.username}{p.userId === me?.id ? " (you)" : ""}
                          </span>
                          {p.streaming && <MonitorUp className="w-2.5 h-2.5 text-primary/70 shrink-0" />}
                        </div>
                      ))}
                    </div>
                  )}
                  {meInThisVoice && (
                    <button onClick={(e) => { e.stopPropagation(); handleLeaveVoice(); }}
                      className="ml-6 mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors">
                      <PhoneOff className="w-2.5 h-2.5" /> Leave voice
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── FRIENDS ── */}
        <div className="px-4 shrink-0" style={{ order: settings.panelOrder === "friends" ? 0 : 2 }}>
          <div className="flex items-center justify-between mb-2.5">
            <button onClick={() => setSetting("friendsCollapsed", !settings.friendsCollapsed)}
              title={settings.friendsCollapsed ? "Expand friends" : "Collapse friends"}
              className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/60 hover:text-foreground uppercase tracking-widest transition-colors">
              <ChevronDown className={`w-3 h-3 transition-transform ${settings.friendsCollapsed ? "-rotate-90" : ""}`} />
              Friends
            </button>
            <div className="flex items-center gap-0.5">
              <button onClick={toggleMic}
                title={micActive ? (settings.voiceMode === "ptt" ? `Push-to-talk (${fmtHotkey(settings.pttKey)})` : "Mute mic") : "Enable mic"}
                className={`relative p-1 rounded-md transition-colors ${micActive ? (settings.voiceMode === "ptt" && !pttActive ? "text-amber-400/80" : localSpeaking ? "text-green-400" : "text-primary/80") : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                {micActive && settings.voiceMode === "ptt" && (
                  <span className={`absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${pttActive ? "bg-green-400" : "bg-amber-400"}`} />
                )}
              </button>
              <button onClick={toggleSelfMute}
                title={`${selfMuted ? "Unmute" : "Mute"} yourself (${fmtHotkey(settings.muteHotkey)})`}
                className={`p-1 rounded-md transition-colors ${selfMuted ? "text-red-400" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {selfMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button onClick={toggleDeafen}
                title={`${deafened ? "Undeafen" : "Deafen"} (${fmtHotkey(settings.deafenHotkey)})`}
                className={`p-1 rounded-md transition-colors ${deafened ? "text-red-400" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {deafened ? <HeadphoneOff className="w-3.5 h-3.5" /> : <Headphones className="w-3.5 h-3.5" />}
              </button>
              <button onClick={isSharing ? stopSharing : handleStartShare} title={isSharing ? "Stop sharing" : "Share screen"}
                className={`p-1 rounded-md transition-colors ${isSharing ? "text-primary animate-pulse" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <MonitorUp className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <button onClick={() => setShowQualityPicker(s => !s)} title={`Stream quality: ${VIDEO_QUALITY_LABELS[settings.videoQuality]}`}
                  className={`p-1 rounded-md transition-colors ${showQualityPicker ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <Gauge className="w-3.5 h-3.5" />
                </button>
                {showQualityPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowQualityPicker(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-32 bg-card border border-border/50 rounded-lg shadow-2xl py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                      <p className="px-3 py-1 text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Quality</p>
                      {(Object.keys(VIDEO_QUALITY_LABELS) as VideoQuality[]).map(q => (
                        <button key={q} onClick={() => { setSetting("videoQuality", q); setShowQualityPicker(false); }}
                          className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${settings.videoQuality === q ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}>
                          {VIDEO_QUALITY_LABELS[q]}
                          {settings.videoQuality === q && <Check className="w-3 h-3" />}
                        </button>
                      ))}
                      {isSharing && <p className="px-3 pt-1 text-[9px] text-muted-foreground/40">Applies on next share</p>}
                    </div>
                  </>
                )}
              </div>
              {remoteStreamIds.length > 0 && (
                <button onClick={() => setGridView(g => !g)} title={gridView ? "Close grid view" : "Grid view (all streams)"}
                  className={`p-1 rounded-md transition-colors ${gridView ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={isInVoice ? handleLeaveVoice : handleJoinVoice} title={isInVoice ? "Leave voice" : "Join voice"}
                className={`p-1 rounded-md transition-colors ${isInVoice ? "text-violet-400 animate-pulse" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                {isInVoice ? <PhoneOff className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
              </button>
              {(() => {
                const chLvl = activeChannelId != null ? settings.channelNotify[String(activeChannelId)] : undefined;
                const lvl: NotifyLevel = settings.myStatus === "dnd" ? "none" : (chLvl ?? settings.roomNotify[String(roomId)] ?? "all");
                const NotifIcon = lvl === "none" ? BellOff : lvl === "mentions" ? AtSign : Bell;
                const muted = lvl === "none";
                return (
                  <button onClick={() => { setShowNotif(s => !s); setShowActivityEdit(false); setShowSoundboard(false); }}
                    title="Notifications"
                    className={`p-1 rounded-md transition-colors ${showNotif ? "text-primary/80" : muted ? "text-red-400/70 hover:text-red-400" : lvl === "mentions" ? "text-amber-400/70 hover:text-amber-300" : notifPermission === "granted" ? "text-primary/60" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                    <NotifIcon className="w-3.5 h-3.5" />
                  </button>
                );
              })()}
              <button onClick={() => { setShowActivityEdit(s => !s); setShowSoundboard(false); }} title="Set activity"
                className={`p-1 rounded-md transition-colors ${showActivityEdit || activityInput ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setShowSoundboard(s => !s); setShowActivityEdit(false); }} title="Soundboard"
                className={`p-1 rounded-md transition-colors ${showSoundboard ? "text-primary/80" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                <Megaphone className="w-3.5 h-3.5" />
              </button>
              {isStaff && pendingMembers && pendingMembers.length > 0 && (
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

          {/* Notification settings */}
          {showNotif && (
            <div className="mb-2.5 rounded-lg bg-muted/20 border border-border/30 p-2 space-y-2">
              {notifPermission !== "granted" && (
                <button onClick={requestNotifPermission}
                  className="w-full flex items-center gap-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
                  <BellRing className="w-3 h-3 shrink-0" /> Enable browser notifications
                </button>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/50 mb-1">This server</div>
                <div className="flex gap-1">
                  {([
                    { v: "all" as NotifyLevel, label: "All", Icon: Bell },
                    { v: "mentions" as NotifyLevel, label: "@Mentions", Icon: AtSign },
                    { v: "none" as NotifyLevel, label: "Mute", Icon: BellOff },
                  ]).map(({ v, label, Icon }) => {
                    const cur = settings.roomNotify[String(roomId)] ?? "all";
                    const on = cur === v;
                    return (
                      <button key={v}
                        onClick={() => setSetting("roomNotify", { ...settings.roomNotify, [String(roomId)]: v })}
                        className={`flex-1 flex items-center justify-center gap-1 text-[10px] rounded-md border py-1 transition-colors ${on ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted/20 border-border/30 text-muted-foreground/60 hover:text-foreground"}`}>
                        <Icon className="w-3 h-3" /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={() => setMyStatus(settings.myStatus === "dnd" ? "online" : "dnd", settings.myStatusMessage)}
                className={`w-full flex items-center gap-1.5 text-[11px] rounded-md border py-1 px-1.5 transition-colors ${settings.myStatus === "dnd" ? "bg-red-400/15 border-red-400/40 text-red-400" : "bg-muted/20 border-border/30 text-muted-foreground/60 hover:text-foreground"}`}>
                <BellOff className="w-3 h-3 shrink-0" /> Do not disturb {settings.myStatus === "dnd" ? "(on)" : "(off)"}
              </button>
            </div>
          )}

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
              {SOUNDBOARD_CLIPS.map(clip => {
                const bound = settings.soundboardHotkeys[clip.id];
                const binding = bindingClip === clip.id;
                return (
                  <div key={clip.id} className="relative flex flex-col">
                    <button onClick={() => playSoundboard(clip.id)}
                      className="text-[10px] rounded-t-lg bg-muted/30 hover:bg-primary/15 border border-b-0 border-border/30 hover:border-primary/30 py-1.5 transition-colors text-foreground/80">
                      {clip.label}
                    </button>
                    <button
                      onClick={() => {
                        if (binding) { setBindingClip(null); return; }
                        if (bound) {
                          const next = { ...settings.soundboardHotkeys };
                          delete next[clip.id];
                          setSetting("soundboardHotkeys", next);
                        } else {
                          setBindingClip(clip.id);
                        }
                      }}
                      title={bound ? `Hotkey: ${bound} — click to clear` : "Click, then press a key to bind"}
                      className={`text-[9px] rounded-b-lg border py-0.5 transition-colors font-mono ${binding ? "bg-primary/25 border-primary/50 text-primary animate-pulse" : bound ? "bg-primary/10 border-primary/30 text-primary/90" : "bg-muted/20 border-border/30 text-muted-foreground/50 hover:text-foreground"}`}>
                      {binding ? "press…" : bound ? `⌨ ${bound}` : "⌨ bind"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pending join requests (creator) */}
          {isStaff && showPending && pendingMembers && pendingMembers.length > 0 && (
            <div className="mb-2.5 space-y-1">
              {pendingMembers.map((pm: any) => (
                <div key={pm.id} className="flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-lg px-2 py-1.5">
                  <Hand className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs flex-1 truncate">{displayNameOf(pm) || pm.username} wants to join</span>
                  <button onClick={() => handleApproveMember(pm.id)} disabled={approveMemberMutation.isPending}
                    className="text-[10px] font-semibold rounded-md bg-primary/20 hover:bg-primary/30 text-primary px-2 py-0.5 transition-colors disabled:opacity-40">
                    Approve
                  </button>
                  <button onClick={() => handleDenyMember(pm.id)} disabled={denyMemberMutation.isPending}
                    className="text-[10px] font-semibold rounded-md bg-destructive/15 hover:bg-destructive/25 text-destructive px-2 py-0.5 transition-colors disabled:opacity-40">
                    Deny
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
              const viewerCount = streaming
                ? Object.values(presence).filter((pp: any) => pp?.online && Array.isArray(pp.watching) && pp.watching.includes(member.id)).length
                : 0;

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
                    <div className="flex items-center gap-1 shrink-0">
                      {viewerCount > 0 && (
                        <span title={`${viewerCount} watching`} className="flex items-center gap-0.5 text-[10px] text-primary/60">
                          <Eye className="w-3 h-3" />{viewerCount}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setViewingStreamOf(member.id); streamWindow.setPos({ x: Math.min(340, window.innerWidth - 470), y: 60 }); }}
                        className="p-1 rounded-lg text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="Watch stream">
                        <MonitorUp className="w-4 h-4" />
                      </button>
                    </div>
                  ) : streaming && isMe ? (
                    <span title={`${viewerCount} watching`} className="flex items-center gap-0.5 text-[11px] text-primary/70 shrink-0">
                      <Eye className="w-3.5 h-3.5" />{viewerCount}
                    </span>
                  ) : inVoice ? (
                    <Headphones className="w-3.5 h-3.5 text-violet-400/60 shrink-0" />
                  ) : isMe ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                  ) : null}
                  {/* Staff controls: kick / ban (owner or mod, never on self or owner; mods can't target mods) */}
                  {(() => {
                    const memberRole = (member.role as string) ?? (member.id === room?.createdBy ? "owner" : "member");
                    const canManage = isStaff && !isMe && member.id !== room?.createdBy && (myRole === "owner" || memberRole !== "mod");
                    if (!canManage) return null;
                    const name = displayNameOf(member) || member.username;
                    return (
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); handleKickMember(member.id, name); }}
                          className="p-1 rounded-lg text-muted-foreground/40 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                          title={`Remove ${name}`}>
                          <UserMinus className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleBanMember(member.id, name); }}
                          className="p-1 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title={`Ban ${name}`}>
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })()}
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
                    : [...settings.watchedUsers, member.id])}
                  isBot={!!member.isBot}
                  friendState={friendStateOf(member.id)}
                  blocked={blockedIds.has(member.id)}
                  onAddFriend={() => handleAddFriend(member.username)}
                  onAcceptFriend={() => { const rid = incomingReqByUser.get(member.id); if (rid) handleAcceptFriend(rid); }}
                  onRemoveFriend={() => { const rid = incomingReqByUser.get(member.id); if (friendStateOf(member.id) === "pending_in" && rid) handleDeclineFriend(rid); else handleRemoveFriend(member.id); }}
                  onBlock={() => handleBlockUser(member.id)}
                  onUnblock={() => handleUnblockUser(member.id)}>
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
            <button onClick={() => setSetting("chatCollapsed", false)} title="Expand chat"
              className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/60 hover:text-foreground uppercase tracking-widest transition-colors">
              <ChevronDown className="w-3 h-3 -rotate-90" />
              Chat (hidden)
            </button>
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
                <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest flex items-center gap-1">
                  <button onClick={() => setSetting("chatCollapsed", true)} title="Collapse chat"
                    className="text-muted-foreground/50 hover:text-foreground transition-colors">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {activeChannel ? (
                    <>
                      {activeChannel.type === "voice" ? <Volume2 className="w-3 h-3" /> : activeChannel.type === "announcement" ? <Megaphone className="w-3 h-3" /> : activeChannel.type === "media" ? <ImageIcon className="w-3 h-3" /> : <Hash className="w-3 h-3" />}
                      <span className="normal-case tracking-normal text-foreground/80">{activeChannel.name}</span>
                    </>
                  ) : "Chat"}
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
                  {debouncedSearch.length >= 2 && (
                    <div className="mt-1 rounded-xl border border-border/40 bg-card/95 backdrop-blur-sm overflow-hidden">
                      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/50 border-b border-border/30">
                        {searchFetching ? "Searching history…" : historyResults.length > 0 ? `${historyResults.length} more in history` : "No other matches in history"}
                      </div>
                      {historyResults.length > 0 && (
                        <div className="max-h-56 overflow-y-auto">
                          {historyResults.map((r: any) => {
                            const ch = channels?.find((c: any) => c.id === r.channelId);
                            return (
                              <button key={r.id}
                                onClick={() => { if (r.channelId && r.channelId !== activeChannelId) handleSwitchChannel(r.channelId); setShowSearch(false); setSearchQuery(""); }}
                                className="w-full text-left px-2.5 py-1.5 hover:bg-muted/40 transition-colors border-b border-border/20 last:border-0">
                                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 mb-0.5">
                                  {ch && <span className="text-primary/70">#{ch.name}</span>}
                                  <span className="font-semibold text-foreground/70">{displayNameOf(r) || r.username}</span>
                                  <span className="ml-auto shrink-0">{new Date(r.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                                </div>
                                <div className="text-[11px] text-foreground/80 line-clamp-2">
                                  <MessageContent content={r.content} searchQuery={debouncedSearch} myUsername={me?.username} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
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
                            {msg.isBot && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded bg-cyan-500/20 text-cyan-400 self-center">Bot</span>}
                            <span className={`${tSize} text-foreground/85`}>
                              <MessageContent content={msg.content} searchQuery={searchQuery} myUsername={me.username} embedImages={activeChannel?.type === "media"} />
                              {msg.editedAt && <span className="text-[10px] text-muted-foreground/30 ml-1">(edited)</span>}
                            </span>
                            {(() => { const lp = firstPreviewableLink(msg.content); return lp ? <LinkPreview url={lp} /> : null; })()}
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
              {activeChannel?.type === "announcement" && !isStaff ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 bg-muted/20 border border-border/30 rounded-xl px-3 py-2.5">
                  <Megaphone className="w-3.5 h-3.5 shrink-0" />
                  Only owners and mods can post in announcement channels.
                </div>
              ) : (
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
                    placeholder={activeChannel ? `Message #${activeChannel.name}…` : "Message…  (@ to mention, drag/paste files)"}
                    onFilesPasted={handleFiles}
                    className="rounded-xl bg-muted/25 border border-transparent focus-visible:border-primary/25 focus-visible:outline-none text-sm px-3 py-2 pr-8 placeholder:text-muted-foreground/40 text-foreground" />
                  <button type="button" className="absolute right-2.5 bottom-2 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors">
                    <Smile className="w-4 h-4" />
                  </button>
                </div>
              </div>
              )}
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

      {/* ── Streamer watch-consent prompts ── */}
      {isSharing && settings.askToWatch && watchRequests.length > 0 && (
        <div className="fixed z-[60] top-4 left-1/2 -translate-x-1/2 w-[min(92vw,360px)] space-y-2">
          {watchRequests.map(uid => {
            const requester = members?.find(m => m.id === uid);
            const name = (requester && (displayNameOf(requester) || requester.username)) || `User ${uid}`;
            return (
              <div key={uid} className="flex items-center gap-2 bg-card/95 backdrop-blur border border-primary/40 shadow-2xl rounded-xl px-3 py-2.5">
                <Eye className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs flex-1 truncate"><span className="font-semibold">{name}</span> wants to watch your screen</span>
                <button onClick={() => allowWatcher(uid)}
                  className="text-[11px] font-semibold rounded-md bg-primary/20 hover:bg-primary/30 text-primary px-2.5 py-1 transition-colors">
                  Allow
                </button>
                <button onClick={() => denyWatcher(uid)}
                  className="text-[11px] font-semibold rounded-md bg-destructive/15 hover:bg-destructive/25 text-destructive px-2.5 py-1 transition-colors">
                  Deny
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Floating Stream Window ── */}
      {viewingStreamOf && !overlayMode && (
        <div className={`fixed z-50 overflow-hidden border border-border/50 shadow-2xl bg-[#0a0a0f] rounded-2xl ${isMobile ? "inset-x-2 bottom-2" : ""}`}
          style={isMobile ? undefined : { left: streamWindow.pos.x, top: streamWindow.pos.y, width: settings.streamWindowW }}>
          <div className={`flex items-center justify-between px-4 py-2.5 bg-card/95 border-b border-border/30 select-none ${isMobile ? "" : "cursor-grab active:cursor-grabbing"}`}
            onPointerDown={streamPinned || isMobile ? undefined : streamWindow.onPointerDown}
            onPointerMove={streamPinned || isMobile ? undefined : streamWindow.onPointerMove}
            onPointerUp={streamPinned || isMobile ? undefined : streamWindow.onPointerUp}>
            <div className="flex items-center gap-2">
              <MonitorUp className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-sm font-medium">{viewingUser?.username} is streaming</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setStreamPinned(p => !p)} className={`p-1.5 rounded-lg transition-colors ${streamPinned ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground"}`}>
                {streamPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
              </button>
              {typeof document !== "undefined" && document.pictureInPictureEnabled && (
                <button onClick={handlePip} title="Picture-in-picture" disabled={!activeStream}
                  className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground transition-colors disabled:opacity-30">
                  <PictureInPicture2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => viewingStreamOf && streamPopouts.open(viewingStreamOf, activeStream, `${viewingUser?.username ?? "Stream"} — ScreenCrew`)}
                title="Pop out to a separate window (drag to another monitor)" disabled={!activeStream}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-30 ${viewingStreamOf && streamPopouts.openIds.includes(viewingStreamOf) ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground"}`}>
                <ExternalLink className="w-3.5 h-3.5" />
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
            {activeStream ? <StreamVideo ref={streamVideoRef} stream={activeStream} muted={streamMuted} /> : (
              watchDeniedBy.includes(viewingStreamOf) ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-destructive/50 gap-2">
                  <Ban className="w-10 h-10 opacity-40" />
                  <span className="text-sm">Watch request declined</span>
                </div>
              ) : presence[viewingStreamOf]?.askToWatch ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/40 gap-2">
                  <Hand className="w-10 h-10 opacity-40 animate-pulse" />
                  <span className="text-sm">Waiting for approval…</span>
                  <span className="text-xs text-muted-foreground/30">{viewingUser?.username} must allow you to watch</span>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-2">
                  <MonitorUp className="w-10 h-10 opacity-30" />
                  <span className="text-sm">Waiting for signal…</span>
                </div>
              )
            )}
            {settings.spectrumViz && presence[viewingStreamOf]?.speaking && (
              <div className="absolute bottom-2 right-2 bg-black/40 rounded-md px-1.5 py-1 backdrop-blur-sm">
                <Spectrum stream={remoteAudioStreams[viewingStreamOf]} active bars={12} height={20} color="rgb(74 222 128)" />
              </div>
            )}
            {!isMobile && (
              <div onPointerDown={onStreamResizeDown} onPointerMove={onStreamResizeMove} onPointerUp={onStreamResizeUp}
                title="Drag to resize"
                className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-10 flex items-end justify-end p-0.5 text-white/30 hover:text-white/70">
                <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 fill-current"><path d="M9 1v8H7V3H1V1z" /></svg>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Multi-stream grid view ── */}
      {gridView && !overlayMode && (
        <div className="fixed inset-0 z-[55] bg-background/95 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/30 shrink-0">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">All streams ({remoteStreamIds.length})</span>
            </div>
            <button onClick={() => setGridView(false)} className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-destructive transition-colors" title="Close grid">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {remoteStreamIds.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-2">
                <MonitorUp className="w-10 h-10 opacity-30" />
                <span className="text-sm">No active streams</span>
              </div>
            ) : (
              <div className={`grid gap-3 ${remoteStreamIds.length === 1 ? "grid-cols-1" : remoteStreamIds.length <= 4 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                {remoteStreamIds.map(id => {
                  const streamer = members?.find(m => m.id === id);
                  const isSpeaking = presence[id]?.speaking;
                  return (
                    <button key={id} onClick={() => { setViewingStreamOf(id); setGridView(false); streamWindow.setPos({ x: Math.min(340, window.innerWidth - 470), y: 60 }); }}
                      className={`group relative aspect-video rounded-xl overflow-hidden border bg-black transition-all hover:ring-2 hover:ring-primary/60 ${isSpeaking ? "border-green-400/70 ring-2 ring-green-400/40" : "border-border/40"}`}>
                      <StreamVideo stream={remoteStreams[id]} muted />
                      <span role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); streamPopouts.open(id, remoteStreams[id], `${streamer?.username ?? `User ${id}`} — ScreenCrew`); }}
                        title="Pop out to a separate window"
                        className={`absolute top-2 right-2 p-1.5 rounded-lg backdrop-blur-sm transition-colors ${streamPopouts.openIds.includes(id) ? "bg-primary/20 text-primary" : "bg-black/40 text-white/70 hover:text-white opacity-0 group-hover:opacity-100"}`}>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </span>
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-center gap-2">
                        <MonitorUp className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-xs font-medium text-white truncate">{streamer?.username ?? `User ${id}`}</span>
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-white/70 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Maximize2 className="w-3 h-3" /> Focus
                        </span>
                      </div>
                    </button>
                  );
                })}
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

                {/* Room password */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      {room.hasPassword ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Lock className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      <span>{room.hasPassword ? "Password protected" : "Password"}</span>
                    </div>
                    {room.hasPassword && (
                      <button onClick={() => { handleUpdateRoom({ password: null }); setRoomPasswordInput(""); }}
                        disabled={updateRoomMutation.isPending}
                        className="text-[10px] px-2 py-1 rounded-md bg-muted/30 hover:bg-destructive/15 hover:text-destructive border border-border/30 transition-colors">
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input value={roomPasswordInput} onChange={e => setRoomPasswordInput(e.target.value)}
                      type="text" placeholder={room.hasPassword ? "Set a new password…" : "Set a password…"}
                      className="h-8 text-sm bg-muted/30 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 rounded-lg flex-1" />
                    <Button size="sm" variant="secondary" className="h-8 text-xs px-3 rounded-lg"
                      disabled={updateRoomMutation.isPending || !roomPasswordInput.trim()}
                      onClick={() => { handleUpdateRoom({ password: roomPasswordInput.trim() }); setRoomPasswordInput(""); }}>
                      Set
                    </Button>
                  </div>
                </div>

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

                {/* Room skin (creator sets a full theme everyone in the room sees) */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <Palette className="w-3.5 h-3.5 text-muted-foreground/50" /> Room Skin
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <button onClick={() => handleUpdateRoom({ themeSkin: null })}
                      className={`text-[10px] rounded-lg border py-1.5 transition-colors ${!room.themeSkin ? "bg-primary/20 border-primary/50 text-primary" : "bg-muted/20 border-border/30 text-muted-foreground/70 hover:text-foreground"}`}>
                      None
                    </button>
                    {SKIN_PRESETS.map(skin => (
                      <button key={skin.id} onClick={() => handleUpdateRoom({ themeSkin: skin.id })}
                        className={`flex items-center gap-1.5 text-[10px] rounded-lg border py-1.5 px-2 transition-colors ${room.themeSkin === skin.id ? "border-primary/50 ring-1 ring-primary/40" : "border-border/30 hover:border-primary/30"}`}
                        style={{ backgroundColor: skin.colors.card, color: skin.colors.foreground }}>
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: skin.colors.primary }} />
                        <span className="truncate">{skin.label}</span>
                      </button>
                    ))}
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

      {/* ── Overlay mini live-stream ── */}
      {overlayMode && viewingStreamOf && activeStream && settings.overlayShowStream && (
        <div className="fixed z-[55] select-none" style={{ left: overlayStreamWindow.pos.x, top: overlayStreamWindow.pos.y, width: 260 }}>
          <div className="overflow-hidden rounded-xl border border-primary/30 bg-[#0a0a0f] shadow-2xl">
            <div className="flex items-center justify-between px-2 py-1 bg-card/90 border-b border-border/30 cursor-grab active:cursor-grabbing backdrop-blur-sm"
              onPointerDown={overlayStreamWindow.onPointerDown}
              onPointerMove={overlayStreamWindow.onPointerMove}
              onPointerUp={overlayStreamWindow.onPointerUp}>
              <div className="flex items-center gap-1.5 min-w-0">
                <MonitorUp className="w-3 h-3 text-primary/70 shrink-0" />
                <span className="text-[10px] font-medium truncate">{viewingUser?.username}</span>
              </div>
              <button onClick={() => setSetting("overlayShowStream", false)} onPointerDown={e => e.stopPropagation()}
                title="Hide mini stream" className="text-muted-foreground/40 hover:text-foreground transition-colors shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="relative aspect-video">
              <StreamVideo stream={activeStream} muted />
            </div>
          </div>
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
            {viewingStreamOf && activeStream && (
              <button
                className={`transition-colors ${settings.overlayShowStream ? "text-primary" : "text-muted-foreground/40 hover:text-foreground"}`}
                onClick={() => setSetting("overlayShowStream", !settings.overlayShowStream)}
                onPointerDown={e => e.stopPropagation()}
                title={settings.overlayShowStream ? "Hide mini stream" : "Show mini stream"}>
                <MonitorUp className="w-3 h-3" />
              </button>
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
          defaultSize={settings.chatPopoutSize}
          onSizeChange={size => setSetting("chatPopoutSize", size)}
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
