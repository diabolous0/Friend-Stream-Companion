// LynxDock desktop shell.
//
// A thin native wrapper around a LynxDock server. On launch it shows a built-in
// server picker (the bundled ../ui/index.html) where the user enters the address
// of the LynxDock server they want to connect to. After connecting, the window
// navigates to that server's web app. A system-tray icon keeps the client alive
// in the background and offers "Switch Server…" to return to the picker.
//
// Optionally, a server can be preset at build time or launch time via the
// LYNXDOCK_URL environment variable, in which case the app skips the picker and
// connects straight to that server.
//
// Scaffold only — build on your own machine (or via GitHub Actions) with a Rust
// toolchain. It cannot be compiled on Replit.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

/// Remembers the bundled picker ("home") URL so "Switch Server…" can return to it.
struct HomeUrl(Mutex<Option<Url>>);

/// An optional preset server. Set `LYNXDOCK_URL` at build time (baked in) or at
/// launch time to skip the picker and connect straight to that server.
fn preset_url() -> Option<String> {
    if let Ok(u) = std::env::var("LYNXDOCK_URL") {
        let u = u.trim().to_string();
        if !u.is_empty() {
            return Some(u);
        }
    }
    option_env!("LYNXDOCK_URL")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn main() {
    tauri::Builder::default()
        .manage(HomeUrl(Mutex::new(None)))
        .setup(|app| {
            // Start on the bundled server picker.
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("LynxDock")
            .inner_size(1100.0, 760.0)
            .min_inner_size(480.0, 600.0)
            .build()?;

            // Remember the picker URL for "Switch Server…".
            if let Ok(home) = window.url() {
                *app.state::<HomeUrl>().0.lock().unwrap() = Some(home);
            }

            // If a server was preset, connect straight to it and skip the picker.
            if let Some(raw) = preset_url() {
                if let Ok(parsed) = raw.parse::<Url>() {
                    let _ = window.navigate(parsed);
                }
            }

            // System-tray menu: Show / Hide / Switch Server / Quit.
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let switch =
                MenuItem::with_id(app, "switch", "Switch Server…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &switch, &quit])?;

            TrayIconBuilder::new()
                .tooltip("LynxDock")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "switch" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let home = app.state::<HomeUrl>().0.lock().unwrap().clone();
                            if let Some(home) = home {
                                let _ = w.navigate(home);
                            }
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        // Hide to tray on window close instead of quitting.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LynxDock desktop");
}
