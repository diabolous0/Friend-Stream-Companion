# ScreenCrew — self-hosted single-container image.
#
# Builds the React frontend and the API server, then runs one Node process that
# serves both the API (/api) and the SPA (/) from the same origin. Uses SQLite +
# local-disk storage by default, persisted to the /data volume.
#
# Build from the repo root (it needs the whole workspace + lockfile):
#   docker build -f artifacts/api-server/Dockerfile -t screencrew .
#   docker run -p 8080:8080 -v screencrew-data:/data screencrew
#
# Then open http://<host>:8080. Override settings via env or a mounted config file
# (see SELF_HOSTING.md and screencrew.config.example.json).

# ---- build stage ----------------------------------------------------------
FROM node:24-bookworm-slim AS build

# Toolchain for compiling the native better-sqlite3 addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# Frontend build is driven by Vite, which requires PORT + BASE_PATH at build time.
# BASE_PATH=/ mounts the SPA at the server root.
ENV PORT=8080
ENV BASE_PATH=/
RUN pnpm --filter @workspace/screencrew run build
RUN pnpm --filter @workspace/api-server run build

# ---- runtime stage --------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy the fully-installed workspace (including the compiled better-sqlite3 addon,
# which matches this base image's Node ABI) and the build outputs.
COPY --from=build /app /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_DRIVER=sqlite
ENV SQLITE_PATH=/data/screencrew.db
ENV STORAGE_DRIVER=local
ENV STORAGE_DATA_DIR=/data/uploads
ENV SCREENCREW_STATIC_DIR=/app/artifacts/screencrew/dist/public

VOLUME ["/data"]
EXPOSE 8080

# Create the SQLite schema (idempotent) before starting the server.
CMD ["sh", "-c", "pnpm --filter @workspace/db run push:sqlite-force && node --enable-source-maps artifacts/api-server/dist/index.mjs"]
