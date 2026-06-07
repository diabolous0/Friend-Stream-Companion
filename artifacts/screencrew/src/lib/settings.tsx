import { createContext, useContext, useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type UITheme = "lynx" | "classic" | "custom";
export type ColorMode = "dark" | "light";
export type WindowControls = "windows" | "mac";
export type AccentPreset = "cyan" | "blue" | "purple" | "green" | "orange" | "pink" | "red";
export type FontSize = "sm" | "md" | "lg";
export type VideoQuality = "auto" | "1080p60" | "1080p30" | "720p30" | "480p30";
export type VideoCodec = "auto" | "VP9" | "VP8" | "H264" | "AV1";

// Custom UI builder
export type WindowStyle = "smooth" | "squared";
export type UserStatus = "online" | "away" | "dnd";

export const FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: "space-mono", label: "Space Mono",  stack: "'Space Mono', monospace" },
  { id: "inter",      label: "Inter",       stack: "'Inter', sans-serif" },
  { id: "system",     label: "System UI",   stack: "system-ui, -apple-system, sans-serif" },
  { id: "courier",    label: "Courier",     stack: "'Courier New', Courier, monospace" },
  { id: "verdana",    label: "Verdana",     stack: "Verdana, Geneva, sans-serif" },
  { id: "georgia",    label: "Georgia",     stack: "Georgia, 'Times New Roman', serif" },
];

export interface CustomColors {
  background: string;
  card: string;
  foreground: string;
  primary: string;
  border: string;
  muted: string;
}

export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  background: "#11131a",
  card: "#171a22",
  foreground: "#e9ecf3",
  primary: "#00e5ff",
  border: "#2a2f3a",
  muted: "#8a93a6",
};

export const CUSTOM_COLOR_FIELDS: { key: keyof CustomColors; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "card",       label: "Panels" },
  { key: "foreground", label: "Text" },
  { key: "primary",    label: "Accent" },
  { key: "border",     label: "Borders" },
  { key: "muted",      label: "Muted text" },
];

// Notification sounds
export type SoundEvent = "message" | "mention" | "reaction" | "join" | "leave" | "knock";

export const BUILTIN_SOUNDS: { id: string; label: string }[] = [
  { id: "beep",  label: "Beep" },
  { id: "chime", label: "Chime" },
  { id: "pop",   label: "Pop" },
  { id: "join",  label: "Join blip" },
  { id: "leave", label: "Leave blip" },
  { id: "knock", label: "Knock" },
  { id: "none",  label: "Silent" },
];

export const SOUND_EVENTS: { key: SoundEvent; label: string }[] = [
  { key: "message",  label: "New message" },
  { key: "mention",  label: "Mention" },
  { key: "reaction", label: "Reaction" },
  { key: "join",     label: "Crew joins" },
  { key: "leave",    label: "Crew leaves" },
  { key: "knock",    label: "Knock to join" },
];

export interface CustomSound { id: string; name: string; objectPath: string; }
export interface EventSounds { message: string; mention: string; reaction: string; join: string; leave: string; knock: string; }

// Sound theme presets — bundle all event sounds at once
export const SOUND_THEMES: { id: string; label: string; sounds: EventSounds }[] = [
  { id: "retro",   label: "Retro",   sounds: { message: "beep",  mention: "chime", reaction: "pop",  join: "join",  leave: "leave", knock: "knock" } },
  { id: "minimal", label: "Minimal", sounds: { message: "pop",   mention: "pop",   reaction: "none", join: "none",  leave: "none",  knock: "beep"  } },
  { id: "arcade",  label: "Arcade",  sounds: { message: "chime", mention: "beep",  reaction: "pop",  join: "join",  leave: "leave", knock: "chime" } },
  { id: "silent",  label: "Silent",  sounds: { message: "none",  mention: "chime", reaction: "none", join: "none",  leave: "none",  knock: "knock" } },
];

// Winamp-style skin presets — bundle a full custom palette + font + window style
export interface SkinPreset {
  id: string;
  label: string;
  colors: CustomColors;
  font: string;
  windowStyle: WindowStyle;
}

