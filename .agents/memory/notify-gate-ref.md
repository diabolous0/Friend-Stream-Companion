---
name: Notification gate ref freshness
description: Why the per-room/per-channel notify gate is assigned during render, not in a useEffect.
---

The function that decides whether an incoming chat message should ping
(`shouldNotifyRef.current`) is read inside long-lived WebSocket handlers, so it
must be a ref to avoid stale closures. But the ref's value is assigned **during
render**, not inside a `useEffect`.

**Why:** If you sync the ref in an effect, there is a brief post-render /
pre-effect window where a message arriving right after the user toggles DND or
mutes a room/channel is still evaluated against the *old* preferences — a real
one-message race. Assigning during render closes that window.

**How to apply:** For any ref that mirrors current render state and is consumed
by async/event callbacks (WS handlers, timers), assign it in the render body
(`ref.current = derive(state)`), not in an effect. Reading state during render
to compute a ref value is allowed in React.
