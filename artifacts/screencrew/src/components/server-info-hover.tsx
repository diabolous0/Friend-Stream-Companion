import { useGetServerInfo } from "@workspace/api-client-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Server as ServerIcon, Users, DoorOpen, KeyRound, Lock } from "lucide-react";
import { getServerLabel } from "@/lib/server-connection";

const REGISTRATION_META: Record<string, { label: string; Icon: typeof DoorOpen }> = {
  open: { label: "Open registration", Icon: DoorOpen },
  invite: { label: "Invite only", Icon: KeyRound },
  closed: { label: "Registration closed", Icon: Lock },
};

/**
 * Wraps a trigger (e.g. the server name) with a small hover window that surfaces
 * live server info: name, description, member count, and registration policy.
 */
export function ServerInfoHover({ children }: { children: React.ReactNode }) {
  const { data: serverInfo } = useGetServerInfo();

  const name = serverInfo?.serverName || getServerLabel();
  const reg = REGISTRATION_META[serverInfo?.registration ?? "open"] ?? REGISTRATION_META.open;
  const RegIcon = reg.Icon;

  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-72">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <ServerIcon className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-foreground truncate">{name}</p>
            {serverInfo?.description ? (
              <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
                {serverInfo.description}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/50 mt-0.5 italic">No description set</p>
            )}
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-border/40 space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span>
              <span className="text-foreground font-medium">{serverInfo?.userCount ?? 0}</span>{" "}
              {serverInfo?.userCount === 1 ? "member" : "members"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RegIcon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
            <span>{reg.label}</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
