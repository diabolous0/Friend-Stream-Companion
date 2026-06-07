---
name: Backend switching isolation
description: Rules for switching the active backend in the multi-backend (server-rail) client so data from one backend never bleeds into another.
---

# Backend switching isolation

There is more than one code path that changes the active backend (the server rail
switcher and the connect-server page). Every such path must do the same two things,
or cross-backend data leaks into the UI:

1. **Clear the React Query cache** (`queryClient.clear()`) right after activating the
   new backend. Otherwise stale `me` / rooms / server-info from the previous backend
   is served until refetch.
2. **Let per-backend client stores re-read deterministically.** Stores keyed by the
   active server id (e.g. favorites) must not rely on incidental re-renders. The
   active-server setter dispatches a `SERVER_CHANGED_EVENT` window event; such stores
   subscribe to it and notify their `useSyncExternalStore` listeners.

**Why:** an architect review caught that the connect-server switch path skipped the
cache clear (the rail path had it), so favorites/me from the old backend transiently
appeared under the new one. Centralizing the switch behavior and the change event
prevents this class of regression.

**How to apply:** when adding any new way to change the active backend, route it
through the active-server setter (so the event fires) AND clear the query cache at the
React layer (the setter can't reach `queryClient`, which is context-bound).
