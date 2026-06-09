# LynxDock Desktop (Tauri shell)

A lightweight native desktop app for LynxDock. On launch it shows a **server
picker** where you type the address of the LynxDock server you want to use, then
opens that server's web app in a native window. A system-tray icon keeps it
running in the background (always-on "LAN-party" client).

> **Cannot be built on Replit.** Tauri needs a local Rust toolchain and
> per-OS build tools, so this package is intentionally excluded from the pnpm
> workspace. Build it with **GitHub Actions** (recommended — see below) or on
> your own machine.

## What it does

- Shows a built-in **server picker** on first launch; remembers recent servers.
- Loads the chosen LynxDock server in a native window (screen sharing works,
  because the desktop webview runs on a secure origin).
- System-tray icon with **Show**, **Hide**, **Switch Server…**, and **Quit**.
- Closing the window hides it to the tray instead of quitting.
- Launching LynxDock again restores and focuses the existing window.
- Optional: preset a server with the `LYNXDOCK_URL` env var to skip the picker.

## Download (for users)

Once the GitHub Actions release has run, grab the installer for your OS from the
repo's **Releases** page:

- **Windows** — `LynxDock_x64-setup.exe` (or the `.msi`)
- **Linux** — `lynxdock_*.AppImage` (portable) or the `.deb`

Run it, type your LynxDock server address (e.g.
`https://your-lynxdock.replit.app`), and click **Connect**.

## Build automatically with GitHub Actions (recommended)

This repo ships a workflow at `.github/workflows/desktop-release.yml` that builds
Windows **and** Linux installers for you — no local toolchain needed.

1. Push this project to a GitHub repository.
2. Trigger a build either way:
   - Push a version tag: `git tag v0.1.0 && git push origin v0.1.0`, **or**
   - In GitHub → **Actions** → **Build LynxDock Desktop** → **Run workflow**.
3. When it finishes, the installers are attached to a **draft Release**. Open
   **Releases**, review it, and publish so others can download.

## Build it yourself (local)

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- Platform deps per the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).
  On Debian/Ubuntu Linux:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
    librsvg2-dev patchelf libgtk-3-dev build-essential
  ```

### Develop

```bash
cd artifacts/screencrew-desktop
npm install
npm run dev
# or preset a server and skip the picker:
LYNXDOCK_URL="http://localhost:8080" npm run dev
```

### Build installers

```bash
npm run build
```

Outputs land in `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows,
`.AppImage`/`.deb` on Linux, `.dmg` on macOS).

## App icons

The icon set in `src-tauri/icons/` is generated from the LynxDock logo. To
regenerate from a new source image:

```bash
npm run tauri icon path/to/logo.png
```

## Notes

- Screen capture requires a secure origin, so connect to an `https://` server
  (or `http://localhost` when testing locally). See `../../SELF_HOSTING.md` for
  running your own server.
