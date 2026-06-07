import { useState, useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useListRooms, useCreateRoom, useJoinRoomByCode, useGetMe, getListRoomsQueryKey,
  useListFriends, getListFriendsQueryKey,
  useListFriendRequests, getListFriendRequestsQueryKey,
  useSendFriendRequest, useAcceptFriendRequest, useDeclineFriendRequest, useRemoveFriend,
  useListBlocks, getListBlocksQueryKey, useUnblockUser,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MonitorUp, LogOut, Plus, Hash, Copy, Check, Users, Lock, Clock, Volume2, Link as LinkIcon, UserPlus, UserCheck, UserX, Ban } from "lucide-react";
import { PixelAvatar } from "@/components/pixel-avatar";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme, ThemeToggle } from "@/lib/theme";

function getLastVisited(roomId: number): Date | null {
  const ts = localStorage.getItem(`screencrew_visited_${roomId}`);
  return ts ? new Date(ts) : null;
}

function relTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24); if (dd < 7) return `${dd}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const AVATAR_COLORS = [
  "bg-violet-600", "bg-blue-500", "bg-green-600", "bg-orange-500",
  "bg-pink-600", "bg-yellow-500", "bg-cyan-600", "bg-rose-600",
];

export default function Rooms() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { data: rooms, isLoading } = useListRooms({
    query: { queryKey: getListRoomsQueryKey(), refetchInterval: 10000 },
  });
  const { theme } = useTheme();
  const classic = theme === "classic";

  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoomByCode();

  const { data: friends } = useListFriends({ query: { queryKey: getListFriendsQueryKey(), refetchInterval: 15000 } });
  const { data: friendRequests } = useListFriendRequests({ query: { queryKey: getListFriendRequestsQueryKey(), refetchInterval: 15000 } });
  const { data: blocks } = useListBlocks({ query: { queryKey: getListBlocksQueryKey(), refetchInterval: 30000 } });
  const sendFriendRequest = useSendFriendRequest();
  const acceptFriendRequest = useAcceptFriendRequest();
  const declineFriendRequest = useDeclineFriendRequest();
  const removeFriend = useRemoveFriend();
  const unblockUser = useUnblockUser();

  const [showFriends, setShowFriends] = useState(false);
  const [friendUsername, setFriendUsername] = useState("");

  const invalidateFriends = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListFriendsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListFriendRequestsQueryKey() });
  }, [queryClient]);

  const handleSendFriendRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const username = friendUsername.trim();
    if (!username) return;
    sendFriendRequest.mutate({ data: { username } }, {
      onSuccess: () => { setFriendUsername(""); invalidateFriends(); toast({ title: "Friend request sent", description: `Waiting for ${username} to accept.` }); },
      onError: (err) => toast({ title: "Couldn't send request", description: err.message, variant: "destructive" }),
    });
  };

  const handleAcceptFriend = (id: number) => acceptFriendRequest.mutate({ id }, { onSuccess: invalidateFriends });
  const handleDeclineFriend = (id: number) => declineFriendRequest.mutate({ id }, { onSuccess: invalidateFriends });
  const handleRemoveFriend = (userId: number) => removeFriend.mutate({ userId }, { onSuccess: invalidateFriends });
  const handleUnblock = (userId: number) => unblockUser.mutate({ userId }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListBlocksQueryKey() }) });

  const pendingCount = (friendRequests?.incoming?.length ?? 0);

  const [newRoomName, setNewRoomName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [joinNeedsPassword, setJoinNeedsPassword] = useState(false);

  const copyInviteCode = useCallback((e: React.MouseEvent, code: string) => {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code); setTimeout(() => setCopiedCode(null), 2000);
    });
  }, []);

  const copyInviteLink = useCallback((e: React.MouseEvent, code: string) => {
    e.preventDefault(); e.stopPropagation();
    const link = `${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedCode(`link:${code}`); setTimeout(() => setCopiedCode(null), 2000);
      toast({ title: "Invite link copied", description: "Share it with your crew to let them join." });
    });
  }, [toast]);

  // If arriving via a shareable invite link (?join=CODE), prefill the join form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("join");
    if (!code) return;
    setInviteCode(code.toUpperCase());
    setShowJoin(true);
    // Strip the query param so a refresh doesn't re-trigger.
    const url = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, "", url);
  }, []);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    createRoom.mutate({ data: { name: newRoomName } }, {
      onSuccess: (room) => setLocation(`/room/${room.id}`),
      onError: (err) => toast({ title: "Failed to create room", description: err.message, variant: "destructive" }),
    });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    const data = joinPassword.trim() ? { inviteCode, password: joinPassword.trim() } : { inviteCode };
    joinRoom.mutate({ data }, {
      onSuccess: (room) => {
        if (room.pending) {
          setInviteCode("");
          setShowJoin(false);
          setJoinPassword("");
          setJoinNeedsPassword(false);
          toast({ title: "Knock sent", description: `Waiting for a member of ${room.name} to let you in.` });
          return;
        }
        setLocation(`/room/${room.id}`);
      },
      onError: (err) => {
        if (/password/i.test(err.message)) {
          const wasAsking = joinNeedsPassword;
          setJoinNeedsPassword(true);
          toast({
            title: wasAsking ? "Incorrect password" : "Password required",
            description: "This room is password protected.",
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Failed to join room", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("screencrew_token");
    queryClient.clear();
    setLocation("/");
  };

  if (!me) return null;

  const avatarColor = AVATAR_COLORS[me.id % AVATAR_COLORS.length];
  const initials = me.username.substring(0, 2).toUpperCase();
  const r = (base: string, classicClass: string) => classic ? classicClass : base;

  const recent = (rooms ?? [])
    .map(room => ({ room, visited: getLastVisited(room.id) }))
    .filter((x): x is { room: typeof x.room; visited: Date } => x.visited != null)
    .sort((a, b) => b.visited.getTime() - a.visited.getTime())
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      {classic && <div className="absolute top-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />}

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 bg-primary/15 border border-primary/25 flex items-center justify-center ${r("rounded-xl", "rounded-sm")}`}>
              <MonitorUp className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className={`font-semibold text-base text-foreground ${classic ? "font-mono tracking-widest uppercase text-primary" : ""}`}>
                {classic ? "SCREENCREW" : "ScreenCrew"}
              </h1>
              <p className={`text-xs text-muted-foreground ${classic ? "font-mono" : ""}`}>
                {classic ? "ACTIVE NODES" : "Your rooms"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 ${avatarColor} flex items-center justify-center text-white text-[11px] font-bold ${r("rounded-full", "rounded-sm")}`}>
                {initials}
              </div>
              <span className={`text-sm text-muted-foreground ${classic ? "font-mono" : ""}`}>{me.username}</span>
            </div>
            <button onClick={handleLogout}
              className={`p-2 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40 transition-colors ${r("rounded-lg", "rounded-sm")}`}
              title={classic ? "DISCONNECT" : "Sign out"}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Recent rooms */}
        {recent.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> {classic ? "RECENT NODES" : "Recent"}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {recent.map(({ room, visited }) => (
                <Link key={room.id} href={`/room/${room.id}`}>
                  <div className={`flex items-center gap-2 px-3 py-2 bg-card border border-border/50 hover:border-primary/40 hover:bg-muted/20 transition-colors cursor-pointer shrink-0 ${r("rounded-xl", "rounded-sm")}`}>
                    <div className={`w-7 h-7 bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 ${r("rounded-lg", "rounded-sm")}`}>
                      <MonitorUp className="w-3.5 h-3.5 text-primary/80" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-medium truncate max-w-[110px] flex items-center gap-1 ${classic ? "font-mono" : ""}`}>
                        {room.hasPassword && <Lock className="w-2.5 h-2.5 text-amber-400 shrink-0" />}
                        {room.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground/50">{relTime(visited)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Friends card */}
        <div className={`bg-card border border-border/50 overflow-hidden shadow-xl mb-4 ${r("rounded-2xl", "rounded-sm border-primary/20")}`}>
          <button onClick={() => setShowFriends(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 border-b border-border/30 hover:bg-muted/20 transition-colors">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Users className="w-3.5 h-3.5" /> {classic ? "CREW" : "Friends"}
              {(friends?.length ?? 0) > 0 && <span className="text-muted-foreground/50">{friends?.length}</span>}
            </span>
            <span className="flex items-center gap-2">
              {pendingCount > 0 && (
                <span className="text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">{pendingCount}</span>
              )}
              <Plus className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform ${showFriends ? "rotate-45" : ""}`} />
            </span>
          </button>

          {showFriends && (
            <div className="px-5 py-3 space-y-3">
              {/* Add friend */}
              <form onSubmit={handleSendFriendRequest} className="flex items-center gap-2">
                <Input value={friendUsername} onChange={e => setFriendUsername(e.target.value)}
                  placeholder={classic ? "ADD BY HANDLE_" : "Add friend by username…"}
                  className={`h-8 text-sm bg-background border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40 flex-1 ${r("rounded-xl", "rounded-sm")}`} />
                <Button type="submit" size="sm" className={`h-8 text-xs px-3 ${r("rounded-xl", "rounded-sm")}`}
                  disabled={sendFriendRequest.isPending || !friendUsername.trim()}>
                  <UserPlus className="w-3.5 h-3.5" />
                </Button>
              </form>

              {/* Incoming requests */}
              {(friendRequests?.incoming?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Requests</p>
                  {friendRequests!.incoming.map(req => (
                    <div key={req.id} className="flex items-center gap-2">
                      <PixelAvatar userId={req.user.id} size={20} square={classic} />
                      <span className="text-sm flex-1 truncate">{req.user.displayName || req.user.username}</span>
                      <button onClick={() => handleAcceptFriend(req.id)} title="Accept"
                        className="p-1 rounded-md text-green-400/80 hover:text-green-400 hover:bg-green-400/10"><UserCheck className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDeclineFriend(req.id)} title="Decline"
                        className="p-1 rounded-md text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10"><UserX className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Outgoing requests */}
              {(friendRequests?.outgoing?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest">Pending</p>
                  {friendRequests!.outgoing.map(req => (
                    <div key={req.id} className="flex items-center gap-2 opacity-70">
                      <PixelAvatar userId={req.user.id} size={20} square={classic} />
                      <span className="text-sm flex-1 truncate">{req.user.displayName || req.user.username}</span>
                      <span className="text-[10px] text-muted-foreground/50">sent</span>
                      <button onClick={() => handleDeclineFriend(req.id)} title="Cancel"
                        className="p-1 rounded-md text-muted-foreground/50 hover:text-red-400 hover:bg-red-400/10"><UserX className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Friends list */}
              <div className="space-y-1">
                {(friends?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground/40 py-1">No friends yet — add someone by username.</p>
                ) : (
                  friends!.map(f => (
                    <div key={f.id} className="flex items-center gap-2 group">
                      <PixelAvatar userId={f.id} size={20} square={classic} />
                      <span className="text-sm flex-1 truncate">{f.displayName || f.username}</span>
                      <button onClick={() => handleRemoveFriend(f.id)} title="Remove friend"
                        className="p-1 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-opacity"><UserX className="w-3.5 h-3.5" /></button>
                    </div>
                  ))
                )}
              </div>

              {/* Blocked users */}
              {(blocks?.length ?? 0) > 0 && (
                <div className="space-y-1 pt-1 border-t border-border/20">
                  <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-widest flex items-center gap-1"><Ban className="w-2.5 h-2.5" /> Blocked</p>
                  {blocks!.map(b => (
                    <div key={b.id} className="flex items-center gap-2 opacity-60">
                      <PixelAvatar userId={b.id} size={20} square={classic} />
                      <span className="text-sm flex-1 truncate">{b.displayName || b.username}</span>
                      <button onClick={() => handleUnblock(b.id)} title="Unblock"
                        className="text-[10px] font-semibold rounded-md px-2 py-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/40">Unblock</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Room list card */}
        <div className={`bg-card border border-border/50 overflow-hidden shadow-xl mb-4 ${r("rounded-2xl", "rounded-sm border-primary/20")}`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              {classic ? "NODES" : "Rooms"}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setShowJoin(j => !j); setShowCreate(false); }}
                className={`text-xs px-3 py-1.5 font-medium transition-colors ${r("rounded-lg", "rounded-sm")} ${showJoin
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}>
                {classic ? "CONNECT" : "Join"}
              </button>
              <button onClick={() => { setShowCreate(c => !c); setShowJoin(false); }}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 font-medium transition-colors ${r("rounded-lg", "rounded-sm")} ${showCreate
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}>
                <Plus className="w-3.5 h-3.5" />{classic ? "INIT" : "Create"}
              </button>
            </div>
          </div>

          {showCreate && (
            <form onSubmit={handleCreateRoom} className="flex items-center gap-2 px-5 py-3 border-b border-border/20 bg-muted/20">
              <Input value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
                placeholder={classic ? "Room Designation_" : "Room name…"} autoFocus
                className={`h-8 text-sm bg-background border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40 flex-1 ${r("rounded-xl", "rounded-sm")}`} />
              <Button type="submit" size="sm" className={`h-8 text-xs px-4 ${r("rounded-xl", "rounded-sm")}`}
                disabled={createRoom.isPending || !newRoomName.trim()}>
                {createRoom.isPending ? "…" : classic ? "CREATE" : "Create"}
              </Button>
            </form>
          )}

          {showJoin && (
            <form onSubmit={handleJoinRoom} className="flex flex-col gap-2 px-5 py-3 border-b border-border/20 bg-muted/20">
              <div className="flex items-center gap-2">
                <Input value={inviteCode} onChange={e => { setInviteCode(e.target.value.toUpperCase()); setJoinNeedsPassword(false); setJoinPassword(""); }}
                  placeholder={classic ? "ACCESS CODE_" : "Invite code…"} autoFocus
                  className={`h-8 text-sm bg-background border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40 flex-1 uppercase tracking-wider ${r("rounded-xl", "rounded-sm")}`} />
                <Button type="submit" size="sm" variant="secondary" className={`h-8 text-xs px-4 ${r("rounded-xl", "rounded-sm")}`}
                  disabled={joinRoom.isPending || !inviteCode.trim()}>
                  {joinRoom.isPending ? "…" : classic ? "CONNECT" : "Join"}
                </Button>
              </div>
              {joinNeedsPassword && (
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <Input value={joinPassword} onChange={e => setJoinPassword(e.target.value)} type="password"
                    placeholder={classic ? "PASSWORD_" : "Room password…"} autoFocus
                    className={`h-8 text-sm bg-background border-amber-400/40 focus-visible:ring-1 focus-visible:ring-amber-400/40 flex-1 ${r("rounded-xl", "rounded-sm")}`} />
                </div>
              )}
            </form>
          )}

          {isLoading ? (
            <div className="space-y-px">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                  <div className={`w-9 h-9 bg-muted/50 shrink-0 ${r("rounded-xl", "rounded-sm")}`} />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-muted/50 rounded w-24" />
                    <div className="h-3 bg-muted/30 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : rooms?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className={`w-12 h-12 bg-muted/30 flex items-center justify-center mb-3 ${r("rounded-2xl", "rounded-sm")}`}>
                <MonitorUp className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <p className={`text-sm text-muted-foreground ${classic ? "font-mono" : ""}`}>
                {classic ? "NO ACTIVE CONNECTIONS" : "No rooms yet"}
              </p>
              <p className={`text-xs text-muted-foreground/60 mt-1 ${classic ? "font-mono" : ""}`}>
                {classic ? "Initialize a room or connect via code" : "Create one or join with an invite code"}
              </p>
            </div>
          ) : (
            <div>
              {rooms?.map(room => {
                const lastVisited = getLastVisited(room.id);
                const hasUnread = room.lastMessageAt ? !lastVisited || new Date(room.lastMessageAt) > lastVisited : false;
                const voiceMembers = room.voiceMembers ?? [];
                return (
                  <Link key={room.id} href={`/room/${room.id}`}>
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors border-b border-border/20 last:border-0 cursor-pointer group">
                      <div className={`w-9 h-9 bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 ${r("rounded-xl", "rounded-sm")}`}>
                        <MonitorUp className="w-4 h-4 text-primary/80" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {room.hasPassword && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                          <p className={`text-sm font-medium truncate ${classic ? "font-mono group-hover:text-primary transition-colors" : ""}`}>{room.name}</p>
                          {hasUnread && <span className="shrink-0 w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        {voiceMembers.length > 0 ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Volume2 className="w-3 h-3 text-violet-400 shrink-0" />
                            <div className="flex -space-x-1.5 shrink-0">
                              {voiceMembers.slice(0, 4).map(vm => (
                                <span key={vm.userId} className="ring-2 ring-card rounded-full" title={vm.displayName || vm.username}>
                                  <PixelAvatar userId={vm.userId} size={16} square={classic} />
                                </span>
                              ))}
                            </div>
                            <span className={`text-xs text-violet-400/80 ${classic ? "font-mono" : ""}`}>
                              {voiceMembers.length} in voice
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Users className="w-3 h-3 text-muted-foreground/50" />
                            <span className={`text-xs text-muted-foreground/60 ${classic ? "font-mono" : ""}`}>{room.memberCount} members</span>
                          </div>
                        )}
                      </div>
                      {voiceMembers.length > 0 && (
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); const ch = voiceMembers.find(vm => vm.channelId != null)?.channelId; setLocation(`/room/${room.id}${ch != null ? `?voice=${ch}` : "?voice=1"}`); }}
                          className={`flex items-center gap-1 text-xs text-violet-300 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 px-2.5 py-1.5 transition-colors shrink-0 ${r("rounded-lg", "rounded-sm")}`}
                          title="Drop into voice">
                          <Volume2 className="w-3.5 h-3.5" />
                          <span className={classic ? "font-mono" : ""}>Drop in</span>
                        </button>
                      )}
                      <button onClick={(e) => copyInviteCode(e, room.inviteCode)}
                        className={`flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground px-2 py-1 hover:bg-muted/40 transition-colors shrink-0 ${r("rounded-lg", "rounded-sm")}`}
                        title="Copy invite code">
                        <Hash className="w-3 h-3" />
                        <span className="font-mono">{room.inviteCode}</span>
                        {copiedCode === room.inviteCode ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                      <button onClick={(e) => copyInviteLink(e, room.inviteCode)}
                        className={`flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground px-2 py-1 hover:bg-muted/40 transition-colors shrink-0 ${r("rounded-lg", "rounded-sm")}`}
                        title="Copy invite link">
                        {copiedCode === `link:${room.inviteCode}` ? <Check className="w-3 h-3 text-green-400" /> : <LinkIcon className="w-3 h-3" />}
                        <span className={classic ? "font-mono" : ""}>Link</span>
                      </button>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <div className="flex items-center justify-center gap-2">
          <span className="text-[10px] text-muted-foreground/40">UI style:</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
