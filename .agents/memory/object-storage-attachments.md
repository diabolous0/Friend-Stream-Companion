---
name: Object-storage attachment access control
description: Why chat attachment uploads use an authenticated request-url → PUT → finalize flow with public ACL, and how downloads enforce it.
---

# Object-storage attachments (chat file/image sharing)

Upload flow is three steps: authed `POST /storage/uploads/request-url` (validates size/type, returns signed PUT URL + objectPath) → client `PUT`s to the signed URL → authed `POST /storage/uploads/finalize` sets the object's ACL policy (`owner`, `visibility: "public"`).

The download route `GET /storage/objects/*` enforces `canAccessObject(READ)` with **no userId**, so only finalized/public objects are served; un-finalized or private objects return 403.

**Why:** `<img src>` and `<a href>` cannot send `Authorization` headers, so attachments must be readable without an auth header. Making them public-via-ACL (with unguessable UUID paths) is the only way images render while still blocking arbitrary/un-finalized objects. The finalize step is required because GCS ACL metadata can only be set *after* the object exists. Without finalize, every object would have no ACL and `canAccessObject` returns false → 403.

**How to apply:** Any new attachment type must go through finalize to be viewable. If you add a "private to room" requirement later, you'd need a query-param token scheme (headers won't work for media tags). Server-side size/type validation lives in `request-url`; the client 25MB check is advisory only.
