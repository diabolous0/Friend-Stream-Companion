import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsProvider } from "@/lib/settings";

import Welcome from "@/pages/welcome";
import NotFound from "@/pages/not-found";
import { Button } from "@/components/ui/button";

const Login = lazy(() => import("@/pages/login"));
const Rooms = lazy(() => import("@/pages/rooms"));
const Room = lazy(() => import("@/pages/room"));
const ConnectServer = lazy(() => import("@/pages/connect-server"));
const HostServer = lazy(() => import("@/pages/host-server"));
const Admin = lazy(() => import("@/pages/admin"));
const AppShell = lazy(() =>
  import("@/components/app-shell").then((module) => ({ default: module.AppShell })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Welcome} />
      <Route path="/login" component={Login} />
      <Route path="/connect" component={ConnectServer} />
      <Route path="/host" component={HostServer} />
      <Route path="/admin" component={Admin} />
      <Route path="/rooms">
        <AppShell>
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

function RouteLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="flex w-48 flex-col items-center gap-3 text-center">
        <img
          src={`${import.meta.env.BASE_URL}lynxdock-icon.png`}
          alt=""
          className="h-10 w-10 rounded-lg object-cover"
        />
        <span className="text-xs font-medium text-muted-foreground">Opening LynxDock...</span>
      </div>
    </main>
  );
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Failed to open LynxDock route", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-sm border-y border-border/60 py-6 text-center">
          <h1 className="text-base font-semibold">This screen could not open.</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The connection may have changed while LynxDock was loading.
          </p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </main>
    );
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoading />}>
                <Router />
              </Suspense>
            </RouteErrorBoundary>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
