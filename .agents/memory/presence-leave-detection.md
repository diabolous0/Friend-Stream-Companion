---
name: Presence leave detection (ScreenCrew)
description: Why client-side leave/offline must be inferred by diffing presence snapshots, not read from the payload.
---

`broadcastPresence` in `artifacts/api-server/src/lib/signaling.ts` builds its `entries` array from currently-connected room clients and hardcodes `online: true` on each. It never emits an `online: false` entry for a user who left.

**Consequence:** a client cannot detect leaves by looking for `!e.online` in the snapshot — such entries never arrive. A user who left simply vanishes from `entries`.

**How to apply:** in the client `onPresenceUpdate` (`room.tsx`), build a `Set` of userIds present in the new snapshot, then iterate the previously-online set (`prevOnlineRef`) — any id missing from the snapshot has left. Mark them offline in local presence state and fire the "leave" event sound. Also prune them from `prevOnlineRef`. The same applies to any future status that depends on disconnect (stale online/speaking/streaming indicators).
