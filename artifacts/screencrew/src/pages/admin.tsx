import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  getGetMeQueryKey,
  useGetServerConfig,
  getGetServerConfigQueryKey,
  useListInvites,
  getListInvitesQueryKey,
  useCreateInvite,
  useRevokeInvite,
  useClaimAdmin,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, ArrowLeft, Copy, Trash2, Plus } from "lucide-react";
import { useTheme } from "@/lib/theme";

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme } = useTheme();
  const classic = theme === "classic";
  const qc = useQueryClient();

  const { data: me, isLoading: meLoading } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey() },
  });

  const [adminPassword, setAdminPassword] = useState("");
  const [maxUses, setMaxUses] = useState("");

  const claimMutation = useClaimAdmin();
  const createMutation = useCreateInvite();
  const revokeMutation = useRevokeInvite();

  const isAdmin = !!me?.isAdmin;

  const { data: serverConfig } = useGetServerConfig({
    query: { enabled: isAdmin, queryKey: getGetServerConfigQueryKey() },
  });
  const { data: invites } = useListInvites({
    query: { enabled: isAdmin, queryKey: getListInvitesQueryKey() },
  });

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!me) {
    setLocation("/");
    return null;
  }

  const onClaim = (e: React.FormEvent) => {
    e.preventDefault();
    claimMutation.mutate(
      { data: { adminPassword } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setAdminPassword("");
          toast({ title: classic ? "ADMIN GRANTED" : "You are now an admin" });
        },
        onError: () =>
          toast({
            title: classic ? "DENIED" : "Incorrect admin password",
            variant: "destructive",
          }),
      }
    );
  };

  const onCreate = () => {
    const n = maxUses.trim() === "" ? null : Number(maxUses);
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      toast({ title: "Max uses must be a positive number", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { maxUses: n } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListInvitesQueryKey() });
          setMaxUses("");
        },
        onError: (err) =>
          toast({ title: "Could not create invite", description: err.message, variant: "destructive" }),
      }
    );
  };

  const onRevoke = (id: number) => {
    revokeMutation.mutate(
      { id },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListInvitesQueryKey() }),
        onError: () => toast({ title: "Could not revoke invite", variant: "destructive" }),
      }
    );
  };

  const copyInvite = (key: string) => {
    const link = `${window.location.origin}${import.meta.env.BASE_URL}?invite=${encodeURIComponent(key)}`;
    navigator.clipboard?.writeText(link);
    toast({ title: classic ? "LINK COPIED" : "Invite link copied" });
  };

  const card = `bg-card border border-border/50 ${classic ? "rounded-sm" : "rounded-2xl"}`;
  const heading = classic ? "font-mono uppercase tracking-widest text-primary" : "";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/rooms")}
            className={classic ? "rounded-sm" : "rounded-xl"}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Shield className="w-5 h-5 text-primary" />
          <h1 className={`text-lg font-semibold ${heading}`}>
            {classic ? "SERVER ADMIN" : "Server Admin"}
          </h1>
        </div>

        {!isAdmin ? (
          <form onSubmit={onClaim} className={`${card} p-6 space-y-3`}>
            <p className={`text-sm text-muted-foreground ${classic ? "font-mono" : ""}`}>
              {classic
                ? "ENTER THE SERVER ADMIN PASSWORD TO UNLOCK CONTROLS."
                : "Enter the server's admin password to unlock admin controls."}
            </p>
            <Input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder={classic ? "admin_password_" : "Admin password"}
              className={classic ? "rounded-sm font-mono" : "rounded-xl"}
            />
            <Button
              type="submit"
              disabled={!adminPassword || claimMutation.isPending}
              className={`w-full ${classic ? "rounded-sm font-mono uppercase tracking-widest" : "rounded-xl"}`}
            >
              {claimMutation.isPending
                ? classic ? "VERIFYING…" : "Verifying…"
                : classic ? "CLAIM ADMIN" : "Claim admin"}
            </Button>
          </form>
        ) : (
          <>
            {serverConfig && (
              <div className={`${card} p-6 space-y-2`}>
                <h2 className={`text-sm font-semibold mb-2 ${heading}`}>
                  {classic ? "SERVER" : "Server"}
                </h2>
                <Row label={classic ? "NAME" : "Name"} value={serverConfig.serverName} classic={classic} />
                <Row label={classic ? "REGISTRATION" : "Registration"} value={serverConfig.registration} classic={classic} />
                <Row
                  label={classic ? "USERS" : "Users"}
                  value={`${serverConfig.userCount} / ${serverConfig.maxUsers}`}
                  classic={classic}
                />
              </div>
            )}

            <div className={`${card} p-6 space-y-4`}>
              <div className="flex items-center justify-between">
                <h2 className={`text-sm font-semibold ${heading}`}>
                  {classic ? "INVITE KEYS" : "Invite keys"}
                </h2>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <label className={`text-xs text-muted-foreground ${classic ? "font-mono uppercase tracking-wider" : ""}`}>
                    {classic ? "MAX USES (BLANK = ∞)" : "Max uses (blank = unlimited)"}
                  </label>
                  <Input
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    inputMode="numeric"
                    placeholder={classic ? "∞" : "unlimited"}
                    className={classic ? "rounded-sm font-mono h-9" : "rounded-xl h-9"}
                  />
                </div>
                <Button
                  onClick={onCreate}
                  disabled={createMutation.isPending}
                  className={`gap-1.5 ${classic ? "rounded-sm font-mono uppercase tracking-wider h-9" : "rounded-xl h-9"}`}
                >
                  <Plus className="w-4 h-4" />
                  {classic ? "MINT" : "Create"}
                </Button>
              </div>

              <div className="space-y-2">
                {invites && invites.length > 0 ? (
                  invites.map((inv) => (
                    <div
                      key={inv.id}
                      className={`flex items-center gap-2 px-3 py-2 bg-muted/30 ${classic ? "rounded-sm" : "rounded-xl"}`}
                    >
                      <code className={`text-sm flex-1 truncate ${classic ? "text-primary" : ""}`}>{inv.key}</code>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {inv.uses}
                        {inv.maxUses != null ? ` / ${inv.maxUses}` : " used"}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyInvite(inv.key)}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => onRevoke(inv.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className={`text-sm text-muted-foreground ${classic ? "font-mono" : ""}`}>
                    {classic ? "NO INVITE KEYS YET." : "No invite keys yet."}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, classic }: { label: string; value: string; classic: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`text-muted-foreground ${classic ? "font-mono uppercase tracking-wider text-xs" : ""}`}>{label}</span>
      <span className={classic ? "font-mono text-primary" : "font-medium"}>{value}</span>
    </div>
  );
}