export const SKIN_PRESETS: SkinPreset[] = [
  { id: "cyber",    label: "Cyber Cyan", font: "space-mono", windowStyle: "smooth",
    colors: { background: "#0a0e14", card: "#121823", foreground: "#dbe7f0", primary: "#00e5ff", border: "#1f2b3a", muted: "#6b8299" } },
  { id: "amber",    label: "Classic Amber", font: "courier", windowStyle: "squared",
    colors: { background: "#0b0700", card: "#160f02", foreground: "#ffcf6b", primary: "#ffab00", border: "#3a2a08", muted: "#9c7b32" } },
  { id: "matrix",   label: "Matrix Green", font: "courier", windowStyle: "squared",
    colors: { background: "#000700", card: "#021202", foreground: "#9dffb0", primary: "#00ff66", border: "#0c3315", muted: "#3f8a52" } },
  { id: "vaporwave", label: "Vaporwave", font: "space-mono", windowStyle: "smooth",
    colors: { background: "#1a0b2e", card: "#2a1245", foreground: "#ffe3fb", primary: "#ff5cd6", border: "#46276b", muted: "#9d7bc4" } },
  { id: "plasma",   label: "Plasma", font: "inter", windowStyle: "smooth",
    colors: { background: "#0c0f1f", card: "#161a30", foreground: "#dfe4ff", primary: "#7c5cff", border: "#28305a", muted: "#7681b8" } },
  { id: "hotline",  label: "Hotline", font: "space-mono", windowStyle: "smooth",
    colors: { background: "#100208", card: "#1d0610", foreground: "#ffd9e6", primary: "#ff3b6b", border: "#451222", muted: "#a85772" } },
  { id: "midnight", label: "Midnight Blue", font: "inter", windowStyle: "smooth",
    colors: { background: "#070b16", card: "#101626", foreground: "#d6e2f5", primary: "#3d7eff", border: "#1d2942", muted: "#6b7ea3" } },
  { id: "terminal", label: "Terminal", font: "courier", windowStyle: "squared",
    colors: { background: "#000000", card: "#0b0b0b", foreground: "#e8e8e8", primary: "#cfcfcf", border: "#222222", muted: "#777777" } },
  { id: "sunset",   label: "Sunset", font: "space-mono", windowStyle: "smooth",
    colors: { background: "#1a0a08", card: "#2a110c", foreground: "#ffe6d2", primary: "#ff7a18", border: "#4a2114", muted: "#bb7a5c" } },
  { id: "bubblegum", label: "Bubblegum", font: "inter", windowStyle: "smooth",
    colors: { background: "#1c0f1a", card: "#2c1729", foreground: "#ffe1f2", primary: "#ff79c6", border: "#492a44", muted: "#bd86ab" } },
  { id: "ice",      label: "Ice", font: "space-mono", windowStyle: "smooth",
    colors: { background: "#06121a", card: "#0e2230", foreground: "#dff4ff", primary: "#36d6ff", border: "#1a3a4c", muted: "#6fa3bb" } },
  { id: "forest",   label: "Forest", font: "courier", windowStyle: "squared",
    colors: { background: "#06120c", card: "#0d2016", foreground: "#d6f0df", primary: "#3fd07a", border: "#1a3a28", muted: "#6ba383" } },
  { id: "gold",     label: "Royal Gold", font: "georgia", windowStyle: "smooth",
    colors: { background: "#120e04", card: "#1f1808", foreground: "#fdeecb", primary: "#e8b84b", border: "#3d3014", muted: "#a8915a" } },
  { id: "crimson",  label: "Crimson", font: "courier", windowStyle: "squared",
    colors: { background: "#140405", card: "#22080a", foreground: "#ffd9dc", primary: "#e8344a", border: "#451418", muted: "#a8636a" } },
];

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
  colorMode: ColorMode;
  windowControls: WindowControls;
  accentPreset: AccentPreset;
  panelOpacity: number;      // 20–100
  blurBackground: boolean;

  // Custom UI builder (active when uiTheme === "custom")
  fontFamily: string;        // FONT_OPTIONS id
  fontScale: number;         // 80–130 (%)
  windowStyle: WindowStyle;
  customColors: CustomColors;

  // Notification sounds
  customSounds: CustomSound[];
  eventSounds: EventSounds;
  userSounds: Record<string, string>;  // userId -> soundId

  // Status
  myStatus: UserStatus;
  myStatusMessage: string;

  // Chat
  fontSize: FontSize;
  showTimestamps: boolean;
  compactMessages: boolean;
  chatFont: string;          // FONT_OPTIONS id for chat messages
  chatPopout: boolean;
  chatPopoutPos: { x: number; y: number };
  chatPopoutSize: { w: number; h: number }; // resizable chat popout (w = window, h = messages area)

  // Voice visualizer
  spectrumViz: boolean;      // bouncing-bar equalizer on speaking avatars/streams

  // Layout
  panelOrder: "friends" | "chat";   // which section sits on top
  friendsCollapsed: boolean;
  chatCollapsed: boolean;
  windowSize: { w: number; h: number };
  streamWindowW: number;             // resizable floating stream-window width (px)

  // Audio
  soundEnabled: boolean;
  micDeviceId: string;          // "" = system default
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micGain: number;              // 0–200 (%)

  // Video (screen share)
  videoQuality: VideoQuality;
  videoCodec: VideoCodec;
  videoBitrate: number;         // kbps, 0 = auto
  shareSystemAudio: boolean;
  askToWatch: boolean;          // require my approval before a crew member can watch my stream

  // Overlay
  overlayHotkey: string;  // KeyboardEvent.code or "Mod+Code", e.g. "Insert", "Shift+F2"
  overlayPillPos: { x: number; y: number };
  overlayShowStream: boolean; // show a mini live stream in overlay mode while gaming

  // Voice & presence
  voiceMode: "open" | "ptt";          // open mic vs push-to-talk
  pttKey: string;                     // KeyboardEvent.code for push-to-talk, e.g. "Backquote"
  micSensitivity: number;             // 0–100 voice-activation sensitivity (higher = picks up quieter audio)
  muteHotkey: string;                 // toggle self-mute, e.g. "Shift+KeyM"
  deafenHotkey: string;               // toggle deafen, e.g. "Shift+KeyD"
  userVolumes: Record<string, number>; // userId -> 0–200 (%)
  userMuted: Record<string, boolean>;  // userId -> locally muted
  autoAfk: boolean;                   // auto-set away after inactivity
  afkMinutes: number;                 // minutes of inactivity before AFK
  watchedUsers: number[];             // userIds to notify when they come online

  // Keyboard shortcuts
  settingsHotkey: string;             // open settings, e.g. "Comma" (with Mod)

  // Soundboard
  soundboardHotkeys: Record<string, string>; // clipId -> single-key binding (KeyboardEvent.key, lowercased)
}

