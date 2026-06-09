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

use std::{
    fs::{create_dir_all, OpenOptions},
    io::Write,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Url,
};

/// Remembers the bundled picker ("home") URL so "Switch Server…" can return to it.
struct HomeUrl(Mutex<Option<Url>>);

fn write_startup_log(app: &tauri::AppHandle, message: &str) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if create_dir_all(&log_dir).is_err() {
        return;
    }
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("startup.log"))
    else {
        return;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let _ = writeln!(file, "{timestamp} {message}");
}

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
        // Register this first so another launch restores the existing app.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            write_startup_log(app, "second launch requested; restoring main window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(HomeUrl(Mutex::new(None)))
        .setup(|app| {
            write_startup_log(app.handle(), "starting LynxDock");

            // Tauri creates the configured main window before setup. Keeping
            // creation in tauri.conf.json avoids a tray-only startup state.
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| {
                    std::io::Error::other("Tauri did not create the main LynxDock window")
                })?;
            write_startup_log(app.handle(), "main window created");

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

            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();

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
                            let _ = w.unminimize();
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
                            let _ = w.unminimize();
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
