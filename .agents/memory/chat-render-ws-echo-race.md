---
name: Chat render relies on WS echo — append on send too
description: Why ScreenCrew room chat must optimistically append a sent message instead of waiting only for the WebSocket new_message echo.
---

# Sent messages must be appended on mutation success, not only via WS echo

ScreenCrew's room view renders new chat messages from the WebSocket `new_message`
broadcast. The server `broadcast`/`broadcastToRoom` sends to every socket whose
`state.roomId === roomId`, including the sender — so normally the sender sees their
own message via the echo.

**The race:** a socket only gets `state.roomId` set after its `join_room` WS message
succeeds. A freshly-joined user (e.g. just approved into a knock-to-join room) who
sends a message before `join_room` completes will POST successfully (201) but never
receive the echo, so the message silently never renders for them.

**The rule:** when sending a chat message, also append the message returned by the
send mutation (`onSuccess`), deduping by `id` exactly like the `onNewMessage` handler
(`prev.some(m => m.id === msg.id) ? prev : [...]`). This makes the sender's own
message appear immediately regardless of WS join timing; the later WS echo is a no-op
thanks to the id dedup. Apply this to every send path (text/slash commands AND
file/image/GIF uploads).

**Why:** found via e2e test — a just-approved user's first message returned 201 but
chat showed "No messages yet". Relying solely on WS echo is fragile across the
join_room timing boundary.
