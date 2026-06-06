import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin, useRegister, useGetMe, getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MonitorUp } from "lucide-react";

setAuthTokenGetter(() => localStorage.getItem("screencrew_token"));

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const handleSuccess = (token: string) => {
    localStorage.setItem("screencrew_token", token);
    setLocation("/rooms");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "login") {
      loginMutation.mutate({ data: { username, password } }, {
        onSuccess: (data) => handleSuccess(data.token),
        onError: () => toast({ title: "Wrong username or password", variant: "destructive" }),
      });
    } else {
      registerMutation.mutate({ data: { username, password } }, {
        onSuccess: (data) => handleSuccess(data.token),
        onError: (err) => toast({ title: "Registration failed", description: err.message, variant: "destructive" }),
      });
    }
  };

  const { data: me, isLoading } = useGetMe({ query: { retry: false, queryKey: getGetMeQueryKey() } });
  if (me) { setLocation("/rooms"); return null; }
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );

  const isPending = loginMutation.isPending || registerMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-80 bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden">
        {/* App header */}
        <div className="flex items-center gap-3 px-6 pt-7 pb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <MonitorUp className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-base text-foreground">ScreenCrew</h1>
            <p className="text-xs text-muted-foreground">Watch together, anywhere</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex mx-6 mb-5 bg-muted/40 rounded-xl p-1">
          {(["login", "register"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {t === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="px-6 pb-7 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Username</label>
            <Input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="your_handle" required minLength={tab === "register" ? 2 : 1}
              className="h-10 rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required minLength={tab === "register" ? 4 : 1}
              className="h-10 rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0 text-sm" />
          </div>
          <Button type="submit" disabled={isPending || !username || !password}
            className="w-full h-10 rounded-xl text-sm font-semibold mt-1">
            {isPending ? (
              <><div className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin mr-2" /> {tab === "login" ? "Signing in…" : "Creating…"}</>
            ) : (
              tab === "login" ? "Sign in" : "Create account"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