const DEFAULT: AppSettings = {
  uiTheme: "lynx",
  colorMode: "dark",
  windowControls: "windows",
  accentPreset: "cyan",
  panelOpacity: 100,
  blurBackground: false,
  fontFamily: "space-mono",
  fontScale: 100,
  windowStyle: "smooth",
  customColors: { ...DEFAULT_CUSTOM_COLORS },
  customSounds: [],
  eventSounds: { message: "beep", mention: "chime", reaction: "pop", join: "join", leave: "leave", knock: "knock" },
  userSounds: {},
  myStatus: "online",
  myStatusMessage: "",
  fontSize: "md",
  showTimestamps: true,
  compactMessages: false,
  chatFont: "space-mono",
  spectrumViz: true,
  panelOrder: "friends",
  friendsCollapsed: false,
  chatCollapsed: false,
  windowSize: { w: 320, h: 580 },
  streamWindowW: 440,
  soundEnabled: true,
  micDeviceId: "",
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micGain: 100,
  videoQuality: "auto",
  videoCodec: "auto",
  videoBitrate: 0,
  shareSystemAudio: true,
  askToWatch: false,
  chatPopout: false,
  chatPopoutPos: { x: 360, y: 80 },
  chatPopoutSize: { w: 300, h: 240 },
  overlayHotkey: "Insert",
  overlayPillPos: { x: 16, y: 16 },
  overlayShowStream: true,
  voiceMode: "open",
  pttKey: "Backquote",
  micSensitivity: 75,
  muteHotkey: "Shift+KeyM",
  deafenHotkey: "Shift+KeyD",
  userVolumes: {},
  userMuted: {},
  autoAfk: true,
  afkMinutes: 10,
  watchedUsers: [],
  settingsHotkey: "Comma",
  soundboardHotkeys: {},
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

function hexToHslParts(hex: string): { h: number; s: number; l: number } | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const lum = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      default: hue = (r - g) / d + 4; break;
    }
    hue /= 6;
  }
  return { h: Math.round(hue * 360), s: Math.round(sat * 100), l: Math.round(lum * 100) };
}

