# ScreenCrew

A compact, dark-themed friend-group screen-sharing web app with Winamp/LAN-party aesthetic.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/screencrew run dev` — run the frontend (port 23898, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — for HMAC auth tokens

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + ws (WebSocket)
- DB: PostgreSQL + Drizzle ORM
- Auth: HMAC-SHA256 tokens via `SESSION_SECRET`
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + wouter + TanStack Query + shadcn/ui

## Where things live

- `lib/db/src/schema/` — DB schema (users, rooms, messages tables)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks + Zod schemas
- `artifacts/api-server/src/` — Express API + WebSocket signaling server
- `artifacts/api-server/src/lib/signaling.ts` — WebSocket signaling for WebRTC
- `artifacts/api-server/src/routes/` — auth, rooms, messages, presence routes
- `artifacts/screencrew/src/pages/` — login, rooms list, room view
- `artifacts/screencrew/src/hooks/` — `use-websocket.ts`, `use-webrtc.ts`

## Architecture decisions

- WebSocket signaling at `/api/ws` (same server as HTTP, attached via `createServer(app)` + `setupSignaling(server)`)
- Auth: stateless HMAC-SHA256 tokens (no session table); token stored in `localStorage` as `screencrew_token`
- WebRTC: peer-to-peer with Google STUN server; signaling relayed through our WebSocket server
- Presence is tracked in DB and broadcast via WebSocket on join/leave/stream events
- All API types flow from OpenAPI spec → Orval codegen → typed React Query hooks

## Product

- Register/login with username + password
- Create rooms with unique invite codes, join rooms by code
- Recent rooms strip on the rooms list (most-recently-visited first, relative timestamps)
- Optional room passwords (creator sets/clears; scrypt-hashed; join prompts when required; lock badge)
- Real-time crew status sidebar: online/speaking/streaming indicators
- WebRTC screen sharing: start TX to share your screen, click the video icon next to a streaming crew member to watch
- In-room stream quality picker (writes `settings.videoQuality`, applies on next share)
- Multi-stream grid view: toggle to watch all active streams at once; click a tile to focus
- Watching indicators: streamers see a viewer count (Eye badge) of who's watching their stream
- Text chat with real-time WebSocket delivery
- Mobile-friendly layout: room window fills the viewport and the stream window becomes a bottom sheet on small screens
- Dark cyan monospace theme (Winamp/LAN-party aesthetic)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`
- `useGetMe()` and other generated hooks accept `{ query: UseQueryOptions }` — `queryKey` is required if you pass a `query` option (TanStack Query v5 requirement); omit the options entirely to use defaults
- Deep imports like `@workspace/api-client-react/src/...` are not valid — always import from `@workspace/api-client-react` (the barrel re-exports everything including `setAuthTokenGetter`)
- Google Fonts `@import url(...)` must be the very first line in `index.css` before any Tailwind imports

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
