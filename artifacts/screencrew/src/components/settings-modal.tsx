import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Copy, Check, Upload, Download, RotateCcw, LogOut, Pencil, ExternalLink } from "lucide-react";
import { useSettings, ACCENT_COLORS, type AccentPreset, type FontSize } from "@/lib/settings";
import { useToast } from "@/hooks/use-toast";

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
          <TabsList className="mx-6 mt-4 mb-0 shrink-0 bg-muted/30 rounded-xl h-9 grid grid-cols-4">
            {[
              { key: "appearance", label: "Look" },
              { key: "chat", label: "Chat" },
              { key: "audio", label: "Audio" },
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

          {/* ── Audio ── */}
          <TabsContent value="audio" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <Section title="Sounds">
              <Row label="Sound effects" description="Join, message, reaction sounds">
                <Toggle checked={settings.soundEnabled} onToggle={() => set("soundEnabled", !settings.soundEnabled)} />
              </Row>
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