function hexToHsl(hex: string): string | null {
  const p = hexToHslParts(hex);
  return p ? `${p.h} ${p.s}% ${p.l}%` : null;
}

const CUSTOM_VARS = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--popover", "--popover-foreground", "--secondary", "--secondary-foreground",
  "--muted", "--muted-foreground", "--accent", "--accent-foreground",
  "--border", "--input", "--primary", "--primary-foreground", "--ring",
];

// Apply a full color palette to an element's CSS vars. Used both for the
// global custom theme and for room-level skins scoped to a container element.
export function applySkinVars(el: HTMLElement, c: CustomColors) {
  const setVar = (name: string, hex: string) => {
    const v = hexToHsl(hex);
    if (v) el.style.setProperty(name, v);
  };
  setVar("--background", c.background);
  setVar("--card", c.card);
  setVar("--popover", c.card);
  setVar("--secondary", c.card);
  setVar("--muted", c.card);
  setVar("--accent", c.card);
  setVar("--foreground", c.foreground);
  setVar("--card-foreground", c.foreground);
  setVar("--popover-foreground", c.foreground);
  setVar("--secondary-foreground", c.foreground);
  setVar("--accent-foreground", c.foreground);
  setVar("--muted-foreground", c.muted);
  setVar("--border", c.border);
  setVar("--input", c.border);
  setVar("--primary", c.primary);
  setVar("--ring", c.primary);
  const pl = hexToHslParts(c.primary);
  el.style.setProperty("--primary-foreground", pl && pl.l > 60 ? "0 0% 0%" : "0 0% 100%");
}

export function clearSkinVars(el: HTMLElement) {
  for (const v of CUSTOM_VARS) el.style.removeProperty(v);
}

function applyCustomTheme(el: HTMLElement, s: AppSettings) {
  applySkinVars(el, s.customColors);
}

function apply(s: AppSettings) {
  const el = document.documentElement;
  el.classList.toggle("dark", s.colorMode === "dark");
  el.dataset.ui = s.uiTheme;
  el.dataset.windowControls = s.windowControls;

  const chatFont = FONT_OPTIONS.find((f) => f.id === s.chatFont)?.stack ?? FONT_OPTIONS[0].stack;
  el.style.setProperty("--chat-font", chatFont);

  if (s.uiTheme === "custom") {
    const font = FONT_OPTIONS.find((f) => f.id === s.fontFamily)?.stack ?? FONT_OPTIONS[0].stack;
    el.style.setProperty("--app-font-sans", font);
    el.style.setProperty("--app-font-mono", font);
    el.style.fontSize = `${s.fontScale}%`;
    el.style.setProperty("--radius", s.windowStyle === "squared" ? "0px" : "0.5rem");
    applyCustomTheme(el, s);
  } else {
    el.style.removeProperty("--app-font-sans");
    el.style.removeProperty("--app-font-mono");
    el.style.fontSize = "";
    el.style.removeProperty("--radius");
    for (const v of CUSTOM_VARS) el.style.removeProperty(v);
    const { hsl } = ACCENT_COLORS[s.accentPreset];
    el.style.setProperty("--primary", hsl);
    el.style.setProperty("--ring", hsl);
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface Ctx {
  settings: AppSettings;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  applyMany: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  exportCode: () => string;
  importCode: (code: string) => boolean;
}

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULT,
  set: () => {},
  applyMany: () => {},
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

  const applyMany = useCallback((patch: Partial<AppSettings>) => {
    setState(prev => ({ ...prev, ...patch }));
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
    <SettingsCtx.Provider value={{ settings, set, applyMany, reset, exportCode, importCode }}>
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
