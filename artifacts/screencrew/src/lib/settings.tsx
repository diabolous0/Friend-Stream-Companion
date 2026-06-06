import { createContext, useContext, useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UITheme = "lynx" | "classic";
export type AccentPreset = "cyan" | "blue" | "purple" | "green" | "orange" | "pink" | "red";
export type FontSize = "sm" | "md" | "lg";

export const ACCENT_COLORS: Record<AccentPreset, { hsl: string; hex: string; label: string }> = {
  cyan:   { hsl: "189 100% 50%", hex: "#00e5ff", label: "Cyan"   },
  blue:   { hsl: "210 100% 56%", hex: "#1e90ff", label: "Blue"   },
  purple: { hsl: "270 70% 60%",  hex: "#9b59b6", label: "Purple" },
  green:  { hsl: "140 70% 45%",  hex: "#27ae60", label: "Green"  },
  orange: { hsl: "30 100% 55%",  hex: "#ff8c00", label: "Orange" },
  pink:   { hsl: "330 80% 60%",  hex: "#e91e8c", label: "Pink"   },
  red:    { hsl: "0 80% 58%",    hex: "#e74c3c", label: "Red"    },
};

export interface AppSettings {
  // Appearance
  uiTheme: UITheme;
  accentPreset: AccentPreset;
  panelOpacity: number;      // 20–100
  blurBackground: boolean;

  // Chat
  fontSize: FontSize;
  showTimestamps: boolean;
  compactMessages: boolean;
  chatPopout: boolean;
  chatPopoutPos: { x: number; y: number };

  // Audio
  soundEnabled: boolean;
}

const DEFAULT: AppSettings = {
  uiTheme: "lynx",
  accentPreset: "cyan",
  panelOpacity: 100,
  blurBackground: false,
  fontSize: "md",
  showTimestamps: true,
  compactMessages: false,
  soundEnabled: true,
  chatPopout: false,
  chatPopoutPos: { x: 360, y: 80 },
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const KEY = "screencrew_settings";

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT };
}

function save(s: AppSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

function apply(s: AppSettings) {
  const el = document.documentElement;
  el.classList.add("dark");
  el.dataset.ui = s.uiTheme;
  const { hsl } = ACCENT_COLORS[s.accentPreset];
  el.style.setProperty("--primary", hsl);
  el.style.setProperty("--ring", hsl);
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface Ctx {
  settings: AppSettings;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
  exportCode: () => string;
  importCode: (code: string) => boolean;
}

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULT,
  set: () => {},
  reset: () => {},
  exportCode: () => "",
  importCode: () => false,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setState] = useState<AppSettings>(load);

  useEffect(() => {
    apply(settings);
    save(settings);
  }, [settings]);

  const set = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setState({ ...DEFAULT }), []);

  const exportCode = useCallback(() => {
    try { return btoa(JSON.stringify(settings)); } catch { return ""; }
  }, [settings]);

  const importCode = useCallback((code: string): boolean => {
    try {
      const parsed = JSON.parse(atob(code));
      if (typeof parsed !== "object" || parsed === null) return false;
      setState({ ...DEFAULT, ...parsed });
      return true;
    } catch { return false; }
  }, []);

  return (
    <SettingsCtx.Provider value={{ settings, set, reset, exportCode, importCode }}>
      {children}
    </SettingsCtx.Provider>
  );
}

export function useSettings() { return useContext(SettingsCtx); }

// Backwards-compat alias used by login/rooms
export function useTheme() {
  const { settings, set } = useSettings();
  return {
    theme: settings.uiTheme,
    setTheme: (t: UITheme) => set("uiTheme", t),
  };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {(["lynx", "classic"] as const).map(t => (
        <button key={t} onClick={() => setTheme(t)}
          className={`text-[11px] px-2.5 py-1 rounded-lg font-medium transition-all ${
            theme === t
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted-foreground/40 hover:text-muted-foreground/70 border border-transparent"
          }`}>
          {t === "lynx" ? "Lynx" : "Classic"}
        </button>
      ))}
    </div>
  );
}
