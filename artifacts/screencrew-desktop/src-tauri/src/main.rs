// ScreenCrew desktop tray shell.
//
// A thin native wrapper around a self-hosted ScreenCrew server. It opens the web
// app in a native window, navigates to the configured server URL, and adds a
// system-tray launcher. Closing the window hides it to the tray instead of
// quitting, so the client can stay running in the background.
//
// Scaffold only — build on your own machine with a Rust toolchain.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindowBuilder,
};

/// The server the desktop client points at. Override at launch:
///   SCREENCREW_URL="https://screencrew.example.com" npm run dev
fn server_url() -> String {
    std::env::var("SCREENCREW_URL").unwrap_or_else(|_| "http://localhost:8080".to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = server_url();
            let parsed = url
                .parse()
                .expect("SCREENCREW_URL must be a valid URL");

            // Main window loads the remote ScreenCrew web app directly.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("ScreenCrew")
                .inner_size(1100.0, 760.0)
                .min_inner_size(480.0, 600.0)
                .build()?;

            // System-tray menu: Show / Hide / Quit.
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            TrayIconBuilder::new()
                .tooltip("ScreenCrew")
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
        .expect("error while running ScreenCrew desktop");
}
