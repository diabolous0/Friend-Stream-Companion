# ScreenCrew Desktop (Tauri tray shell)

A lightweight native desktop wrapper for ScreenCrew. It opens your ScreenCrew
server in a native window and adds a system-tray icon so the app can live in the
background (always-on "LAN-party" client).

> **Scaffold only.** This package cannot be built on Replit — Tauri needs a local
> Rust toolchain and platform build tools. Build it on your own machine (macOS,
> Windows, or Linux). It is intentionally excluded from the pnpm workspace.

## What it does

- Loads the ScreenCrew web app from a server URL (defaults to `http://localhost:8080`,
  overridable with the `SCREENCREW_URL` env var at launch).
- Runs a system-tray icon with **Show**, **Hide**, and **Quit**.
- Closing the window hides to tray instead of quitting.

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- Platform deps per the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

## Develop

```bash
cd artifacts/screencrew-desktop
npm install
SCREENCREW_URL="http://localhost:8080" npm run dev
```

## App icons

The bundle config references `src-tauri/icons/icon.png`. Generate the full icon
set from a single source image before your first build:

```bash
npm run tauri icon path/to/logo.png
```

## Build installers

```bash
npm run build
```

Outputs land in `src-tauri/target/release/bundle/` (`.dmg` / `.msi` / `.AppImage`
depending on your OS).

## Pointing at your server

The shell loads `SCREENCREW_URL` (falling back to `http://localhost:8080`). Point it
at your self-hosted server, e.g.:

```bash
SCREENCREW_URL="https://screencrew.example.com" npm run dev
```

Because screen capture requires a secure origin, use `https://` (or `localhost`)
when running against a remote server. See `../../SELF_HOSTING.md`.
