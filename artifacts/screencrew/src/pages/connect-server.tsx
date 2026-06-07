import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Server, Zap } from "lucide-react";
import { useTheme } from "@/lib/theme";
import {
  getStoredServerUrl,
  setStoredServerUrl,
  clearStoredServerUrl,
} from "@/lib/server-connection";

export default function ConnectServer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const classic = theme === "classic";

  const [address, setAddress] = useState(getStoredServerUrl() ?? "");

  const connect = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const normalized = setStoredServerUrl(address);
      toast({ title: classic ? "LINK ESTABLISHED" : "Connected", description: normalized });
      setLocation("/");
    } catch {
      toast({
        title: classic ? "BAD ADDRESS" : "Invalid server address",
        description: classic ? "CHECK HOST/PORT" : "Enter a valid IP, domain, or URL.",
        variant: "destructive",
      });
    }
  };

  const useQuickSession = () => {
    clearStoredServerUrl();
    toast({ title: classic ? "QUICK SESSION" : "Quick Session" });
    setLocation("/");
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      {classic && (
        <div className="absolute top-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      )}

      <div className={`w-80 bg-card border border-border/50 shadow-2xl overflow-hidden ${classic ? "rounded-sm" : "rounded-2xl"}`}>
        {/* Header */}
        <div className={`flex items-center gap-3 px-6 pt-7 pb-6 ${classic ? "border-b border-primary/20" : ""}`}>
          <div className={`w-10 h-10 bg-primary/15 border border-primary/30 flex items-center justify-center ${classic ? "rounded-sm" : "rounded-xl"}`}>
            <Server className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className={`font-semibold text-base text-foreground ${classic ? "font-mono tracking-widest uppercase text-primary" : ""}`}>
              {classic ? "SELECT SERVER" : "Choose a server"}
            </h1>
            <p className={`text-xs text-muted-foreground ${classic ? "font-mono tracking-wider" : ""}`}>
              {classic ? "CONNECT TO A NODE" : "Connect to a community"}
            </p>
          </div>
        </div>

        {/* Self-hosted connect form */}
        <form onSubmit={connect} className="px-6 pb-4 space-y-3">
          <div className="space-y-1.5">
            <label className={`text-xs font-medium text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-primary/70" : ""}`}>
              {classic ? "Server address" : "Server address"}
            </label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={classic ? "host:port or https://…" : "192.168.1.10:8080 or my.server.com"}
              className={`h-10 text-sm ${classic
                ? "rounded-sm bg-background border-primary/20 font-mono focus-visible:ring-primary"
                : "rounded-xl bg-muted/30 border-transparent focus-visible:border-primary/40 focus-visible:ring-0"}`}
            />
          </div>
          <Button
            type="submit"
            disabled={!address.trim()}
            className={`w-full h-10 text-sm font-semibold ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-xl"}`}
          >
            {classic ? "ESTABLISH LINK" : "Connect"}
          </Button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-2 px-6">
          <div className="flex-1 h-px bg-border/50" />
          <span className={`text-[10px] text-muted-foreground/50 ${classic ? "font-mono uppercase tracking-wider" : ""}`}>
            {classic ? "OR" : "or"}
          </span>
          <div className="flex-1 h-px bg-border/50" />
        </div>

        {/* Quick Session */}
        <div className="px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={useQuickSession}
            className={`w-full h-10 text-sm font-medium gap-2 ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-xl"}`}
          >
            <Zap className="w-4 h-4" />
            {classic ? "QUICK SESSION" : "Use Quick Session"}
          </Button>
          <p className={`mt-2 text-[10px] text-center text-muted-foreground/60 ${classic ? "font-mono tracking-wider" : ""}`}>
            {classic ? "DEFAULT NODE · EPHEMERAL" : "The default shared server"}
          </p>
        </div>
      </div>
    </div>
  );
}
