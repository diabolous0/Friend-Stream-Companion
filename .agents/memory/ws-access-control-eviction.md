---
name: WS access-control eviction
description: Kicking/banning must evict live WebSocket sessions, not only delete DB membership.
---

When removing or banning a user from a room, deleting their DB membership and
sending a client-side notice (e.g. `removed_from_room` / `banned_from_room`) is
NOT enough to enforce access control.

**Why:** The signaling layer trusts in-memory `ClientState.roomId/channelId` for
real-time message routing (chat, presence, stream relay). A removed/banned client
can ignore the UI notice and keep sending/receiving traffic until they
disconnect and reconnect. The WS join handler re-checks active membership, so
reconnection is blocked — but the *existing* session is not.

**How to apply:** On kick/ban (and any role/access revocation), call a signaling
helper (`evictUserFromRoom(roomId, userId)`) that clears the in-memory session's
room/channel/streaming/voice state for that user and re-broadcasts presence, in
addition to the DB delete + client notify.
