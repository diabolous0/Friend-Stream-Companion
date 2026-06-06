import { useEffect, useState, useRef, useCallback } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { 
  useGetRoom, getGetRoomQueryKey,
  useGetRoomMembers, getGetRoomMembersQueryKey,
  useGetRoomPresence, getGetRoomPresenceQueryKey,
  useGetRoomMessages, getGetRoomMessagesQueryKey,
  useSendMessage,
  useGetMe
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonitorUp, StopCircle, Video, Volume2, VolumeX, ChevronLeft, Mic, MicOff } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function Room() {
  const [, params] = useRoute("/room/:roomId");
  const roomId = params?.roomId ? parseInt(params.roomId, 10) : 0;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: me } = useGetMe();
  const { data: room } = useGetRoom(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomQueryKey(roomId) } });
  const { data: members } = useGetRoomMembers(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMembersQueryKey(roomId) } });
  const { data: initialPresence } = useGetRoomPresence(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomPresenceQueryKey(roomId) } });
  const { data: initialMessages } = useGetRoomMessages(roomId, { query: { enabled: !!roomId, queryKey: getGetRoomMessagesQueryKey(roomId) } });

  const sendMessage = useSendMessage();

  const [messages, setMessages] = useState<any[]>([]);
  const [presence, setPresence] = useState<Record<number, any>>({});
  const [msgInput, setMsgInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [viewingStreamOf, setViewingStreamOf] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const sendRef = useRef<((msg: any) => void) | null>(null);
  const isSharingRef = useRef(false);

  useEffect(() => {
    if (initialMessages) {
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  useEffect(() => {
    if (initialPresence) {
      const pMap: Record<number, any> = {};
      initialPresence.forEach((p: any) => pMap[p.userId] = p);
      setPresence(pMap);
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

  const { isConnected, send } = useWebSocket({
    onPresenceUpdate: (rid, entries) => {
      if (rid === roomId) {
        setPresence(prev => {
          const next = { ...prev };
          entries.forEach(e => next[e.userId] = e);
          return next;
        });
      }
    },
    onNewMessage: (msg) => {
      if (msg.roomId === roomId) {
        setMessages(prev => [...prev, msg]);
      }
    },
    onStreamOffer: async (from, sdp) => {
      await handleOffer(from, sdp);
    },
    onStreamAnswer: async (from, sdp) => {
      await handleAnswer(from, sdp);
    },
    onIceCandidate: async (from, candidate) => {
      await handleIceCandidate(from, candidate);
    }
  });

  const {
    localStream,
    remoteStreams,
    isSharing,
    startSharing,
    stopSharing,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    sendOffer,
    cleanup
  } = useWebRTC(send, 
    () => { isSharingRef.current = true;  send({ type: "presence", speaking: false, streaming: true }); },
    () => { isSharingRef.current = false; send({ type: "presence", speaking: false, streaming: false }); }
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    isSharingRef.current = isSharing;
  }, [isSharing]);

  useEffect(() => {
    if (isConnected && roomId) {
      send({ type: "join_room", roomId });
    }
  }, [isConnected, roomId, send]);

  useEffect(() => {
    return () => {
      cleanup();
      stopDetection();
    };
  }, [cleanup, stopDetection]);

  const handleStartShare = async () => {
    await startSharing(roomId);
    if (members && me) {
      members.forEach(member => {
        if (member.id !== me.id) {
          sendOffer(member.id);
        }
      });
    }
  };

  const handleSendMsg = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgInput.trim()) return;
    sendMessage.mutate({ roomId, data: { content: msgInput } });
    setMsgInput("");
  };

  const activeStream = viewingStreamOf && remoteStreams[viewingStreamOf];
  const viewingUser = members?.find(m => m.id === viewingStreamOf);

  if (!me || !room) {
    return <div className="min-h-screen bg-background crt-scanline flex items-center justify-center font-mono text-primary">CONNECTING TO NODE...</div>;
  }

  return (
    <div className="h-[100dvh] bg-background crt-scanline font-sans flex flex-col relative overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-primary/20 flex items-center justify-between px-4 shrink-0 bg-background/50 backdrop-blur">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild className="h-7 w-7 p-0 rounded-sm hover:bg-primary/20 hover:text-primary text-muted-foreground">
            <Link href="/rooms"><ChevronLeft className="w-4 h-4" /></Link>
          </Button>
          <div className="flex items-baseline gap-2">
            <h1 className="font-mono text-lg font-bold text-primary tracking-widest uppercase">{room.name}</h1>
            <span className="font-mono text-xs text-muted-foreground hidden sm:inline-block">ROOM {room.id} // {room.inviteCode}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-primary shadow-[0_0_8px_rgba(0,229,255,0.8)]' : 'bg-destructive shadow-[0_0_8px_rgba(255,0,60,0.8)]'}`} />
            <span className="font-mono text-xs text-muted-foreground uppercase hidden sm:inline-block">{isConnected ? 'Uplink Active' : 'Disconnected'}</span>
          </div>
          <Button
            size="sm"
            variant={micActive ? (localSpeaking ? "default" : "secondary") : "outline"}
            className={`h-7 px-3 rounded-sm font-mono text-xs uppercase transition-all ${micActive && localSpeaking ? "shadow-[0_0_10px_rgba(0,229,255,0.6)]" : ""} ${micPermission === false ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={toggleMic}
            title={micPermission === false ? "Microphone permission denied" : micActive ? "Mute mic" : "Activate mic"}
          >
            {micActive ? (
              <><Mic className={`w-3.5 h-3.5 mr-1.5 ${localSpeaking ? "animate-pulse" : ""}`} /> {localSpeaking ? "Speaking" : "Mic On"}</>
            ) : (
              <><MicOff className="w-3.5 h-3.5 mr-1.5" /> Mic Off</>
            )}
          </Button>
          <Button 
            size="sm" 
            variant={isSharing ? "destructive" : "default"}
            className="h-7 px-3 rounded-sm font-mono text-xs uppercase"
            onClick={isSharing ? stopSharing : handleStartShare}
          >
            {isSharing ? (
              <><StopCircle className="w-3.5 h-3.5 mr-1.5" /> Stop TX</>
            ) : (
              <><MonitorUp className="w-3.5 h-3.5 mr-1.5" /> Start TX</>
            )}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar / Friends List */}
        <div className="w-64 border-r border-primary/20 bg-card/30 flex flex-col shrink-0">
          <div className="p-3 border-b border-primary/20">
            <h2 className="font-mono text-xs text-primary uppercase tracking-widest">Crew Status</h2>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {members?.map(member => {
                const isMe = member.id === me.id;
                const p = presence[member.id];
                const isOnline = isMe ? isConnected : p?.online;
                const isSpeaking = isMe ? localSpeaking : p?.speaking;
                const isStreaming = isMe ? isSharing : p?.streaming;
                
                return (
                  <div key={member.id} className="flex items-center gap-3 p-2 rounded-sm hover:bg-primary/5 transition-colors group">
                    <div className="relative">
                      <Avatar className="h-8 w-8 rounded-sm border border-primary/20">
                        <AvatarFallback className="bg-background font-mono text-xs text-primary rounded-sm">
                          {member.username.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`absolute -bottom-1 -right-1 w-3 h-3 border-2 border-background rounded-full transition-colors ${isOnline ? 'bg-primary' : 'bg-muted-foreground/50'}`} />
                      {isSpeaking && (
                        <div className="absolute -inset-1 border-2 border-primary rounded-sm animate-pulse opacity-50" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`font-mono text-sm truncate ${isOnline ? 'text-foreground' : 'text-muted-foreground'} ${isMe ? 'font-bold' : ''}`}>
                          {member.username} {isMe && '(You)'}
                        </span>
                        <div className="flex items-center gap-1">
                          {isStreaming && (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 rounded-sm text-primary hover:bg-primary/20 hover:text-primary animate-pulse"
                              onClick={() => setViewingStreamOf(member.id)}
                            >
                              <Video className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {isSpeaking && <Mic className="w-3 h-3 text-primary" />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col bg-background/50">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto w-full">
              {messages.map(msg => {
                const isMe = msg.userId === me.id;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{msg.username}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/50">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className={`px-3 py-2 rounded-sm max-w-[85%] break-words font-mono text-sm border ${isMe ? 'bg-primary/10 border-primary/30 text-primary-foreground dark:text-primary' : 'bg-card border-border text-foreground'}`}>
                      {msg.content}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
          
          <div className="p-4 border-t border-primary/20 bg-background/80 backdrop-blur">
            <form onSubmit={handleSendMsg} className="max-w-3xl mx-auto flex gap-2">
              <Input 
                value={msgInput}
                onChange={e => setMsgInput(e.target.value)}
                placeholder="[ TYPE MESSAGE... ]"
                className="font-mono bg-card/50 border-primary/30 focus-visible:ring-primary rounded-sm uppercase placeholder:text-muted-foreground/50"
              />
              <Button type="submit" disabled={!msgInput.trim() || !isConnected} className="font-mono uppercase rounded-sm px-6">
                TX
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Stream Viewer Overlay */}
      {viewingStreamOf && (
        <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-200">
          <div className="w-full max-w-6xl flex flex-col bg-black border border-primary/30 rounded-sm shadow-2xl overflow-hidden relative">
            
            <div className="h-10 bg-card border-b border-primary/30 flex items-center justify-between px-4 absolute top-0 left-0 right-0 z-10 opacity-0 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2">
                <Video className="w-4 h-4 text-primary" />
                <span className="font-mono text-xs uppercase text-primary">RX: {viewingUser?.username}'s Screen</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground" onClick={() => setMuted(!muted)}>
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-destructive hover:bg-destructive/20 hover:text-destructive" onClick={() => setViewingStreamOf(null)}>
                  <StopCircle className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 bg-black relative flex items-center justify-center aspect-video">
              {activeStream ? (
                <StreamVideo stream={activeStream} muted={muted} />
              ) : (
                <div className="flex flex-col items-center justify-center font-mono text-primary/50 animate-pulse">
                  <MonitorUp className="w-12 h-12 mb-4 opacity-50" />
                  <p>WAITING FOR SIGNAL...</p>
                </div>
              )}
            </div>

            {/* Close button that's always visible in top right if we don't hover the header */}
            <Button 
              variant="destructive" 
              size="icon" 
              className="absolute top-2 right-2 h-8 w-8 rounded-sm opacity-50 hover:opacity-100 z-0" 
              onClick={() => setViewingStreamOf(null)}
            >
              <StopCircle className="w-5 h-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StreamVideo({ stream, muted }: { stream: MediaStream; muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className="w-full h-full object-contain"
    />
  );
}
