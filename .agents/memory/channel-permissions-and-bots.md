---
name: Channel permissions & bot message routing
description: Where role/channel permission checks must live, and why bot/automated messages need a concrete channelId.
---

# Channel permission enforcement must cover ALL paths

Role-gated channel access (`channels.minViewRole` / `minSendRole`, plus `isPrivate`) must be
enforced on **every** read and write path, not just the obvious send path. The paths are:
- channels list (hide channels the caller can't view)
- message list, message search, pins (filter out hidden channels when no channel filter; 403 when an explicit channelId is gated)
- message edit / delete / reaction authorization
- REST message send + WS `chat_message` (send permission)
- **WS `join_channel`** — easy to miss; without it a member who guesses a channel id joins and receives `broadcastChannel` traffic.

**Why:** enforcing only on some paths (e.g. only the send path, or only `isPrivate` but not `minViewRole`)
leaves real read-access bypasses. A code review caught exactly this after the feature "looked" done and send-path tests passed.

**How to apply:** centralize the logic in helpers (e.g. `canAccessMessageChannel(channelId, role)` for a single
channel, `getHiddenChannelIds(roomId, role)` for cross-channel filters) and call them from every path above.
`roleAtLeast(role, minRole)` (exported from `@workspace/db`) ranks owner > mod > member and tolerates undefined role.

# Bot / automated messages need a concrete channelId

Webhook/bot-authored messages must be saved with a real `channelId` (default to the room's first
non-voice channel ordered by position), never `null`.

**Why:** clients render messages **per channel** (they query `?channelId=…`). A message with `channelId=null`
returns HTTP 201 and broadcasts, but is invisible in every channel view — looks like "the webhook silently does nothing."

**How to apply:** in the bot webhook, when no channelId is supplied, look up the default channel
(`ne(channelsTable.type, "voice")`, order by position, id) and use its id.

# Permission/role changes must evict live WS channel subscriptions

Static authz at join/send time is NOT enough. The signaling layer routes channel broadcasts
purely off in-memory `ClientState.channelId` with no per-delivery re-check, so a client that was
already joined keeps receiving traffic after a channel's `minViewRole`/`isPrivate` is tightened or
the member's role is lowered — a real post-change access bypass.

**Why:** a code review caught that tightening a channel to owner-only, or demoting a mod→member,
left their existing socket subscribed; reads/sends were denied but live broadcasts still leaked.

**How to apply:** after the channel-perm update route AND the (live) role-change route, re-validate
every currently-joined session against the effective view rule and evict failures (reset channel
state, emit a revoke event so the client navigates away, rebroadcast presence). Mirror the existing
kick/ban eviction pattern. Wire it to the *active* route handler — beware duplicate route
definitions where the first-registered router wins.
