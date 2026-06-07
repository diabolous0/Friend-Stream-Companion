import type { ReactNode } from "react";
import { ServerRail } from "@/components/server-rail";
import { NavColumn } from "@/components/nav-column";

export function AppShell({
  children,
  showNav = false,
}: {
  children: ReactNode;
  showNav?: boolean;
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <ServerRail />
      {showNav && <NavColumn />}
      <div className="flex-1 min-w-0 h-screen overflow-hidden">{children}</div>
    </div>
  );
}
