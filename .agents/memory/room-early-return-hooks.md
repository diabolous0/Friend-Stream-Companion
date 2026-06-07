---
name: room.tsx early-return hook boundary
description: room.tsx has a mid-component early return, so all hooks must be declared above it.
---

room.tsx renders a loading spinner via an early `if (!me || !room) return (...)` partway down the component. Many plain `const`s (e.g. `activeStream`, `viewingUser`) and event-handler closures live *below* that return — but those are fine because they are not hooks.

**Rule:** any new `useState` / `useEffect` / `useRef` / custom hook (e.g. `useStreamPopouts`, `useDraggable`) must be declared **above** the early return, alongside the other top-of-component hooks. Placing a hook below it compiles but throws "rendered fewer hooks than expected" at runtime whenever the guard is hit (initial load / reconnect).

**Why:** the bug is invisible to typecheck and to the logged-out screenshot (login page never mounts room.tsx), so it only surfaces after auth. Caught once already during the window-management feature work.

**How to apply:** when adding state/hooks to room.tsx, scroll up to the hook cluster near the top of the component body; don't drop them next to the consts that sit after the spinner return.
