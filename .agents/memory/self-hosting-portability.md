---
name: Self-hosting / portability design decisions
description: Durable rules for ScreenCrew's dual-mode (Quick Session vs Self-Hosted Permanent) server — config, server-metadata exposure, ephemeral-room retention.
---

# Self-hosting / portability

ScreenCrew runs one codebase in two modes: Quick Session (Postgres/Replit, env-driven) and
Self-Hosted Permanent (SQLite + local disk, config-file-driven). Central resolver is
`artifacts/api-server/src/lib/config.ts` (defaults → JSON file → env, later wins).

## Never expose TURN credentials on a public/unauthenticated endpoint
- Public `GET /server-info` returns ONLY non-sensitive metadata (serverName, registration) because the
  login screen needs it pre-auth.
- ICE servers (which may carry TURN `username`/`credential`) are served from `GET /ice-servers` behind
  `requireAuth`.
- **Why:** static TURN secrets exposed publicly enable third-party relay abuse / cost amplification.
- **How to apply:** any future server metadata that includes secrets/credentials goes behind auth; keep
  only what an anonymous login page strictly needs in the public endpoint.
- TURN can also be wired purely via env (`TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL`) — `config.ts`
  appends a TURN entry to `iceServers` only when `TURN_URL` is non-empty, so the default stays STUN-only.
- The bundled coturn service in `docker-compose.yml` is an opt-in Docker profile (`turn`). Its
  credentials/external-ip use fail-fast `${VAR:?msg}` substitution — **never** ship default/guessable
  TURN creds, or the profile creates an abusable relay. Note: any authenticated member can read TURN
  creds via `/ice-servers` (browser needs them), so they are member-visible, not fully secret.

## Client ICE config: undefined vs empty array
- In `use-webrtc.ts`, `iceServers === undefined` means "not loaded yet" → keep Google STUN fallback. An
  explicit `[]` means the operator intends no ICE servers and must be honored (do not fall back).

## Ephemeral room retention
- Ephemeral rooms get `expiresAt`; activity (new message) extends it via dialect-safe `.set()` updates.
- The cleanup job (`lib/cleanup.ts`) must **re-check `expiresAt` immediately before** cascading a delete —
  a message can extend the room between the scan and the delete. SQLite has no row locks / `SELECT ... FOR
  UPDATE`, so this re-read is the pragmatic race-narrowing fix (not a full lock).
- Cascade delete order (children first, because SQLite may not enforce FKs): message reactions →
  messages → bots → bans → channels → members → room.

## Client room-create contract
- Only send `ephemeral: true` when the user explicitly opts in; omit the field otherwise so the server's
  configured default (`config.ephemeralRooms`) applies. Sending `ephemeral: false` defeats the server default.

## Desktop shell
- `artifacts/screencrew-desktop/` (Tauri) is intentionally EXCLUDED from the pnpm workspace
  (`!artifacts/screencrew-desktop` in `pnpm-workspace.yaml`) — it has its own npm + Rust toolchain and
  cannot build on Replit. Keep it out so `pnpm install --frozen-lockfile` / typecheck stay clean.
