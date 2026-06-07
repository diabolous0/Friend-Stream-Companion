# ScreenCrew → Self-Hosted Roadmap

Goal: evolve ScreenCrew from a Replit-only web app into a system with **two modes** on **one
codebase** — *Quick Session* (connect to a default server, ephemeral rooms) and *Self-Hosted
Permanent* (run your own always-on server, persistent storage, connect by IP/domain/invite key).

Guiding rules:
- Smallest safe change at each step; the current app must keep working after every phase.
- The server is already a standalone process; we extend it, we do not fork it.
- Config precedence everywhere: **defaults → config file → environment variables** (so Replit keeps
  working via env, and self-hosters use a file).
- Legend: `[NEW]` create, `[CHANGE]` modify, `[REGEN]` run codegen after an OpenAPI edit.

---

## Phase 1 — Current app cleanup

Prepare the ground without changing behavior: centralize configuration and remove known dead code.

- `[NEW]  artifacts/api-server/src/lib/config.ts` — single source of truth for runtime config. In
  this phase it just wraps `PORT`, `SESSION_SECRET`, `DATABASE_URL` reads (zod-validated). Later
  phases extend it with file loading.
- `[CHANGE] artifacts/api-server/src/index.ts` — read `port` from `config.ts` instead of
  `process.env.PORT` directly.
- `[CHANGE] artifacts/api-server/src/middlewares/auth.ts` — read `SESSION_SECRET` from `config.ts`.
- `[CHANGE] lib/db/src/index.ts` — read `DATABASE_URL` via a small config helper (prep for the
  driver switch in Phase 2).
- `[CHANGE] artifacts/api-server/src/routes/channels.ts` — remove the dead duplicate member-role
  route handler (flagged in review as a policy-drift risk; the active one lives in `rooms.ts`).
- `[CHANGE] replit.md` — document the new config module and the dev/run commands.

**Done when:** typecheck passes, app behaves identically, all env access goes through `config.ts`.

---

## Phase 2 — Persistent self-hosted server

Make the server runnable anywhere from a config file with embedded SQLite, and let the client point
at a remote server. **SQLite is the heaviest item** — the schema is currently Postgres-specific.

Server config + packaging:
- `[CHANGE] artifacts/api-server/src/lib/config.ts` — full config-file loader: read path from
  `SCREENCREW_CONFIG` env or default `./screencrew.config.json`. Fields: `serverName`, `port`,
  `adminPassword`, `maxUsers`, `registration` (`open|invite|closed`), `invite` settings, `dbDriver`
  (`postgres|sqlite`), `dbPath`. Env vars override file values.
- `[NEW]  artifacts/api-server/screencrew.config.example.json` — documented example config.
- `[NEW]  artifacts/api-server/Dockerfile` — containerized standalone server.
- `[NEW]  artifacts/api-server/SELF_HOSTING.md` — run instructions (Windows/Linux/Docker).

File storage (must be portable — currently Replit-only):
- `[CHANGE] artifacts/api-server/src/lib/objectStorage.ts` — extract a `StorageBackend` interface
  (request-upload, finalize, serve, ACL). Today this file hard-binds to the Replit sidecar
  (`127.0.0.1:1106`) + `@google-cloud/storage` — that endpoint does not exist off-Replit.
- `[NEW]  artifacts/api-server/src/lib/storage/localDisk.ts` — **default self-host backend**: stores
  uploads under `config.dataDir/uploads`, serves them through the existing `/storage/*` routes.
- `[NEW]  artifacts/api-server/src/lib/storage/replitObject.ts` — the current GCS/sidecar logic moved
  behind the interface (used on Replit/cloud).
- `[CHANGE] artifacts/api-server/src/routes/storage.ts` — depend on the selected backend, not the
  concrete `ObjectStorageService`.
- `[CHANGE] artifacts/api-server/src/lib/config.ts` — add `storageDriver` (`local|replit`) and
  `dataDir`. Self-host defaults to `local`.

Database (Postgres + SQLite via Drizzle):
- `[CHANGE] lib/db/src/index.ts` — select driver at startup: `drizzle-orm/node-postgres` (default,
  cloud) or `drizzle-orm/better-sqlite3` (self-host) based on config.
