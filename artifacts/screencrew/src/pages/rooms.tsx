import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListRooms, useCreateRoom, useJoinRoomByCode, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Users, LogOut, Plus, Hash } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Rooms() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { data: rooms, isLoading } = useListRooms();

  const createRoom = useCreateRoom();
  const joinRoom = useJoinRoomByCode();

  const [newRoomName, setNewRoomName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName) return;
    createRoom.mutate({ data: { name: newRoomName } }, {
      onSuccess: (room) => {
        setLocation(`/room/${room.id}`);
      },
      onError: (err) => {
        toast({ title: "Failed to create room", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode) return;
    joinRoom.mutate({ data: { inviteCode } }, {
      onSuccess: (room) => {
        setLocation(`/room/${room.id}`);
      },
      onError: (err) => {
        toast({ title: "Failed to join room", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("screencrew_token");
    queryClient.clear();
    setLocation("/");
  };

  if (!me) return null;

  return (
    <div className="min-h-screen bg-background crt-scanline font-sans flex flex-col items-center py-12 px-4 relative">
      <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      
      <div className="w-full max-w-4xl flex items-center justify-between mb-12">
        <h1 className="font-mono text-2xl font-bold text-primary tracking-widest uppercase">ScreenCrew</h1>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm text-muted-foreground">USER: <span className="text-foreground">{me.username}</span></span>
          <Button variant="outline" size="sm" onClick={handleLogout} className="rounded-sm font-mono text-xs border-primary/30 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30">
            <LogOut className="w-3 h-3 mr-2" /> Disconnect
          </Button>
        </div>
      </div>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-8">
        
        <div className="md:col-span-2 space-y-6">
          <div className="flex items-center justify-between border-b border-primary/20 pb-2">
            <h2 className="font-mono text-lg text-primary uppercase">Active Nodes</h2>
          </div>
          
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-muted/10 animate-pulse rounded-sm border border-primary/10" />
              ))}
            </div>
          ) : rooms?.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-primary/20 bg-muted/5 rounded-sm">
              <p className="font-mono text-sm text-muted-foreground">NO ACTIVE CONNECTIONS</p>
              <p className="font-mono text-xs text-muted-foreground/60 mt-2">Create or join a room to begin</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rooms?.map(room => (
                <Link key={room.id} href={`/room/${room.id}`}>
                  <div className="group block p-4 border border-primary/20 bg-card hover:bg-primary/5 hover:border-primary/50 transition-all cursor-pointer rounded-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-8 h-8 bg-primary/10 translate-x-4 -translate-y-4 rotate-45 group-hover:bg-primary/20 transition-colors" />
                    <h3 className="font-mono text-lg font-bold mb-2 group-hover:text-primary transition-colors">{room.name}</h3>
                    <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                      <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {room.memberCount} members</span>
                      <span className="flex items-center gap-1.5 opacity-50"><Hash className="w-3.5 h-3.5" /> {room.inviteCode}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-8">
          <div className="bg-card border border-primary/20 p-5 rounded-sm">
            <h2 className="font-mono text-sm text-primary uppercase mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Initialize Room
            </h2>
            <form onSubmit={handleCreateRoom} className="space-y-3">
              <Input 
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                placeholder="Room Designation"
                className="font-mono text-sm rounded-sm bg-background border-primary/20 h-9 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
              />
              <Button type="submit" className="w-full font-mono text-xs uppercase h-9 rounded-sm" disabled={createRoom.isPending || !newRoomName}>
                {createRoom.isPending ? "Initializing..." : "Create"}
              </Button>
            </form>
          </div>

          <div className="bg-card border border-primary/20 p-5 rounded-sm">
            <h2 className="font-mono text-sm text-primary uppercase mb-4 flex items-center gap-2">
              <Hash className="w-4 h-4" /> Connect via Code
            </h2>
            <form onSubmit={handleJoinRoom} className="space-y-3">
              <Input 
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder="Access Code"
                className="font-mono text-sm rounded-sm bg-background border-primary/20 h-9 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 uppercase"
              />
              <Button type="submit" variant="secondary" className="w-full font-mono text-xs uppercase h-9 rounded-sm border border-secondary-border hover:border-primary/50" disabled={joinRoom.isPending || !inviteCode}>
                {joinRoom.isPending ? "Connecting..." : "Join"}
              </Button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
