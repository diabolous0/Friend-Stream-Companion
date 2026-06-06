import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useListRooms, useCreateRoom, useJoinRoomByCode, useGetMe, getListRoomsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MonitorUp, LogOut, Plus, Hash, Copy, Check, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme, ThemeToggle } from "@/lib/theme";

function getLastVisited(roomId: number): Date | null {
  const ts = localStorage.getItem(`screencrew_visited_${roomId}`);
  return ts ? new Date(ts) : null;
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

  const [newRoomName, setNewRoomName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const copyInviteCode = useCallback((e: React.MouseEvent, code: string) => {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code); setTimeout(() => setCopiedCode(null), 2000);
    });
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
    joinRoom.mutate({ data: { inviteCode } }, {
      onSuccess: (room) => {
        if (room.pending) {
          setInviteCode("");
          setShowJoin(false);
          toast({ title: "Knock sent", description: `Waiting for a member of ${room.name} to let you in.` });
          return;
        }
        setLocation(`/room/${room.id}`);
      },
      onError: (err) => toast({ title: "Failed to join room", description: err.message, variant: "destructive" }),
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
            <form onSubmit={handleJoinRoom} className="flex items-center gap-2 px-5 py-3 border-b border-border/20 bg-muted/20">
              <Input value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
                placeholder={classic ? "ACCESS CODE_" : "Invite code…"} autoFocus
                className={`h-8 text-sm bg-background border-border/40 focus-visible:ring-1 focus-visible:ring-primary/40 flex-1 uppercase tracking-wider ${r("rounded-xl", "rounded-sm")}`} />
              <Button type="submit" size="sm" variant="secondary" className={`h-8 text-xs px-4 ${r("rounded-xl", "rounded-sm")}`}
                disabled={joinRoom.isPending || !inviteCode.trim()}>
                {joinRoom.isPending ? "…" : classic ? "CONNECT" : "Join"}
              </Button>
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
                return (
                  <Link key={room.id} href={`/room/${room.id}`}>
                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors border-b border-border/20 last:border-0 cursor-pointer group">
                      <div className={`w-9 h-9 bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0 ${r("rounded-xl", "rounded-sm")}`}>
                        <MonitorUp className="w-4 h-4 text-primary/80" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium truncate ${classic ? "font-mono group-hover:text-primary transition-colors" : ""}`}>{room.name}</p>
                          {hasUnread && <span className="shrink-0 w-2 h-2 rounded-full bg-primary" />}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Users className="w-3 h-3 text-muted-foreground/50" />
                          <span className={`text-xs text-muted-foreground/60 ${classic ? "font-mono" : ""}`}>{room.memberCount} members</span>
                        </div>
                      </div>
                      <button onClick={(e) => copyInviteCode(e, room.inviteCode)}
                        className={`flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground px-2 py-1 hover:bg-muted/40 transition-colors shrink-0 ${r("rounded-lg", "rounded-sm")}`}
                        title="Copy invite code">
                        <Hash className="w-3 h-3" />
                        <span className="font-mono">{room.inviteCode}</span>
                        {copiedCode === room.inviteCode ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
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
