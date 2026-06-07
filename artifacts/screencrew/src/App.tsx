import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/lib/settings";

import Login from "@/pages/login";
import Rooms from "@/pages/rooms";
import Room from "@/pages/room";
import ConnectServer from "@/pages/connect-server";
import Admin from "@/pages/admin";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/app-shell";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/connect" component={ConnectServer} />
      <Route path="/admin" component={Admin} />
      <Route path="/rooms">
        <AppShell showNav>
          <Rooms />
        </AppShell>
      </Route>
      <Route path="/room/:roomId">
        <AppShell>
          <Room />
        </AppShell>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
