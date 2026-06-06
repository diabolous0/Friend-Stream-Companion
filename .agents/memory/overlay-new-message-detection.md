---
name: Overlay new-message detection
description: Detecting "new" chat messages for overlay toasts/unread must key off message id, not array length.
---

In ScreenCrew room.tsx, "main window minimized" maps to `overlayMode` (main panel hidden to a draggable pill — the in-game/Steam-overlay equivalent). New-message toasts and the overlay unread badge fire while `overlayMode` is on.

**Rule:** detect freshly-arrived messages by comparing against the highest seen message `id` (track via a ref, e.g. `lastSeenMsgIdRef`), NOT by `messages.length` / array-index slicing.

**Why:** the `messages` array grows from BOTH ends — new messages append, but `loadMoreMessages` PREPENDS older history. Length/index-based detection (`messages.slice(prevCount)`) then captures already-seen recent messages and emits false toasts + bogus unread counts whenever older history loads while overlay is active.

**How to apply:** any "is this message new?" logic tied to the live `messages` array (toasts, unread, sounds) should filter `m.id > lastSeenId` and advance the ref to the max id each run. Same caution applies to any future feature reacting to incoming messages.
