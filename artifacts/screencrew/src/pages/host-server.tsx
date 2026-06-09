import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Check, Clipboard, Download, RadioTower, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type RegistrationMode = "open" | "invite" | "closed";

function randomHex(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function envValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function normalizeRelayHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/^turn:/i, "").replace(/\/.*$/, "").replace(/:3478$/, "");
}

export default function HostServer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [serverName, setServerName] = useState("My LynxDock");
  const [port, setPort] = useState("8080");
  const [registration, setRegistration] = useState<RegistrationMode>("invite");
  const [sessionSecret, setSessionSecret] = useState(() => randomHex());
  const [adminPassword, setAdminPassword] = useState(() => randomHex(12));
  const [serverAddress, setServerAddress] = useState("localhost:8080");
  const [enableRelay, setEnableRelay] = useState(false);
  const [relayHost, setRelayHost] = useState("");
  const [relayUsername, setRelayUsername] = useState("lynxdock");
  const [relayCredential, setRelayCredential] = useState(() => randomHex(18));
  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535;
  const cleanRelayHost = normalizeRelayHost(relayHost);
  const relayReady = !enableRelay || cleanRelayHost.length > 0;
  const startCommand = enableRelay ? "docker compose --profile turn up -d --build" : "docker compose up -d --build";

  useEffect(() => {
    setServerAddress((current) => /^localhost:\d+$/.test(current) ? `localhost:${portValid ? port : "8080"}` : current);
  }, [port, portValid]);

  const envFile = useMemo(() => {
    const lines = [
      `SESSION_SECRET=${sessionSecret}`,
      `SERVER_NAME=${envValue(serverName.trim() || "My LynxDock")}`,
      `PORT=${portValid ? port : "8080"}`,
      `REGISTRATION=${registration}`,
      `ADMIN_PASSWORD=${adminPassword}`,
      "MAX_USERS=100",
      "",
    ];
    if (enableRelay && cleanRelayHost) {
      lines.push(
        `TURN_PUBLIC_HOST=${cleanRelayHost}`,
        `TURN_URL=turn:${cleanRelayHost}:3478`,
        `TURN_USERNAME=${relayUsername.trim() || "lynxdock"}`,
        `TURN_CREDENTIAL=${relayCredential}`,
        "",
      );
    } else {
      lines.push("TURN_PUBLIC_HOST=", "TURN_URL=", "TURN_USERNAME=lynxdock", "TURN_CREDENTIAL=", "");
    }
    return lines.join("\n");
  }, [adminPassword, cleanRelayHost, enableRelay, port, portValid, registration, relayCredential, relayUsername, serverName, sessionSecret]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: `Could not copy ${label.toLowerCase()}`, variant: "destructive" });
    }
  };

  const downloadEnv = () => {
    const href = URL.createObjectURL(new Blob([envFile], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = ".env";
    anchor.click();
    URL.revokeObjectURL(href);
    toast({ title: "Starter settings downloaded", description: "Place .env in the LynxDock project folder." });
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4 text-primary" /> Host a persistent server
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold sm:text-3xl">Set up your LynxDock home.</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Generate secure starter settings for the included Docker setup. Your rooms, accounts, chat, and uploads stay on your machine.
          </p>
        </div>

        <section className="border-y border-border/60 py-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-medium text-muted-foreground">
              Server name
              <Input value={serverName} onChange={(event) => setServerName(event.target.value)} maxLength={60} className="h-10" />
            </label>
            <label className="space-y-2 text-xs font-medium text-muted-foreground">
              Port
              <Input value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" className="h-10" />
              {!portValid && <span className="block text-destructive">Choose a port from 1 to 65535.</span>}
            </label>
          </div>

          <div className="mt-5">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Who can register</div>
            <div className="grid grid-cols-3 gap-2">
              {(["invite", "open", "closed"] as RegistrationMode[]).map((mode) => (
                <Button key={mode} type="button" variant={registration === mode ? "default" : "outline"} onClick={() => setRegistration(mode)} className="capitalize">
                  {registration === mode && <Check className="h-4 w-4" />} {mode}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-medium text-muted-foreground">
              Admin password
              <div className="flex gap-2">
                <Input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="h-10 min-w-0" />
                <Button type="button" variant="outline" size="icon" title="Generate a new admin password" onClick={() => setAdminPassword(randomHex(12))}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </label>
            <div className="flex items-end">
              <div className="flex min-h-10 w-full items-center gap-2 border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                A unique 64-character server secret is included automatically.
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border/60 py-6">
          <button
            type="button"
            onClick={() => setEnableRelay((value) => !value)}
            className="flex w-full items-start justify-between gap-4 text-left"
          >
            <span className="flex gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
                <RadioTower className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">Add relay for tougher networks</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Helps voice and screen sharing when friends cannot connect directly through their router or firewall.
                </span>
              </span>
            </span>
            <span className={`mt-2 flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${enableRelay ? "bg-primary" : "bg-muted-foreground/30"}`}>
              <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${enableRelay ? "translate-x-4" : "translate-x-0.5"}`} />
            </span>
          </button>

          {enableRelay && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="space-y-2 text-xs font-medium text-muted-foreground">
                Public IP or domain
                <Input
                  value={relayHost}
                  onChange={(event) => setRelayHost(event.target.value)}
                  placeholder="203.0.113.5 or voice.example.com"
                  className="h-10"
                />
                {!relayReady && <span className="block text-destructive">Enter the address friends use to reach this machine.</span>}
              </label>
              <label className="space-y-2 text-xs font-medium text-muted-foreground">
                Relay password
                <div className="flex gap-2">
                  <Input value={relayCredential} onChange={(event) => setRelayCredential(event.target.value)} className="h-10 min-w-0" />
                  <Button type="button" variant="outline" size="icon" title="Generate a new relay password" onClick={() => setRelayCredential(randomHex(18))}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </label>
              <label className="space-y-2 text-xs font-medium text-muted-foreground sm:col-span-2">
                Relay username
                <Input value={relayUsername} onChange={(event) => setRelayUsername(event.target.value)} className="h-10" />
              </label>
              <div className="sm:col-span-2 text-xs leading-5 text-muted-foreground">
                The generated settings advertise <strong>turn:{cleanRelayHost || "your-host"}:3478</strong>. Open TCP/UDP 3478 and UDP 49160-49200 on the machine or router running the relay.
              </div>
            </div>
          )}
        </section>

        <section className="grid gap-0 border-b border-border/60 md:grid-cols-3 md:divide-x md:divide-border/60">
          <div className="py-6 md:pr-5">
            <div className="mb-3 text-xs font-semibold uppercase text-primary">1. Download settings</div>
            <Button onClick={downloadEnv} disabled={!portValid || !adminPassword.trim() || !relayReady} className="w-full gap-2"><Download className="h-4 w-4" /> Download .env</Button>
          </div>
          <div className="border-t border-border/60 py-6 md:border-t-0 md:px-5">
            <div className="mb-3 text-xs font-semibold uppercase text-primary">2. Start LynxDock</div>
            <Button variant="outline" onClick={() => copy(startCommand, "Start command")} disabled={!relayReady} className="w-full gap-2">
              <Clipboard className="h-4 w-4" /> Copy start command
            </Button>
          </div>
          <div className="border-t border-border/60 py-6 md:border-t-0 md:pl-5">
            <div className="mb-3 text-xs font-semibold uppercase text-primary">3. Connect</div>
            <div className="flex gap-2">
              <Input value={serverAddress} onChange={(event) => setServerAddress(event.target.value)} className="h-10 min-w-0" />
              <Button onClick={() => setLocation(`/connect?address=${encodeURIComponent(serverAddress)}`)} disabled={!serverAddress.trim()}>
                Connect
              </Button>
            </div>
          </div>
        </section>

        <div className="mt-5 text-xs leading-5 text-muted-foreground">
          Place the downloaded <strong>.env</strong> file in the LynxDock project folder, then run the copied command there. Docker keeps server data in a persistent volume.
        </div>
      </div>
    </main>
  );
}
