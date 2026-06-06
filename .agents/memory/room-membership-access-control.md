---
name: Room membership access-control invariants
description: Authorization rules every ScreenCrew room/membership/knock/pin/approve path must enforce.
---

# Room membership & creator-only gating invariants

ScreenCrew rooms support knock-to-join (`room_members.status` = `active` | `pending`)
and creator-only management. Several endpoints historically leaked access; keep these
invariants whenever touching room routes (`artifacts/api-server/src/routes/rooms.ts`)
or WS signaling.

- **Every membership read/check must filter `status = 'active'`.** The `GET /rooms`
  list and its member-count subquery, the WS `join_room` handler, and message
  send/edit/delete routes must all require an *active* membership. A `pending` knocker
  must not appear as a joined room, inflate counts, join the room WS, or mutate
  messages.
- **Creator-only actions:** privacy toggle, invite expiry, regenerate invite code,
  room theme/banner/notes edits, pinning messages, and approving knock requests are
  all gated on `room.createdBy === userId`. Any active member is NOT enough.
- **Both join routes** (`POST /rooms/:roomId/join` and `POST /rooms/join-by-code`)
  must honor invite expiry and private knock-to-join (insert `pending` + broadcast
  `knock`), returning `{ pending }`. Don't let the legacy join route bypass privacy.
- **Race safety:** `room_members` has a UNIQUE(`room_id`,`user_id`) constraint; all
  join inserts use `.onConflictDoNothing()`. (The constraint was added via raw
  `ALTER TABLE` because `drizzle-kit push` wanted an interactive truncate — check for
  duplicate rows first, then add the constraint directly.)

**Known remaining gap (lower priority):** WS membership is only validated at
`join_room` time, not per subsequent WS event — a socket whose membership is revoked
in another session keeps room access until it disconnects.

**Why:** an architect review caught these as real authorization bugs; an e2e test
confirmed the corrected knock→approve→enter→chat flow end-to-end.
