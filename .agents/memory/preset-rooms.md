---
name: Preset rooms invariants
description: Public-by-design constraints for admin-created preset rooms in ScreenCrew
---

# Preset rooms (admin-provided, publicly joinable)

Preset rooms (`rooms.preset = true`) are server-provided rooms any user can browse via `GET /preset-rooms` and one-click join via `POST /preset-rooms/:roomId/join` (no invite code). Created/deleted only by admins.

## Invariants to keep

- **Public-by-design is enforced, not assumed.** The generic `PATCH /rooms/:roomId` must reject any privacy/password/invite mutation (`isPrivate`, `password`, `inviteExpiresAt`, `regenerateCode`) when `room.preset` is true — even from the room creator. Otherwise a preset room could become private/password-locked while `joinPresetRoom` still force-joins anyone, breaking the contract.
  - **Why:** join path skips password/privacy checks by design; if those fields could drift, the join becomes an auth bypass.
- **Preset join upserts membership to active** (`onConflictDoUpdate` on `(roomId, userId)` → status active), unlike normal joins which use `onConflictDoNothing`. A user who left or has a stale/pending row must be promoted to active on rejoin, since the handler returns `pending:false`.

## kind → channels
- `text` → one text channel; `voice` → one voice channel; `text_voice` → both. Voice-only still gets one channel so the "at least one channel" invariant holds. room.tsx falls back to `channels[0]` when no text channel exists.
