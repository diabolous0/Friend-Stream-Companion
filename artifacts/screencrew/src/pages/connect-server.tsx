import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/lib/theme";
import { getStoredServerUrl, normalizeServerUrl, setStoredServerUrl } from "@/lib/server-connection";

type ServerPreview = {
  serverName: string;
  description?: string | null;
  registration: "open" | "invite" | "closed";
  userCount: number;
};

export default function ConnectServer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const classic = theme === "classic";
  const [address, setAddress] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("address");
    return requested ?? getStoredServerUrl() ?? "";
  });
  const [checking, setChecking] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [preview, setPreview] = useState<ServerPreview | null>(null);
  const [previewAddress, setPreviewAddress] = useState("");
  const normalizedAddress = (() => {
    try {
      return address.trim() ? normalizeServerUrl(address) : "";
    } catch {
      return "";
    }
  })();
  const previewMatchesAddress = Boolean(preview && previewAddress && previewAddress === normalizedAddress);

  const describeRegistration = (mode: ServerPreview["registration"]) => {
    if (classic) return mode.toUpperCase();
    if (mode === "open") return "Open registration";
    if (mode === "invite") return "Invite-only";
    return "Closed registration";
  };

  const loadPreview = async (normalized: string, signal: AbortSignal): Promise<ServerPreview> => {
    const response = await fetch(`${normalized}/api/server-info`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error("Server identity check failed");
    const info = await response.json();
    if (
      !info ||
      typeof info.serverName !== "string" ||
      !["open", "invite", "closed"].includes(info.registration) ||
      typeof info.userCount !== "number"
    ) {
      throw new Error("Unexpected server identity response");
    }
    return info;
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setConnectError("");
    try {
      const normalized = normalizeServerUrl(address);
      if (preview && previewAddress === normalized) {
        setStoredServerUrl(normalized, preview.serverName);
        queryClient.clear();
        setLocation(preview.userCount === 0 ? "/login?first=1" : "/login");
        return;
      }
      const timeout = AbortSignal.timeout(7_000);
      const response = await fetch(`${normalized}/api/healthz`, {
        headers: { Accept: "application/json" },
        signal: timeout,
      });
      if (!response.ok) throw new Error("Server health check failed");
      const health = await response.json();
      if (health.status !== "ok") throw new Error("Unexpected health response");
      const info = await loadPreview(normalized, timeout);
      setPreview(info);
      setPreviewAddress(normalized);
      toast({ title: classic ? "NODE VERIFIED" : "Server verified", description: info.serverName });
    } catch {
      setConnectError(classic ? "CHECK HOST/PORT" : "LynxDock could not reach a healthy server at that address.");
      toast({
        title: classic ? "BAD ADDRESS" : "Invalid server address",
        description: classic ? "CHECK HOST/PORT" : "LynxDock could not reach a healthy server at that address.",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
      {classic && (
        <div className="absolute top-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      )}

      <div className={`w-full max-w-sm bg-card border border-border/50 shadow-2xl overflow-hidden ${classic ? "rounded-sm" : "rounded-lg"}`}>
        <div className={`flex items-center gap-3 px-6 pt-7 pb-6 ${classic ? "border-b border-primary/20" : ""}`}>
          <div className={`w-10 h-10 bg-primary/15 border border-primary/30 flex items-center justify-center ${classic ? "rounded-sm" : "rounded-lg"}`}>
            <Server className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className={`font-semibold text-base text-foreground ${classic ? "font-mono tracking-widest uppercase text-primary" : ""}`}>
              {classic ? "ADD SERVER" : "Add persistent server"}
            </h1>
            <p className={`text-xs text-muted-foreground ${classic ? "font-mono tracking-wider" : ""}`}>
              {classic ? "CONNECT TO A NODE" : "Connect to a self-hosted community"}
            </p>
          </div>
        </div>

        <form onSubmit={connect} className="px-6 pb-4 space-y-3">
          <div className="space-y-1.5">
            <label className={`text-xs font-medium text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-primary/70" : ""}`}>
              Server address
            </label>
            <Input
              value={address}
              onChange={(event) => { setAddress(event.target.value); setPreview(null); setPreviewAddress(""); setConnectError(""); }}
              placeholder={classic ? "host:port or https://..." : "192.168.1.10:8080 or my.server.com"}
              autoFocus
              className={`h-10 text-sm ${classic
                ? "rounded-sm bg-background border-primary/20 font-mono focus-visible:ring-primary"
                : "rounded-lg bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0"}`}
            />
          </div>
          {previewMatchesAddress && preview && (
            <div className={`border border-primary/30 bg-primary/10 px-3 py-2 text-xs ${classic ? "rounded-sm font-mono" : "rounded-lg"}`}>
              <div className="font-semibold text-primary">{preview.serverName}</div>
              <div className="mt-1 text-muted-foreground">
                {describeRegistration(preview.registration)} - {preview.userCount} {preview.userCount === 1 ? "member" : "members"}
              </div>
              {preview.description && <div className="mt-1 text-muted-foreground/80">{preview.description}</div>}
            </div>
          )}
          {connectError && (
            <div className={`border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive ${classic ? "rounded-sm font-mono" : "rounded-lg"}`}>
              {connectError}
            </div>
          )}
          <Button
            type="submit"
            disabled={!address.trim() || checking}
            className={`w-full h-10 text-sm font-semibold ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-lg"}`}
          >
            {checking && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {checking
              ? "Checking server"
              : previewMatchesAddress
                ? (classic ? "CONTINUE" : "Continue to login")
                : (classic ? "CHECK NODE" : "Check server")}
          </Button>
        </form>

        <div className="px-6 pb-5">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLocation("/host")}
            className={`mb-2 w-full h-9 text-xs gap-2 ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-lg"}`}
          >
            <Server className="w-3.5 h-3.5" />
            {classic ? "HOST A NODE" : "Host a new server"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLocation("/")}
            className={`w-full h-9 text-xs gap-2 ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-lg"}`}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {classic ? "BACK" : "Back to connection choices"}
          </Button>
        </div>
      </div>
    </main>
  );
}
