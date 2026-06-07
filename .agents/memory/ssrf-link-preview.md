---
name: SSRF-safe outbound fetch (link preview)
description: Why a one-time host check before fetch() is not enough, and the pattern that actually closes SSRF for user-supplied URLs.
---

A single pre-fetch host validation does NOT make an outbound fetch SSRF-safe when the
URL comes from a user.

**Why:** Node's global `fetch` (undici) follows redirects itself and does its own DNS
resolution. So a public URL can 30x-redirect to `127.0.0.1`/`169.254.169.254`, and DNS
rebinding can swap the validated hostname to a private IP in the TOCTOU window between
your `dns.lookup()` and undici's own connect. Both bypass a check that only runs once
on the original hostname.

**How to apply:** For any endpoint that fetches a user-supplied URL:
- Follow redirects manually (`redirect: "manual"` equivalent) with a small hop cap, and
  re-validate the host on every hop.
- Resolve the host yourself, reject if ANY resolved address is private/loopback/link-local/
  CGNAT/multicast (IPv4 + IPv6 incl. `::ffff:` mapped), then **connect to that exact IP**
  while setting the `Host` header and TLS `servername` (SNI) to the original hostname. This
  pins the connection so a rebind can't reach internal space.
- In this repo that means `node:http`/`node:https` `request({ host: ip, servername: hostname,
  headers: { host } })` rather than `fetch`, because `undici` is not a dependency and global
  `fetch` gives no per-connection IP control. See `artifacts/api-server/src/routes/linkPreview.ts`.
