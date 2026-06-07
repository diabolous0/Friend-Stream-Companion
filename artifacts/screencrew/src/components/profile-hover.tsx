import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { avatarSrc, displayNameOf } from "@/lib/avatar";
import { useSettings, BUILTIN_SOUNDS, type UserStatus } from "@/lib/settings";
import { useSounds } from "@/hooks/use-sounds";
import { PixelAvatar } from "@/components/pixel-avatar";
import { Gamepad2, Circle, Play, Volume2, VolumeX, Star, UserPlus, UserMinus, Ban, Check, Clock, Bot } from "lucide-react";

export type FriendState = "none" | "pending_out" | "pending_in" | "friends";

function safeHref(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const AVATAR_BG = [
  "bg-cyan-600", "bg-blue-600", "bg-violet-600", "bg-fuchsia-600",
  "bg-rose-600", "bg-orange-600", "bg-amber-600", "bg-emerald-600",
];
function avatarBg(userId: number) { return AVATAR_BG[userId % AVATAR_BG.length]; }

export const STATUS_META: Record<UserStatus, { label: string; dot: string; text: string }> = {
  online: { label: "Online",        dot: "bg-green-400",  text: "text-green-400" },
  away:   { label: "Away",          dot: "bg-amber-400",  text: "text-amber-400" },
  dnd:    { label: "Do Not Disturb", dot: "bg-red-400",    text: "text-red-400" },
};

function ProfileAvatar({ username, userId, avatarUrl, avatarStyle, size, square }: {
  username: string; userId: number; avatarUrl?: string | null; avatarStyle?: string | null; size: number; square?: boolean;
}) {
  const src = avatarSrc(avatarUrl);
  const rounded = square ? "rounded-md" : "rounded-full";
  if (src) {
    return <img src={src} alt={username} className={`${rounded} object-cover select-none shrink-0`} style={{ width: size, height: size }} />;
  }
  if (avatarStyle === "pixel") {
    return <PixelAvatar userId={userId} size={size} square={square} />;
  }
  return (
    <div className={`${avatarBg(userId)} ${rounded} flex items-center justify-center text-white font-bold select-none shrink-0`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}>
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}

export interface ProfileInfo {
  userId: number;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  avatarStyle?: string | null;
  nameColor?: string | null;
  steamUrl?: string | null;
  discordUrl?: string | null;
  status?: UserStatus | null;
  statusMessage?: string | null;
  online?: boolean;
  isMe?: boolean;
}

function UserSoundControl({ userId }: { userId: number }) {
  const { settings, set } = useSettings();
  const { playSound } = useSounds(settings);
  const value = settings.userSounds[String(userId)] ?? "";
  const update = (id: string) => {
    const next = { ...settings.userSounds };
    if (id) next[String(userId)] = id; else delete next[String(userId)];
    set("userSounds", next);
  };
  return (
    <div className="mt-3 pt-3 border-t border-border/40">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1.5">Message sound</p>
      <div className="flex items-center gap-1.5">
        <select value={value} onChange={(e) => update(e.target.value)}
          className="h-7 px-2 flex-1 rounded-md bg-muted/30 border border-border/40 text-xs text-foreground outline-none focus:border-primary/40 appearance-none cursor-pointer">
          <option value="">Default</option>
          {BUILTIN_SOUNDS.filter((s) => s.id !== "none").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          {settings.customSounds.map((s) => <option key={s.id} value={`custom:${s.id}`}>{s.name}</option>)}
        </select>
        {value && (
          <button onClick={() => playSound(value, true)} title="Preview"
            className="p-1 rounded-md text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors">
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ProfileHoverCard({ user, square, enableUserSound, children, volume, muted, onVolumeChange, onMuteToggle, watched, onWatchToggle, isBot, friendState, blocked, onAddFriend, onAcceptFriend, onRemoveFriend, onBlock, onUnblock }: {
  user: ProfileInfo; square?: boolean; enableUserSound?: boolean; children: React.ReactNode;
  volume?: number; muted?: boolean; onVolumeChange?: (v: number) => void; onMuteToggle?: () => void;
  watched?: boolean; onWatchToggle?: () => void;
  isBot?: boolean;
  friendState?: FriendState; blocked?: boolean;
  onAddFriend?: () => void; onAcceptFriend?: () => void; onRemoveFriend?: () => void;
  onBlock?: () => void; onUnblock?: () => void;
}) {
  const status: UserStatus = user.online === false ? "away" : (user.status ?? "online");
  const meta = user.online === false
    ? { label: "Offline", dot: "bg-muted-foreground/30", text: "text-muted-foreground/50" }
    : STATUS_META[status];

  return (
    <HoverCard openDelay={250} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-64 p-0 overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <ProfileAvatar username={user.username} userId={user.userId} avatarUrl={user.avatarUrl} avatarStyle={user.avatarStyle} size={48} square={square} />
              <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-popover ${meta.dot}`} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight truncate" style={user.nameColor ? { color: user.nameColor } : undefined}>
                {displayNameOf(user) || user.username}
                {user.isMe && <span className="text-muted-foreground/40 font-normal"> (you)</span>}
              </p>
              <p className="text-xs text-muted-foreground/60 truncate">@{user.username}</p>
            </div>
          </div>

          <div className={`mt-3 flex items-center gap-1.5 text-xs ${meta.text}`}>
            <Circle className="w-2 h-2 fill-current" />
            <span className="font-medium">{meta.label}</span>
          </div>
          {user.statusMessage && user.online !== false && (
            <p className="mt-1 text-xs text-muted-foreground/80 italic break-words">“{user.statusMessage}”</p>
          )}

          {(user.steamUrl || user.discordUrl) && (
            <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
              {user.steamUrl && (() => {
                const href = safeHref(user.steamUrl);
                const label = user.steamUrl.replace(/^https?:\/\//, "");
                return href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-muted-foreground/70 hover:text-primary transition-colors">
                    <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </a>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <Gamepad2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </div>
                );
              })()}
              {user.discordUrl && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden="true">
                    <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.5a18.3 18.3 0 0 1 4.3 1.4c-2-1-4.3-1.5-6.7-1.5s-4.7.5-6.7 1.5A18.3 18.3 0 0 1 8.6 3.5L8.4 3a19.8 19.8 0 0 0-4.7 1.4C1 9 0 13.5.3 18a19.9 19.9 0 0 0 6 3l.8-1.3a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1l.8 1.3a19.9 19.9 0 0 0 6-3c.4-5.2-.9-9.6-2.9-13.6ZM8.5 15.3c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2Zm7 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2Z" />
                  </svg>
                  <span className="truncate">{user.discordUrl}</span>
                </div>
              )}
            </div>
          )}

          {!user.isMe && (onVolumeChange || onMuteToggle) && (
            <div className="mt-3 pt-3 border-t border-border/40 flex items-center gap-2">
              <button onClick={onMuteToggle} title={muted ? "Unmute" : "Mute"}
                className={`shrink-0 transition-colors ${muted ? "text-red-400" : "text-muted-foreground/60 hover:text-foreground"}`}>
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input type="range" min={0} max={100} value={muted ? 0 : (volume ?? 100)} disabled={muted}
                onChange={(e) => onVolumeChange?.(Number(e.target.value))}
                className="flex-1 h-1 accent-primary cursor-pointer disabled:opacity-40" />
              <span className="text-[10px] text-muted-foreground/50 w-7 text-right tabular-nums">{muted ? 0 : (volume ?? 100)}</span>
            </div>
          )}

          {!user.isMe && onWatchToggle && (
            <button onClick={onWatchToggle}
              className={`mt-2 w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border transition-colors ${watched ? "border-amber-400/50 bg-amber-400/10 text-amber-400" : "border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border"}`}>
              <Star className={`w-3.5 h-3.5 ${watched ? "fill-current" : ""}`} />
              {watched ? "Watching — notify when online" : "Notify when online"}
            </button>
          )}

          {isBot && (
            <div className="mt-3 pt-3 border-t border-border/40 flex items-center gap-1.5 text-xs text-cyan-400">
              <Bot className="w-3.5 h-3.5" />
              <span className="font-medium">Bot account</span>
            </div>
          )}

          {!user.isMe && !isBot && (onAddFriend || onBlock || onUnblock) && (
            <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
              {blocked ? (
                <button onClick={onUnblock}
                  className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-red-400/40 bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors">
                  <Ban className="w-3.5 h-3.5" /> Unblock
                </button>
              ) : (
                <>
                  {friendState === "friends" && (
                    <button onClick={onRemoveFriend}
                      className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors">
                      <UserMinus className="w-3.5 h-3.5" /> Remove friend
                    </button>
                  )}
                  {friendState === "pending_out" && (
                    <button onClick={onRemoveFriend}
                      className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors">
                      <Clock className="w-3.5 h-3.5" /> Cancel request
                    </button>
                  )}
                  {friendState === "pending_in" && (
                    <div className="flex gap-1.5">
                      <button onClick={onAcceptFriend}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-green-400/40 bg-green-400/10 text-green-400 hover:bg-green-400/20 transition-colors">
                        <Check className="w-3.5 h-3.5" /> Accept
                      </button>
                      <button onClick={onRemoveFriend}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border transition-colors">
                        Decline
                      </button>
                    </div>
                  )}
                  {(friendState === "none" || friendState === undefined) && onAddFriend && (
                    <button onClick={onAddFriend}
                      className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      <UserPlus className="w-3.5 h-3.5" /> Add friend
                    </button>
                  )}
                  {onBlock && (
                    <button onClick={onBlock}
                      className="w-full flex items-center justify-center gap-1.5 text-xs rounded-lg py-1.5 border border-border/40 text-muted-foreground/60 hover:text-red-400 hover:border-red-400/40 transition-colors">
                      <Ban className="w-3.5 h-3.5" /> Block
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {enableUserSound && !user.isMe && !isBot && <UserSoundControl userId={user.userId} />}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "dnd", label: "Do Not Disturb" },
];

export function StatusPicker({ status, statusMessage, onChange, children }: {
  status: UserStatus;
  statusMessage: string;
  onChange: (status: UserStatus, message: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-60 p-2">
        <p className="px-1.5 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Set status</p>
        <div className="space-y-0.5">
          {STATUS_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => onChange(o.value, statusMessage)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
                status === o.value ? "bg-primary/15 text-primary" : "hover:bg-muted/40 text-foreground/90"
              }`}>
              <Circle className={`w-2 h-2 fill-current ${STATUS_META[o.value].text}`} />
              {o.label}
            </button>
          ))}
        </div>
        <div className="mt-2 pt-2 border-t border-border/40">
          <input
            value={statusMessage}
            onChange={(e) => onChange(status, e.target.value.slice(0, 120))}
            placeholder="Custom message…"
            className="w-full bg-input/60 border border-border/50 rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary/50"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
