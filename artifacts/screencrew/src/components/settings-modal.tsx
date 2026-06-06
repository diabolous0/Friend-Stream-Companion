import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Copy, Check, Upload, RotateCcw, ExternalLink, Gamepad2, LogOut, Mic } from "lucide-react";
import { useSettings, ACCENT_COLORS, type AccentPreset, type FontSize, type VideoQuality, type VideoCodec } from "@/lib/settings";
import { VIDEO_QUALITY_LABELS, VIDEO_BITRATE_OPTIONS } from "@/lib/media";
import { useToast } from "@/hooks/use-toast";

// ─── Hotkey helpers ────────────────────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  Ctrl: "⌃", Alt: "⌥", Shift: "⇧",
  Insert: "Ins", Delete: "Del", Backquote: "`", Escape: "Esc",
  Space: "Space", Enter: "↵", Backslash: "\\",
  BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
  Comma: ",", Period: ".", Slash: "/", Minus: "-", Equal: "=",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

export function formatHotkeyDisplay(hotkey: string): string {
  return hotkey.split("+").map(p => {
    if (p in KEY_LABELS) return KEY_LABELS[p];
    if (/^Key[A-Z]$/.test(p)) return p.slice(3);
    if (/^Digit[0-9]$/.test(p)) return p.slice(5);
    return p;
  }).join(" + ");
}

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
]);

function HotkeyCapture({ value, onChange }: { value: string; onChange: (k: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const divRef = useRef<HTMLDivElement>(null);

  const start = () => {
    setCapturing(true);
    setTimeout(() => divRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (MODIFIER_CODES.has(e.code)) return;
    if (e.code === "Escape") { setCapturing(false); return; }
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(e.code);
    onChange(parts.join("+"));
    setCapturing(false);
  };

  return (
    <div className="flex items-center gap-2">
      <div ref={divRef} tabIndex={capturing ? 0 : -1}
        onKeyDown={capturing ? handleKeyDown : undefined}
        onBlur={() => setCapturing(false)}
        className={`flex-1 flex items-center justify-center h-9 rounded-xl border font-mono text-sm outline-none select-none transition-all ${
          capturing
            ? "border-primary/50 bg-primary/5 text-primary/50 animate-pulse"
            : "border-border/40 bg-muted/20 text-foreground"
        }`}>
        {capturing ? "↓ Press any key…" : formatHotkeyDisplay(value)}
      </div>
      <button onClick={capturing ? () => setCapturing(false) : start}
        className={`h-9 px-3 rounded-xl text-xs font-medium border transition-colors ${
          capturing
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border/30 bg-muted/20 text-muted-foreground hover:text-foreground hover:border-border/50"
        }`}>
        {capturing ? "Esc to cancel" : "Change"}
      </button>
    </div>
  );
}

// ─── Mini components ─────────────────────────────────────────────────────────

function Toggle({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">{title}</p>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/20 my-4" />;
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground/60 mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <button key={String(o.value)} onClick={() => onChange(o.value)}
          className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all ${value === o.value
            ? "bg-primary/15 text-primary border border-primary/30"
            : "text-muted-foreground/50 border border-border/30 hover:text-muted-foreground"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MicDevicePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (active) setDevices(all.filter(d => d.kind === "audioinput"));
      } catch { /* enumeration unavailable */ }
    };
    void load();
    navigator.mediaDevices.addEventListener?.("devicechange", load);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", load);
    };
  }, []);

  const unlabeled = devices.length > 0 && devices.every(d => !d.label);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Mic className="w-3.5 h-3.5 text-muted-foreground/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted/25 border border-transparent text-sm text-foreground outline-none focus:border-primary/30 appearance-none cursor-pointer">
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </div>
      {unlabeled && (
        <p className="text-[10px] text-muted-foreground/40">Join voice once to let your browser reveal device names.</p>
      )}
    </div>
  );
}

const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] =
  (["auto", "1080p60", "1080p30", "720p30", "480p30"] as VideoQuality[]).map(v => ({ value: v, label: VIDEO_QUALITY_LABELS[v] }));

const VIDEO_CODEC_OPTIONS: { value: VideoCodec; label: string }[] =
  (["auto", "VP9", "VP8", "H264", "AV1"] as VideoCodec[]).map(v => ({ value: v, label: v === "auto" ? "Auto" : v }));

