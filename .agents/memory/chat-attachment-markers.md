---
name: Chat attachment markers
description: How ScreenCrew encodes non-text chat content (images, files, GIFs) and the security policy for rendering them.
---

# Chat attachment markers

ScreenCrew embeds non-text content in a message's `content` string using inline markers, parsed in `artifacts/screencrew/src/lib/markdown.tsx` (`splitAttachments` + `MessageContent`):

- `[screencrew:image:<objectPath>]` — uploaded image, served via `/api/storage<path>`
- `[screencrew:file:<objectPath>:<name>]` — uploaded file link
- `[screencrew:gif:<url>]` — Giphy GIF, rendered as `<img src=url>`

**Why / security policy:** the GIF marker stores a full external URL, so rendering MUST allowlist the host. Both the server route (`routes/giphy.ts`) and the client renderer (`markdown.tsx`) enforce an identical `isGiphyUrl` check (https + host is `giphy.com` or `*.giphy.com`) before emitting/rendering. Any new external-URL marker type needs the same dual-side allowlist or it becomes an arbitrary-embed/tracker vector.

**How to apply:** when adding a new attachment type, add its regex + segment to `splitAttachments`, a render branch in `MessageContent`, and a case in `toastPreview` (room.tsx) so overlay/notification previews show a friendly label instead of raw marker text.
