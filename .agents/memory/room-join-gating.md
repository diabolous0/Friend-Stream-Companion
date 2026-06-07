---
name: Room join gating order
description: Ordering rules for password vs private-knock checks in room join endpoints, and re-asserting WS-derived presence state after join/reconnect.
---

# Room join gating

## Password check must precede the private-knock branch
Both join endpoints (`POST /rooms/:roomId/join` and `POST /rooms/join-by-code`) must verify
`room.passwordHash` **before** the `room.isPrivate` knock-to-pending branch.

**Why:** If the private branch runs first, it creates a `pending` membership and broadcasts a
`knock` without ever checking the password — a password bypass for rooms that are both private
and password-protected.

**How to apply:** In each join handler, after the "already a member" early-return, run the
password verification block, then the `isPrivate` knock block, then the active-membership insert.

## Re-assert WS presence state after (re)join
Ephemeral presence facts the client pushes over the WebSocket (e.g. `watching` viewer lists)
live only in server memory keyed by the live socket. They must be re-sent after `join_room` and
on every reconnect, not only when the underlying value changes.

**Why:** A `watching` packet sent before the server processes `join_room` is dropped (no roomId
yet), and reconnects reset server-side state — viewer counts then stay stale until the user
manually toggles.

**How to apply:** Gate the watching effect on `isConnected && roomId`, keep the current ids in a
ref, and re-send `watching` from the same effect that sends `join_room` so it rehydrates in order.
