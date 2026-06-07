---
name: Tauri desktop shell (LynxDock)
description: Gotchas for the artifacts/screencrew-desktop Tauri v2 app — window lifecycle, server picker, CI builds.
---

# LynxDock desktop (Tauri v2)

Lives at `artifacts/screencrew-desktop/`, excluded from the pnpm workspace, cannot be compiled on Replit (needs Rust + per-OS toolchains/webkit2gtk). Real Windows + Linux installers come from GitHub Actions (`.github/workflows/desktop-release.yml`, `tauri-action`).

## Window lifecycle gotcha
**Do NOT define a window in `tauri.conf.json` `app.windows` AND also create one with the same label (`"main"`) in `setup()`.** Tauri v2 auto-creates configured windows, so a manual `WebviewWindowBuilder::new(app, "main", ...)` collides on the duplicate label and can abort startup.
**Why:** we need a window handle in `setup()` (to capture `window.url()` for "Switch Server" and to `navigate()` to a preset URL), so we keep the manual builder and set `app.windows: []` in config.
**How to apply:** pick ONE creation path — manual builder with empty config `windows`, or config window + `app.get_webview_window("main")` in setup.

## Server picker design
No server is baked in (user requirement). App boots the bundled `ui/index.html` picker (pure JS, `window.location.href` to navigate to the chosen server — no Tauri IPC, so no capabilities file needed). Optional `LYNXDOCK_URL` (runtime env or compile-time `option_env!`) skips the picker. Tray "Switch Server…" navigates back to the stored home (picker) URL via `window.navigate()`.