// ─── Main component ──────────────────────────────────────────────────────────

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roomName?: string;
  onRename?: (name: string) => void;
  isRenaming?: boolean;
  showLeaveConfirm: boolean;
  onLeaveStart: () => void;
  onLeaveCancel: () => void;
  onLeaveConfirm: () => void;
  isLeaving?: boolean;
}

export function SettingsModal({
  open, onOpenChange,
  roomName, onRename, isRenaming,
  showLeaveConfirm, onLeaveStart, onLeaveCancel, onLeaveConfirm, isLeaving,
}: SettingsModalProps) {
  const { settings, set, reset, exportCode, importCode } = useSettings();
  const { toast } = useToast();

  const [renameValue, setRenameValue] = useState(roomName ?? "");
  const [importValue, setImportValue] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);

  const handleExport = () => {
    const code = exportCode();
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  };

  const handleImport = () => {
    const ok = importCode(importValue.trim());
    if (ok) {
      toast({ title: "Settings imported!" });
      setImportValue("");
    } else {
      toast({ title: "Invalid settings code", variant: "destructive" });
    }
  };

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim() || renameValue === roomName) return;
    onRename?.(renameValue);
  };

  const fontSizes: { key: FontSize; label: string }[] = [
    { key: "sm", label: "S" },
    { key: "md", label: "M" },
    { key: "lg", label: "L" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border/50 rounded-2xl max-w-sm p-0 overflow-hidden shadow-2xl max-h-[90vh]">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/20 shrink-0">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <Settings className="w-4 h-4 text-primary" /> Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="mx-6 mt-4 mb-0 shrink-0 bg-muted/30 rounded-xl h-9 grid grid-cols-5">
            {[
              { key: "appearance", label: "Look" },
              { key: "chat", label: "Chat" },
              { key: "audio", label: "Media" },
              { key: "overlay", label: "Overlay" },
              { key: "export", label: "Share" },
            ].map(t => (
              <TabsTrigger key={t.key} value={t.key}
                className="rounded-lg text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground/60">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Appearance ── */}
          <TabsContent value="appearance" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Theme">
              <Row label="UI Style" description="Overall visual design">
                <div className="flex gap-1">
                  {(["lynx", "classic"] as const).map(t => (
                    <button key={t} onClick={() => set("uiTheme", t)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${settings.uiTheme === t
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "text-muted-foreground/50 border border-transparent hover:text-muted-foreground"}`}>
                      {t === "lynx" ? "Lynx" : "Classic"}
                    </button>
                  ))}
                </div>
              </Row>
            </Section>

            <Divider />

            <Section title="Accent Color">
              <div className="flex items-center gap-2 flex-wrap">
                {(Object.entries(ACCENT_COLORS) as [AccentPreset, typeof ACCENT_COLORS[AccentPreset]][]).map(([key, { hex, label }]) => (
                  <button key={key} onClick={() => set("accentPreset", key)} title={label}
                    className={`w-7 h-7 rounded-full transition-all ${settings.accentPreset === key
                      ? "ring-2 ring-offset-2 ring-offset-card ring-white scale-110"
                      : "hover:scale-105 opacity-70 hover:opacity-100"}`}
                    style={{ backgroundColor: hex }} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground/50">
                Current: <span className="text-primary font-medium">{ACCENT_COLORS[settings.accentPreset].label}</span>
              </p>
            </Section>

            <Divider />

            <Section title="Panel">
              <Row label="Opacity" description="Background transparency">
                <div className="flex items-center gap-3">
                  <input type="range" min={20} max={100} step={5}
                    value={settings.panelOpacity}
                    onChange={e => set("panelOpacity", Number(e.target.value))}
                    className="w-24 accent-primary h-1 rounded-full" />
                  <span className="text-xs text-muted-foreground/70 w-8 text-right">{settings.panelOpacity}%</span>
                </div>
              </Row>
              <Row label="Blur" description="Frosted glass backdrop">
                <Toggle checked={settings.blurBackground} onToggle={() => set("blurBackground", !settings.blurBackground)} />
              </Row>
            </Section>

            <Divider />

            <Section title="Text Size">
              <div className="flex gap-1">
                {fontSizes.map(({ key, label }) => (
                  <button key={key} onClick={() => set("fontSize", key)}
                    className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${settings.fontSize === key
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground/50 border border-border/30 hover:text-muted-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Section>
          </TabsContent>

          {/* ── Chat ── */}
          <TabsContent value="chat" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Display">
              <Row label="Timestamps" description="Show time on each message">
                <Toggle checked={settings.showTimestamps} onToggle={() => set("showTimestamps", !settings.showTimestamps)} />
              </Row>
              <Row label="Compact" description="Tighter message spacing">
                <Toggle checked={settings.compactMessages} onToggle={() => set("compactMessages", !settings.compactMessages)} />
              </Row>
            </Section>

            <Divider />

            <Section title="Pop-out">
              <Row label="Float chat" description="Detach chat into a separate window">
                <Toggle checked={settings.chatPopout} onToggle={() => set("chatPopout", !settings.chatPopout)} />
              </Row>
              {settings.chatPopout && (
                <p className="text-xs text-primary/70 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Chat is floating — drag it anywhere
                </p>
              )}
            </Section>

            {roomName && onRename && (
              <>
                <Divider />
                <Section title="Room">
                  <form onSubmit={handleRename} className="flex gap-2">
                    <Input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                      placeholder="Room name"
                      className="h-9 rounded-xl bg-muted/25 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-sm flex-1" />
                    <Button type="submit" size="sm" className="h-9 rounded-xl text-xs px-4"
                      disabled={isRenaming || !renameValue.trim() || renameValue === roomName}>
                      {isRenaming ? "…" : "Save"}
                    </Button>
                  </form>
                </Section>
              </>
            )}

            {onLeaveStart && (
              <>
                <Divider />
                <Section title="Danger">
                  {!showLeaveConfirm ? (
                    <button className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-destructive/25 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
                      onClick={onLeaveStart}>
                      <LogOut className="w-3.5 h-3.5" /> Leave Room
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground/60 text-center">You'll need the invite code to rejoin.</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1 rounded-xl text-xs" onClick={onLeaveCancel}>Cancel</Button>
                        <Button size="sm" className="flex-1 rounded-xl text-xs bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                          onClick={onLeaveConfirm} disabled={isLeaving}>
                          {isLeaving ? "…" : "Confirm Leave"}
                        </Button>
                      </div>
                    </div>
                  )}
                </Section>
              </>
            )}
          </TabsContent>

          {/* ── Overlay ── */}
          <TabsContent value="overlay" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="In-Game Overlay">
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Press your hotkey anytime to collapse the panel into a minimal HUD. Drag the HUD anywhere on screen — it shows crew status and unread messages without blocking your view.
              </p>
              <div className="flex items-center gap-3 px-3 py-2 bg-muted/20 border border-border/30 rounded-xl">
                <Gamepad2 className="w-4 h-4 text-primary/60 shrink-0" />
                <div className="flex-1 text-xs text-muted-foreground/60">Works in any windowed game. Keep ScreenCrew on a second monitor or in a floating window.</div>
              </div>
            </Section>

            <Divider />

            <Section title="Toggle Hotkey">
              <Row label="Hotkey" description="Press to show/hide the panel">
                <span />
              </Row>
              <HotkeyCapture
                value={settings.overlayHotkey}
                onChange={v => set("overlayHotkey", v)}
              />
              <p className="text-[10px] text-muted-foreground/40">
                Tip: avoid keys your game uses. <span className="font-mono">Insert</span>, <span className="font-mono">F9</span>–<span className="font-mono">F12</span> are usually safe.
              </p>
            </Section>

            <Divider />

            <Section title="HUD Preview">
              <div className="flex justify-center py-2">
                <div className="inline-flex items-center gap-2 bg-card border border-primary/30 rounded-full px-3 py-1.5 shadow-lg text-xs">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="font-semibold text-foreground/90">your-room</span>
                  <span className="text-muted-foreground/60">3 online</span>
                  <span className="font-bold text-primary bg-primary/15 rounded-full px-1.5 py-0.5 text-[10px]">2 new</span>
                  <span className="font-mono text-[9px] text-muted-foreground/30">{formatHotkeyDisplay(settings.overlayHotkey)}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/40 text-center">Click the HUD or press the hotkey to restore the full panel</p>
            </Section>
          </TabsContent>

          {/* ── Media ── */}
          <TabsContent value="audio" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Sounds">
              <Row label="Sound effects" description="Join, message, reaction sounds">
                <Toggle checked={settings.soundEnabled} onToggle={() => set("soundEnabled", !settings.soundEnabled)} />
              </Row>
            </Section>

            <Divider />

            <Section title="Microphone">
              <Field label="Input device" description="Which mic to use for voice">
                <MicDevicePicker value={settings.micDeviceId} onChange={id => set("micDeviceId", id)} />
              </Field>
              <Row label="Mic volume" description="Boost or lower your input gain">
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={200} step={5}
                    value={settings.micGain}
                    onChange={e => set("micGain", Number(e.target.value))}
                    className="w-24 accent-primary h-1 rounded-full" />
                  <span className="text-xs text-muted-foreground/70 w-10 text-right">{settings.micGain}%</span>
                </div>
              </Row>
              <Row label="Echo cancellation" description="Remove speaker echo">
                <Toggle checked={settings.echoCancellation} onToggle={() => set("echoCancellation", !settings.echoCancellation)} />
              </Row>
              <Row label="Noise suppression" description="Filter background noise">
                <Toggle checked={settings.noiseSuppression} onToggle={() => set("noiseSuppression", !settings.noiseSuppression)} />
              </Row>
              <Row label="Auto gain" description="Auto-level your volume">
                <Toggle checked={settings.autoGainControl} onToggle={() => set("autoGainControl", !settings.autoGainControl)} />
              </Row>
              <p className="text-[10px] text-muted-foreground/40">Mic changes apply next time you join voice.</p>
            </Section>

            <Divider />

            <Section title="Screen Share">
              <Field label="Quality" description="Resolution &amp; frame rate cap">
                <Segmented value={settings.videoQuality} options={VIDEO_QUALITY_OPTIONS}
                  onChange={v => set("videoQuality", v)} />
              </Field>
              <Field label="Codec" description="Preferred video codec (if supported)">
                <Segmented value={settings.videoCodec} options={VIDEO_CODEC_OPTIONS}
                  onChange={v => set("videoCodec", v)} />
              </Field>
              <Field label="Max bitrate" description="Upload bandwidth ceiling">
                <Segmented value={settings.videoBitrate} options={VIDEO_BITRATE_OPTIONS}
                  onChange={v => set("videoBitrate", v)} />
              </Field>
              <Row label="Share system audio" description="Include tab/desktop sound">
                <Toggle checked={settings.shareSystemAudio} onToggle={() => set("shareSystemAudio", !settings.shareSystemAudio)} />
              </Row>
              <p className="text-[10px] text-muted-foreground/40">Video settings apply next time you start sharing.</p>
            </Section>
          </TabsContent>

          {/* ── Export / Import ── */}
          <TabsContent value="export" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Share your settings">
              <p className="text-xs text-muted-foreground/60">
                Copy your settings code and share it with friends. They can paste it to match your exact look.
              </p>
              <button onClick={handleExport}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm font-medium hover:bg-primary/15 transition-colors">
                {codeCopied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Settings Code</>}
              </button>
            </Section>

            <Divider />

            <Section title="Import settings">
              <div className="space-y-2">
                <Input value={importValue} onChange={e => setImportValue(e.target.value)}
                  placeholder="Paste settings code here…"
                  className="h-9 rounded-xl bg-muted/25 border-transparent focus-visible:border-primary/30 focus-visible:ring-0 text-sm font-mono text-xs" />
                <Button onClick={handleImport} disabled={!importValue.trim()}
                  className="w-full h-9 rounded-xl text-sm gap-2">
                  <Upload className="w-4 h-4" /> Apply Settings
                </Button>
              </div>
            </Section>

            <Divider />

            <Section title="Reset">
              <button onClick={() => { reset(); toast({ title: "Settings reset to defaults" }); }}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-destructive/25 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors">
                <RotateCcw className="w-3.5 h-3.5" /> Reset to Defaults
              </button>
            </Section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
