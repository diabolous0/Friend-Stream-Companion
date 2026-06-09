import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock3,
  Headphones,
  Link2,
  Plus,
  Radio,
  Server,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle, useTheme } from "@/lib/theme";
import {
  clearStoredServerUrl,
  clearQuickCallToken,
  apiUrl,
  getActiveToken,
  getRecentServers,
  getServerLabel,
  setActiveServerId,
  setQuickCallToken,
  type SavedServer,
} from "@/lib/server-connection";

export default function Welcome() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const classic = theme === "classic";
  const [showJoin, setShowJoin] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [callCode, setCallCode] = useState("");
  const [quickName, setQuickName] = useState(() => localStorage.getItem("lynxdock_quick_name") ?? "");
  const [quickError, setQuickError] = useState("");
  const [quickPending, setQuickPending] = useState(false);
  const [serverAddress, setServerAddress] = useState("");
  const [serverError, setServerError] = useState("");
  const [recentServers, setRecentServers] = useState<SavedServer[]>(() => getRecentServers());
  const hasCurrentSession = Boolean(getActiveToken());

  useEffect(() => {
    clearQuickCallToken();
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      setLocation(`/login?invite=${encodeURIComponent(invite)}`);
      return;
    }
    const quick = params.get("quick");
    if (quick) {
      setCallCode(quick.toUpperCase());
      setShowJoin(true);
      return;
    }
    const join = params.get("join");
    if (join) setLocation(`/login?join=${encodeURIComponent(join)}`);
  }, [setLocation]);

  const enterQuickCall = async (inviteCode?: string) => {
    const displayName = quickName.trim();
    if (!displayName) {
      setQuickError("Choose a display name first.");
      return;
    }
    setQuickPending(true);
    setQuickError("");
    void import("@/pages/room");
    clearStoredServerUrl();
    queryClient.clear();
    try {
      const response = await fetch(apiUrl(inviteCode ? "/api/quick-calls/join" : "/api/quick-calls"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteCode ? { displayName, inviteCode } : { displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not enter Quick Call");
      localStorage.setItem("lynxdock_quick_name", displayName);
      setQuickCallToken(data.token);
      setLocation(`/room/${data.room.id}?voice=1&quick=1`);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : "Could not enter Quick Call");
    } finally {
      setQuickPending(false);
    }
  };

  const startQuickCall = () => enterQuickCall();

  const joinQuickCall = (event: React.FormEvent) => {
    event.preventDefault();
    const code = callCode.trim().toUpperCase();
    if (!code) return;
    enterQuickCall(code);
  };

  const addServer = (event: React.FormEvent) => {
    event.preventDefault();
    if (!serverAddress.trim()) return;
    try {
      new URL(/^https?:\/\//i.test(serverAddress.trim()) ? serverAddress.trim() : `http://${serverAddress.trim()}`);
      setServerError("");
      setLocation(`/connect?address=${encodeURIComponent(serverAddress.trim())}`);
    } catch {
      setServerError("Enter a valid server address.");
    }
  };

  const openRecent = (server: SavedServer) => {
    void import("@/pages/login");
    setActiveServerId(server.id);
    queryClient.clear();
    setRecentServers(getRecentServers());
    setLocation("/login");
  };

  const panelClass = classic
    ? "border-primary/20 bg-card rounded-sm"
    : "border-border/60 bg-card rounded-lg";
  const actionClass = classic ? "rounded-sm" : "rounded-lg";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}lynxdock-icon.png`}
              alt=""
              className={`h-9 w-9 object-cover ${classic ? "rounded-sm" : "rounded-lg"}`}
            />
            <div>
              <div className={`text-sm font-semibold ${classic ? "font-mono tracking-widest text-primary" : ""}`}>
                LYNXDOCK
              </div>
              <div className="text-[11px] text-muted-foreground">Calls and communities, without the weight</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasCurrentSession && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/login")}
                className={`hidden h-8 text-xs sm:flex ${actionClass}`}
              >
                Open {getServerLabel()}
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="mb-9 max-w-2xl">
          <p className={`mb-2 text-xs font-semibold uppercase text-primary ${classic ? "font-mono tracking-widest" : "tracking-wide"}`}>
            Choose how to connect
          </p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Talk now, or settle into a server.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Start a lightweight temporary call, join with a code, or connect to a persistent LynxDock community.
          </p>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <div className={`border ${panelClass}`}>
            <div className="border-b border-border/40 p-5">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center bg-primary/15 text-primary ${actionClass}`}>
                  <Radio className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold">Quick Call</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    A temporary P2P room for voice, chat, and screen sharing.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <Input
                value={quickName}
                onChange={(event) => setQuickName(event.target.value)}
                placeholder="Your display name"
                maxLength={32}
                className={`h-10 ${actionClass}`}
              />
              <Button
                onClick={startQuickCall}
                disabled={quickPending || !quickName.trim()}
                className={`h-11 w-full justify-between ${actionClass}`}
              >
                <span className="flex items-center gap-2"><Headphones className="h-4 w-4" /> Start Quick Call</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowJoin((value) => !value)}
                className={`h-11 w-full justify-between ${actionClass}`}
              >
                <span className="flex items-center gap-2"><Link2 className="h-4 w-4" /> Join Quick Call</span>
                <Plus className={`h-4 w-4 transition-transform ${showJoin ? "rotate-45" : ""}`} />
              </Button>
              {showJoin && (
                <form onSubmit={joinQuickCall} className="flex gap-2 pt-1">
                  <Input
                    value={callCode}
                    onChange={(event) => setCallCode(event.target.value.toUpperCase())}
                    placeholder="Invite code"
                    autoFocus
                    className={`h-10 min-w-0 flex-1 uppercase ${actionClass}`}
                  />
                  <Button type="submit" disabled={quickPending || !callCode.trim() || !quickName.trim()} className={`h-10 px-4 ${actionClass}`}>
                    Join
                  </Button>
                </form>
              )}
              {quickError && <p className="text-xs text-destructive">{quickError}</p>}
              <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                Temporary rooms disappear after inactivity.
              </div>
            </div>
          </div>

          <div className={`border ${panelClass}`}>
            <div className="border-b border-border/40 p-5">
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center bg-violet-500/15 text-violet-300 ${actionClass}`}>
                  <Server className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-semibold">Persistent Server</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    A self-hosted home with accounts, rooms, history, and admin controls.
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3 p-5">
              <Button
                variant="outline"
                onClick={() => setShowServer((value) => !value)}
                className={`h-11 w-full justify-between ${actionClass}`}
              >
                <span className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add Persistent Server</span>
                <ArrowRight className={`h-4 w-4 transition-transform ${showServer ? "rotate-90" : ""}`} />
              </Button>
              <Button
                variant="ghost"
                onClick={() => setLocation("/host")}
                className={`h-10 w-full justify-between ${actionClass}`}
              >
                <span className="flex items-center gap-2"><Server className="h-4 w-4" /> Host a New Server</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
              {showServer && (
                <form onSubmit={addServer} className="space-y-2 pt-1">
                  <div className="flex gap-2">
                    <Input
                      value={serverAddress}
                      onChange={(event) => setServerAddress(event.target.value)}
                      placeholder="server.example.com or 192.168.1.10:8080"
                      autoFocus
                      className={`h-10 min-w-0 flex-1 ${actionClass}`}
                    />
                    <Button type="submit" disabled={!serverAddress.trim()} className={`h-10 px-4 ${actionClass}`}>
                      Add
                    </Button>
                  </div>
                  {serverError && <p className="text-xs text-destructive">{serverError}</p>}
                </form>
              )}
              <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                Accounts and data stay with the server you choose.
              </div>
            </div>
          </div>
        </section>

        {recentServers.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className={`text-xs font-semibold uppercase text-muted-foreground ${classic ? "font-mono tracking-widest" : "tracking-wide"}`}>
                Recent servers
              </h2>
              <button onClick={() => setLocation("/connect")} className="text-xs text-primary hover:underline">
                Add another
              </button>
            </div>
            <div className={`divide-y divide-border/40 border ${panelClass}`}>
              {recentServers.map((server) => (
                <button
                  key={server.id}
                  onClick={() => openRecent(server)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <div className={`flex h-8 w-8 items-center justify-center bg-muted/60 text-muted-foreground ${actionClass}`}>
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{server.label}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{server.url}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
