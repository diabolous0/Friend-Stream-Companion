import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useRegister, useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme, ThemeToggle } from "@/lib/theme";
import { getServerLabel, getActiveToken, setActiveToken } from "@/lib/server-connection";

setAuthTokenGetter(() => getActiveToken());

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const classic = theme === "classic";

  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteKey, setInviteKey] = useState(
    () => new URLSearchParams(window.location.search).get("invite") ?? ""
  );

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  // Carry a shareable invite link's ?join=CODE through to the rooms page so it
  // can prefill the join form after authentication.
  const joinSuffix = (() => {
    const code = new URLSearchParams(window.location.search).get("join");
    return code ? `?join=${encodeURIComponent(code)}` : "";
  })();

  const handleSuccess = (token: string) => {
    setActiveToken(token);
    setLocation(`/rooms${joinSuffix}`);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "login") {
      loginMutation.mutate({ data: { username, password } }, {
        onSuccess: (data) => handleSuccess(data.token),
        onError: () => toast({ title: classic ? "AUTH FAILED" : "Wrong username or password", variant: "destructive" }),
      });
    } else {
      registerMutation.mutate({ data: { username, password, inviteKey: inviteKey || undefined } }, {
        onSuccess: (data) => handleSuccess(data.token),
        onError: (err) => toast({ title: classic ? "REG FAILED" : "Registration failed", description: err.message, variant: "destructive" }),
      });
    }
  };

  const { data: me, isLoading } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  if (me) { setLocation(`/rooms${joinSuffix}`); return null; }

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      {classic
        ? <div className="text-primary font-mono text-sm tracking-widest animate-pulse">INIT SYSTEM…</div>
        : <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
    </div>
  );

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      {classic && (
        <div className="absolute top-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      )}

      <div className={`w-80 bg-card border border-border/50 shadow-2xl overflow-hidden ${classic ? "rounded-sm" : "rounded-2xl"}`}>

        {/* App header */}
        <div className={`flex items-center gap-3 px-6 pt-7 pb-6 ${classic ? "border-b border-primary/20" : ""}`}>
          <img
            src={`${import.meta.env.BASE_URL}lynxdock-icon.png`}
            alt="LynxDock"
            className={`w-10 h-10 object-cover ${classic ? "rounded-sm" : "rounded-xl"}`}
          />
          <div>
            <h1 className={`font-semibold text-base text-foreground ${classic ? "font-mono tracking-widest uppercase text-primary" : ""}`}>
              {classic ? "LYNXDOCK" : "LynxDock"}
            </h1>
            <p className={`text-xs text-muted-foreground ${classic ? "font-mono tracking-wider" : ""}`}>
              {classic ? "LAN PARTY CLIENT" : "Watch together, anywhere"}
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className={`flex mx-6 mb-5 bg-muted/40 p-1 ${classic ? "rounded-sm mt-5" : "rounded-xl"}`}>
          {(["login", "register"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-sm font-medium transition-all ${
                tab === t
                  ? classic
                    ? "bg-primary/20 text-primary border border-primary/30 rounded-sm"
                    : "bg-card text-foreground shadow-sm rounded-lg"
                  : classic
                    ? "text-muted-foreground hover:text-primary font-mono text-xs uppercase"
                    : "text-muted-foreground hover:text-foreground"
              }`}>
              {t === "login"
                ? (classic ? "AUTH" : "Sign in")
                : (classic ? "REGISTER" : "Register")}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="px-6 pb-5 space-y-3">
          <div className="space-y-1.5">
            <label className={`text-xs font-medium text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-primary/70" : ""}`}>
              {classic ? "Username" : "Username"}
            </label>
            <Input value={username} onChange={e => setUsername(e.target.value)}
              placeholder={classic ? "handle_" : "your_handle"}
              required minLength={tab === "register" ? 2 : 1}
              className={`h-10 text-sm ${classic
                ? "rounded-sm bg-background border-primary/20 font-mono focus-visible:ring-primary"
                : "rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0"}`} />
          </div>
          <div className="space-y-1.5">
            <label className={`text-xs font-medium text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-primary/70" : ""}`}>
              Password
            </label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={classic ? "••••••••" : "••••••••"}
              required minLength={tab === "register" ? 4 : 1}
              className={`h-10 text-sm ${classic
                ? "rounded-sm bg-background border-primary/20 font-mono focus-visible:ring-primary"
                : "rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0"}`} />
          </div>
          {tab === "register" && (
            <div className="space-y-1.5">
              <label className={`text-xs font-medium text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-primary/70" : ""}`}>
                {classic ? "Invite key" : "Invite key"}
                <span className="text-muted-foreground/40 normal-case"> {classic ? "(IF REQUIRED)" : "(if required)"}</span>
              </label>
              <Input value={inviteKey} onChange={e => setInviteKey(e.target.value)}
                placeholder={classic ? "key_" : "paste invite key"}
                className={`h-10 text-sm ${classic
                  ? "rounded-sm bg-background border-primary/20 font-mono focus-visible:ring-primary"
                  : "rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0"}`} />
            </div>
          )}
          <Button type="submit" disabled={isPending || !username || !password}
            className={`w-full h-10 text-sm font-semibold mt-1 ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-xl"}`}>
            {isPending ? (
              classic ? (tab === "login" ? "CONNECTING…" : "CREATING…") : (tab === "login" ? "Signing in…" : "Creating…")
            ) : (
              tab === "login" ? (classic ? "INITIALIZE" : "Sign in") : (classic ? "CREATE NODE" : "Create account")
            )}
          </Button>
        </form>

        {/* Server + theme toggle */}
        <div className="flex items-center justify-center gap-3 px-6 pb-5">
          <button
            type="button"
            onClick={() => setLocation("/connect")}
            className={`text-[10px] text-muted-foreground/50 hover:text-primary transition-colors ${classic ? "font-mono uppercase tracking-wider" : ""}`}
          >
            {classic ? `NODE: ${getServerLabel()}` : `Server: ${getServerLabel()}`}
          </button>
          <span className="text-muted-foreground/20">·</span>
          <span className="text-[10px] text-muted-foreground/40">UI:</span>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
