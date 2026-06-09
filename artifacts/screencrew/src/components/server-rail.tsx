import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Zap, Plus, X } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useSettings } from "@/lib/settings";
import {
  getSavedServers,
  getActiveServerId,
  setActiveServerId,
  removeSavedServer,
  getActiveToken,
  QUICK_SESSION_ID,
  type SavedServer,
} from "@/lib/server-connection";

function railInitials(label: string): string {
  const cleaned = label.replace(/^https?:\/\//, "");
  const parts = cleaned.split(/[.\s-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

export function ServerRail() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const { settings } = useSettings();
  const classic = theme === "classic";

  const [servers, setServers] = useState<SavedServer[]>(() => getSavedServers());
  const [activeId, setActiveId] = useState<string>(() => getActiveServerId());

  const round = classic ? "rounded-sm" : "rounded-2xl";
  const roundIdle = classic ? "rounded-sm" : "rounded-3xl";
  const size = {
    compact: { rail: "w-14", button: "w-9 h-9", icon: "w-4 h-4", text: "text-xs", gap: "gap-1.5", pad: "py-2" },
    default: { rail: "w-16", button: "w-11 h-11", icon: "w-5 h-5", text: "text-sm", gap: "gap-2", pad: "py-3" },
    large: { rail: "w-20", button: "w-12 h-12", icon: "w-6 h-6", text: "text-base", gap: "gap-2.5", pad: "py-3" },
  }[settings.serverRailSize];

  const switchTo = (id: string) => {
    if (id === activeId) {
      setLocation(getActiveToken() ? "/rooms" : "/login");
      return;
    }
    setActiveServerId(id);
    setActiveId(id);
    queryClient.clear();
    setLocation(getActiveToken() ? "/rooms" : "/login");
  };

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeSavedServer(id);
    const next = getSavedServers();
    setServers(next);
    setActiveId(getActiveServerId());
    if (id === activeId) {
      queryClient.clear();
      setLocation(getActiveToken() ? "/rooms" : "/login");
    }
  };

  return (
    <nav
      className={`flex flex-col items-center ${size.gap} ${size.rail} shrink-0 h-full bg-card/60 border-r border-border/50 ${size.pad} overflow-y-auto ${
        classic ? "" : ""
      }`}
    >
      {servers.map((s) => {
        const active = s.id === activeId;
        const isQuick = s.id === QUICK_SESSION_ID;
        return (
          <div key={s.id} className="relative group">
            <button
              onClick={() => switchTo(s.id)}
              title={s.label}
              className={`relative flex items-center justify-center ${size.button} ${size.text} font-bold transition-all ${
                active ? round : roundIdle
              } ${
                active
                  ? "bg-primary/20 text-primary ring-2 ring-primary/60"
                  : "bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary"
              } ${classic ? "font-mono" : ""}`}
            >
              {active && (
                <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary" />
              )}
              {isQuick ? <Zap className={size.icon} /> : railInitials(s.label)}
            </button>
            {!isQuick && (
              <button
                onClick={(e) => remove(e, s.id)}
                title="Remove server"
                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-destructive text-destructive-foreground"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={() => setLocation("/connect")}
        title="Add server"
        className={`flex items-center justify-center ${size.button} ${roundIdle} bg-muted/30 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors mt-1`}
      >
        <Plus className={size.icon} />
      </button>
    </nav>
  );
}
