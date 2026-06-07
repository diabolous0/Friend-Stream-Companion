# Self-Hosting ScreenCrew

ScreenCrew runs in two modes from one codebase:

- **Quick Session** — the hosted/Replit default. Postgres + Replit object storage, configured
  entirely through environment variables. Nothing here changes that.
- **Self-Hosted Permanent** — your own server. SQLite + local-disk storage by default, driven by a
  config file. This guide covers that mode.

In self-hosted mode a single Node process serves both the API (`/api`) and the web app (`/`) from
the same origin, so there is nothing extra to configure on the client — it just talks to the server
it was loaded from.

## Host it on your PC — step by step

This is the friendliest path: run ScreenCrew on your own computer with Docker, and let friends
connect over the internet. No Postgres, no cloud account.

**1. Install Docker.** Get [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(macOS/Windows) or Docker Engine (Linux). Confirm it works: `docker --version`.

**2. Get the code.** Clone or download this repository, then open a terminal in its folder.

**3. Create your settings file.** Copy the example and open `.env` in a text editor:

```bash
cp .env.example .env
```

At minimum set a real `SESSION_SECRET` (run `openssl rand -hex 32` and paste the result) and a
`SERVER_NAME`. Leave the `TURN_*` lines empty for now.

**4. Start it.**

```bash
docker compose up -d --build
```

The first build takes a few minutes. After it finishes, open **`http://localhost:8080`** on the same
machine. Click **Register** to create the first account. To get admin powers (manage users, invite
keys, registration mode), set an `adminPassword` — see [Configuration](#configuration).

**5. Let friends in.** Your friends need a way to reach your PC from outside your home network. Pick one:

- **Easiest — a tunnel (no router changes):** install [Tailscale](https://tailscale.com/) on your PC
  and your friends' devices; they then reach you at `http://<your-tailscale-name>:8080`. Or use a
  public tunnel like [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  or `ngrok http 8080`, which also gives you an `https://` address for free.
- **Classic — port forwarding:** forward port `8080` on your home router to your PC's local IP, then
  share `http://<your-public-ip>:8080`. You'll also want HTTPS (see
  [Putting it behind HTTPS](#putting-it-behind-https)) because browsers block screen capture on
  plain `http://` for non-localhost addresses.

**6. (If screen sharing fails for some friends) turn on the built-in relay.** See
[Built-in TURN relay](#built-in-turn-relay-works-out-of-the-box) below.

That's it. Your database and uploads persist in a Docker volume across restarts. The rest of this
guide covers options, Postgres, HTTPS, and TURN in more detail.

## Quick start with Docker (recommended)

The image builds the frontend and API together and runs them as one container.

```bash
# From the repo root:
docker build -f artifacts/api-server/Dockerfile -t screencrew .
docker run -d --name screencrew -p 8080:8080 -v screencrew-data:/data screencrew
```

Or use Docker Compose (builds + runs in one step, with a persistent volume):

```bash
SESSION_SECRET="$(openssl rand -hex 32)" docker compose up -d --build
```

The `docker-compose.yml` at the repo root defaults to SQLite and has a commented-out
Postgres service you can enable.

Open `http://<your-server-ip>:8080`. The `screencrew-data` volume persists the SQLite database
(`/data/screencrew.db`) and uploaded files (`/data/uploads`) across restarts.

### Set a real session secret

The default session secret is for development only. Always override it in production:

```bash
docker run -d --name screencrew -p 8080:8080 -v screencrew-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  screencrew
```

## Running without Docker

You need Node.js 24 and a C/C++ toolchain (for the native SQLite addon: `python3`, `make`, `g++`).

```bash
corepack enable
pnpm install --frozen-lockfile

# Build the frontend (served by the API server) and the server bundle:
PORT=8080 BASE_PATH=/ pnpm --filter @workspace/screencrew run build
pnpm --filter @workspace/api-server run build

# Create the SQLite schema (idempotent):
pnpm --filter @workspace/db run push:sqlite-force

# Run it:
SESSION_SECRET="$(openssl rand -hex 32)" \
DB_DRIVER=sqlite SQLITE_PATH=./data/screencrew.db \
STORAGE_DRIVER=local STORAGE_DATA_DIR=./data/uploads \
SCREENCREW_STATIC_DIR=./artifacts/screencrew/dist/public \
PORT=8080 \
node artifacts/api-server/dist/index.mjs
```

## Configuration

Settings resolve in this order (later wins):

1. Built-in defaults
2. A JSON config file
3. Environment variables

### Config file

Copy the example and edit it:

```bash
cp screencrew.config.example.json screencrew.config.json
```

By default the server looks for `screencrew.config.json` in the working directory. Point it elsewhere
with `SCREENCREW_CONFIG=/path/to/config.json`. With Docker, mount it in:

```bash
docker run -d -p 8080:8080 -v screencrew-data:/data \
  -v "$PWD/screencrew.config.json:/app/screencrew.config.json:ro" \
  screencrew
```

| Key                | Env override        | Default                  | Notes                                              |
| ------------------ | ------------------- | ------------------------ | -------------------------------------------------- |
| `serverName`       | `SERVER_NAME`       | `ScreenCrew Server`      | Display name for your community.                   |
| `port`             | `PORT`              | `8080`                   | Port the server binds (on `0.0.0.0`).              |
| `sessionSecret`    | `SESSION_SECRET`    | dev-only value           | **Set this.** Used to sign auth tokens.            |
| `adminPassword`    | `ADMIN_PASSWORD`    | none                     | Optional admin password.                           |
| `maxUsers`         | `MAX_USERS`         | `100`                    | Soft cap on accounts.                              |
| `registration`     | `REGISTRATION`      | `open`                   | `open`, `invite`, or `closed`.                     |
| `database.driver`  | `DB_DRIVER`         | `sqlite` (self-host)     | `sqlite` or `postgres`.                            |
| `database.path`    | `SQLITE_PATH`       | `./data/screencrew.db`   | SQLite file path.                                  |
| `database.url`     | `DATABASE_URL`      | none                     | Postgres connection string (if `driver=postgres`).  |
| `storage.driver`   | `STORAGE_DRIVER`    | `local` (self-host)      | `local` or `replit`.                               |
| `storage.dataDir`  | `STORAGE_DATA_DIR`  | `./data/uploads`         | Where uploaded files are stored (local driver).    |
| `iceServers`       | —                   | Google STUN              | WebRTC ICE servers (config file only; see below).  |
| —                  | `TURN_URL`          | none                     | TURN URL to advertise, e.g. `turn:host:3478`.      |
| —                  | `TURN_USERNAME`     | none                     | TURN username (paired with `TURN_URL`).            |
| —                  | `TURN_CREDENTIAL`   | none                     | TURN password (paired with `TURN_URL`).            |

> Note: if `DATABASE_URL` is set and `DB_DRIVER` is not, the server assumes Postgres. This keeps the
> hosted deployment working unchanged.

### Using Postgres instead of SQLite

```bash
docker run -d -p 8080:8080 -v screencrew-data:/data \
  -e DB_DRIVER=postgres \
  -e DATABASE_URL="postgres://user:pass@host:5432/screencrew" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  screencrew
```

Create the schema against your Postgres instance once with
`DATABASE_URL=... pnpm --filter @workspace/db run push-force`.

## WebRTC across the internet (TURN)

Screen sharing is peer-to-peer. A STUN server (the default) is enough on the same LAN or with simple
NATs. For peers on restrictive networks (many home routers do "symmetric" NAT) a direct connection
can't be made, and you need a **TURN** server to relay the media. ScreenCrew supports two ways to add
one.

### Built-in TURN relay (works out of the box)

The `docker-compose.yml` ships a ready-to-run [coturn](https://github.com/coturn/coturn) relay behind
an opt-in profile. To enable it:

1. In your `.env`, fill in the TURN settings:

   ```bash
   TURN_PUBLIC_HOST=203.0.113.5          # public IP/hostname friends use to reach you
   TURN_URL=turn:203.0.113.5:3478        # usually turn:<TURN_PUBLIC_HOST>:3478
   TURN_USERNAME=screencrew
   TURN_CREDENTIAL=a-long-random-password
   ```

2. Start the stack with the `turn` profile:

   ```bash
   docker compose --profile turn up -d --build
   ```

That's it — the server automatically advertises the relay to clients (no config file needed), and the
same username/password are used by both sides. Open the relay's ports to the internet (the same way
you exposed `8080`): **TCP/UDP 3478** and **UDP 49160–49200**.

> On Linux the coturn service uses host networking (most reliable for TURN's wide UDP port range). On
> Docker Desktop (macOS/Windows) host networking isn't supported — in `docker-compose.yml`, remove
> `network_mode: host` from the `coturn` service and uncomment its `ports:` block.

### Bring your own TURN (config file)

If you already run a TURN server, just list it under `iceServers` in your config file instead:

```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": "turn:your-turn-host:3478",
      "username": "screencrew",
      "credential": "your-turn-password"
    }
  ]
}
```

Either way, ICE servers are only ever sent to **authenticated** users (`GET /api/ice-servers`), so TURN
credentials are never exposed publicly. They are, however, visible to any logged-in member (the browser
needs them to connect), so use a long random password dedicated to TURN and rotate it if someone leaves.
The `turn` profile refuses to start unless `TURN_USERNAME`, `TURN_CREDENTIAL`, and `TURN_PUBLIC_HOST`
are all set — there are no insecure defaults.

## Putting it behind HTTPS

Browsers only allow screen capture (`getDisplayMedia`) on secure origins (`https://` or
`http://localhost`). For LAN-only use, `http://localhost` works; for anything else, terminate TLS with
a reverse proxy (Caddy, nginx, Traefik) in front of the container and proxy both `/` and `/api`
(including the `/api/ws` WebSocket upgrade) to port 8080.

Minimal Caddy example:

```
screencrew.example.com {
    reverse_proxy localhost:8080
}
```

## Desktop client (optional)

A native desktop tray shell lives in `artifacts/screencrew-desktop/` (Tauri). It wraps a
self-hosted server in a native window with a system-tray launcher. It is a scaffold and must be
built on your own machine (it needs a Rust toolchain) — see that folder's `README.md`.

## Backups

Everything lives under the data directory (`/data` in Docker):

- `screencrew.db` (+ `-wal`/`-shm` files) — the SQLite database
- `uploads/` — uploaded files

Stop the container (or checkpoint the WAL) and copy that directory to back up.