- `[CHANGE] lib/db/src/schema/*.ts` — make column types dialect-neutral (or add a parallel
  `schema-sqlite/`). Affects `users.ts`, `rooms.ts`, `channels.ts`, `messages.ts`, `roomBans.ts`,
  `friendships.ts`, `blocks.ts`, `bots.ts`, `index.ts`.
- `[CHANGE] lib/db/drizzle.config.ts` — support both `postgresql` and `sqlite` dialects.
- `[CHANGE] lib/db/package.json` — add `better-sqlite3` + a `push:sqlite` script.

Client connection layer (default stays same-origin = Quick Session):
- `[NEW]  artifacts/screencrew/src/lib/server-connection.ts` — store/read the chosen server URL
  (localStorage) and derive the HTTP base + WebSocket URL from it.
- `[CHANGE] artifacts/screencrew/src/main.tsx` — call `setBaseUrl(serverUrl)` on startup (the
  function already exists in `custom-fetch.ts`, just unused today).
- `[CHANGE] artifacts/screencrew/src/hooks/use-websocket.ts` — build the WS URL from
  `server-connection.ts` instead of `window.location.host`.
- `[NEW]  artifacts/screencrew/src/pages/connect-server.tsx` — screen to enter a server address
  (IP / domain / invite link) or pick "Quick Session" (default server).
- `[CHANGE] artifacts/screencrew/src/App.tsx` — route to the connect screen when no server selected.

**Done when:** `node dist/index.js` runs the server from a config file with a SQLite database file,
and the client can connect to it by IP/domain. Replit (Postgres + env) still works unchanged.

---

## Phase 3 — User accounts / invite keys

Server-level account policy and invite keys (distinct from per-room invite codes).

- `[NEW]  lib/db/src/schema/serverInvites.ts` — server invite keys (`key`, `createdBy`, `maxUses`,
  `uses`, `expiresAt`).
- `[CHANGE] lib/db/src/schema/index.ts` — export the new table.
- `[CHANGE] lib/db/src/schema/users.ts` — add `isAdmin` flag (admin bootstrapped from config
  `adminPassword`).
- `[CHANGE] lib/api-spec/openapi.yaml` — endpoints: register-with-invite, registration-policy
  enforcement, admin create/list/revoke invite keys. `[REGEN]` `pnpm --filter @workspace/api-spec
  run codegen` (updates `lib/api-client-react/src/generated/`).
- `[NEW]  artifacts/api-server/src/routes/serverInvites.ts` — invite-key CRUD (admin only).
- `[CHANGE] artifacts/api-server/src/routes/auth.ts` — enforce `registration` mode and consume an
  invite key on register.
- `[CHANGE] artifacts/api-server/src/routes/index.ts` — mount the invites router.
- `[CHANGE] artifacts/api-server/src/middlewares/auth.ts` — admin authorization helper.
- `[NEW]  artifacts/screencrew/src/pages/admin.tsx` — admin panel: server settings view + invite-key
  management.
- `[CHANGE] artifacts/screencrew/src/pages/login.tsx` — optional invite-key field on register.

**Done when:** an `invite`-mode server rejects open signups and accepts a valid invite key; the admin
can mint and revoke keys.

---

## Phase 4 — Persistent rooms and chat history

Rooms and messages already persist in the DB. This phase adds the **ephemeral vs permanent**
distinction and retention/cleanup.

- `[CHANGE] lib/db/src/schema/rooms.ts` — add `ephemeral` (boolean) and `lastActivityAt` /
  `expiresAt` for cleanup.
- `[CHANGE] lib/api-spec/openapi.yaml` — room create accepts `ephemeral`; expose retention settings.
  `[REGEN]` codegen.
- `[CHANGE] artifacts/api-server/src/routes/rooms.ts` — set `ephemeral` on create per mode/config.
- `[CHANGE] artifacts/api-server/src/routes/messages` handling (in `rooms.ts`) — confirm/extend
  history pagination for long-lived rooms.
- `[NEW]  artifacts/api-server/src/lib/cleanup.ts` — interval job to delete expired ephemeral rooms
  and apply message retention.
