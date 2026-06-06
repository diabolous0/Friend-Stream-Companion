---
name: Read receipts over WebSocket
description: Integrity rules for the "read" WS event and last-read tracking
---

# Read receipts (WS-based)

`room_members.lastReadMessageId` tracks how far each member has read. Client sends `read` {messageId} over WS; server broadcasts `read_update`; `join_room` returns a `reads_snapshot`.

## Rules (learned from review)
- **Validate the message belongs to the room** before writing. The server must look up `(messageId, roomId)` in `messages` — never trust the client's id. Without this a client spoofs read progress for content it never saw (or cross-room ids).
- **Reject non-positive / non-integer ids** (`Number.isInteger && > 0`); the column is an integer, floats cause DB write errors.
- **Make the update monotonic and atomic in one SQL statement**: `SET lastReadMessageId = GREATEST(COALESCE(lastReadMessageId,0), $id)`. A select-then-update lets concurrent out-of-order events regress the stored value.
- **Wrap the branch in try/catch + logger.error** so a malformed payload can't crash the WS message loop.
- Broadcast the value returned from `.returning()`, not the raw input — it reflects the actual stored (monotonic) value.

**Why:** identity can't be spoofed (server uses `state.userId`), but read *position* is fully client-supplied and must be validated for the "who has seen this" feature to be trustworthy.
