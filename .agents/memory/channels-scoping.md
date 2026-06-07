---
name: Channel scoping & access control
description: Invariants for ScreenCrew room channels — message path parity, default seeding, and private-channel isolation.
---

# Channel scoping invariants

- **New room creation must seed BOTH an owner membership (`role: "owner"`) AND a default channel.**
  **Why:** chat requires an active channel (WS `chat_message` refuses without `state.channelId`; frontend defaults to the first text channel). Channel/role management is gated on `role` being owner/mod. A room with neither is silently broken — members can't chat and the creator can't manage. The T001 migration only backfilled *existing* rooms, so the create handler had to be fixed separately.
  **How to apply:** any change to the room-create flow must keep both inserts.

- **HTTP and WS message paths must stay in lockstep on channel scoping.** Both must persist `channelId`, broadcast via `broadcastChannel(channelId, …)` (not `broadcastToRoom`), enforce announcement-staff-only posting, validate replies are same-channel, and block private channels for non-staff.
  **Why:** the frontend sends chat over HTTP `POST /messages` but relies on the WS `new_message` echo; if only one path is channel-scoped, messages bleed across channels or leak private-channel content room-wide.
  **How to apply:** when touching either path, mirror the change in the other.

- **Every message-related route (list/send/reply/edit/delete/reaction/pin/pins) must check private-channel access**, not just room membership. Non-staff must not read or mutate messages whose `channelId` is a private channel (look up `channels.isPrivate`). Mutation broadcasts must be channel-scoped so they don't leak to other channels.
  **Why:** room membership alone let any member reach private-channel messages by ID, and room-wide mutation broadcasts leaked private activity.

- Private-channel gate for cross-channel listing: `or(isNull(messages.channelId), notInArray(messages.channelId, privateIds))` — the `isNull` arm is required so legacy null-channel messages aren't dropped (SQL `NULL NOT IN (…)` is NULL/excluded).