- `[CHANGE] artifacts/api-server/src/index.ts` — start the cleanup job on boot.
- `[CHANGE] artifacts/screencrew/src/pages/rooms.tsx` + `room.tsx` — show ephemeral vs permanent
  badge; ensure history loads on a permanent server.

**Done when:** a permanent server retains rooms/history across restarts; ephemeral rooms auto-expire.

---

## Phase 5 — WebRTC screen sharing through server signaling

Signaling already works (P2P media, WS relay). This phase makes it robust for self-hosted servers
behind NAT by making STUN/TURN configurable instead of the hardcoded Google STUN.

- `[CHANGE] artifacts/api-server/src/lib/config.ts` — add `iceServers` (STUN/TURN URLs + creds).
- `[NEW]  artifacts/api-server/src/routes/serverInfo.ts` — public endpoint returning `serverName`,
  `iceServers`, `registration` mode (used by the connect screen and WebRTC client).
- `[CHANGE] artifacts/api-server/src/routes/index.ts` — mount `serverInfo`.
- `[CHANGE] lib/api-spec/openapi.yaml` — add the server-info schema. `[REGEN]` codegen.
- `[CHANGE] artifacts/screencrew/src/hooks/use-webrtc.ts` — fetch ICE servers from server-info
  instead of the hardcoded Google STUN list.
- `[CHANGE] artifacts/screencrew/src/lib/signaling` path usage in `use-websocket.ts` — already
  derived from server-connection (Phase 2); verify it carries through for remote servers.
- `[CHANGE] artifacts/screencrew/src/pages/connect-server.tsx` — show the server name (from
  server-info) before login.

**Done when:** two peers on different networks can screen-share through a self-hosted server with a
configured TURN relay.

---

## Phase 6 — Desktop packaging / tray app

Package the client as a small Windows tray/dock app; ship the server as a container/binary.

> Note: Tauri/Electron builds require a native toolchain and **cannot be fully built on Replit** —
> this phase scaffolds the project to build locally on Windows/macOS/Linux.

- `[NEW]  artifacts/screencrew-desktop/` — desktop shell (Tauri recommended for a small footprint):
  - `src-tauri/tauri.conf.json` — window + tray config, bundles the built web client.
  - `src-tauri/Cargo.toml`, `src-tauri/src/main.rs` — tray icon, minimize-to-tray, pop-out windows.
- `[CHANGE] artifacts/screencrew/vite.config.ts` — ensure the build output is consumable by the
  desktop shell (relative base when packaged).
- `[CHANGE] artifacts/api-server/Dockerfile` (+ `[NEW] docker-compose.yml`) — finalize always-on
  server deployment.
- `[NEW]  scripts/` packaging helpers — build/release scripts for client and server.

**Done when:** the client runs as a tray app that connects to any ScreenCrew server, and the server
runs from Docker on a home server/VPS.

---

## Portability guarantee (no Replit-only dependencies)

A self-hosted server must run with **zero** Replit infrastructure. Audit of current Replit-coupled
surfaces and how each is made portable:

| Surface | Today (Replit-coupled) | Portable design |
| --- | --- | --- |
| Database | `DATABASE_URL` Postgres | SQLite default for self-host; Postgres opt-in (Phase 2) |
| File storage | Replit sidecar `127.0.0.1:1106` + GCS | Local-disk backend default (Phase 2) |
| Config | env vars only | config file with env overrides (Phase 2) |
| WebRTC ICE | hardcoded Google STUN | configurable STUN/TURN (Phase 5) |
| GIPHY | `GIPHY_API_KEY` | optional; feature hidden when key absent (degrade gracefully) |
| Hosting/port | Replit-assigned `PORT` | `port` from config file; binds `0.0.0.0` |

Rule going forward: any new server feature must work behind the `local`/`sqlite`/config-file path,
not just the Replit path. A feature that only works on Replit is not "done."

## Cross-cutting notes

- Run codegen after every `openapi.yaml` change: `pnpm --filter @workspace/api-spec run codegen`.
- Keep Postgres + Replit storage as the *cloud* defaults; SQLite + local-disk are the *self-host*
  defaults — both selected by one config, never a code fork.
- Each phase ends with `pnpm run typecheck` green and the existing app verified working.
