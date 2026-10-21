//! Shelf's desktop app on Tauri. The React UI (ui/) talks to this host with the same messages it used with the old
//! WPF host: the UI calls the `ui_message` command, and the host answers with `host` events (see
//! ui/src/bridge/protocol.ts for both sides). Cached game art is served to the UI over the `shelf` URI scheme.
//!
//! One Shelf runs per user session; it lives in the notification area, counts play time while it runs, and closing
//! the window only hides it (unless that's turned off in Settings).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod host;
mod shell;
mod tray;

use std::sync::Arc;

use tauri::http::{header, Response, StatusCode};
use tauri::{Manager, RunEvent, WindowEvent};

use host::Host;
use shell::SingleInstance;

fn main() {
    // Started at sign-in: stay in the tray. A second copy started by hand brings the running window forward.
    let at_login = std::env::args().any(|a| a.eq_ignore_ascii_case(shell::MINIMIZED_ARG));
    let Some(instance) = SingleInstance::acquire(!at_login) else { return };
    let instance: &'static SingleInstance = Box::leak(Box::new(instance));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![bridge::ui_message])
        .register_uri_scheme_protocol("shelf", |ctx, request| {
            let host = ctx.app_handle().state::<Arc<Host>>();
            let path = request.uri().path();
            let file = path.strip_prefix("/art/").and_then(|rel| host.art_file(rel));
            match file.and_then(|f| std::fs::read(&f).ok().map(|bytes| (f, bytes))) {
                Some((f, bytes)) => Response::builder()
                    .header(header::CONTENT_TYPE, content_type(&f))
                    .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(bytes)
                    .unwrap(),
                None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
            }
        })
        .setup(move |app| {
            let host = Host::new(app.handle().clone())?;
            app.manage(host.clone());
            match tray::create(app.handle()) {
                Ok(t) => {
                    let _ = host.tray.set(t);
                }
                Err(e) => eprintln!("tray icon: {e}"),
            }
            let handle = app.handle().clone();
            instance.listen(move || tray::show_window(&handle));
            host.start();
            if !at_login {
                tray::show_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<Arc<Host>>().close_requested() {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Shelf couldn't start its window");

    app.run(|handle, event| match event {
        // The window is hidden, not gone, while Shelf sits in the tray; only Quit (or close with tray off) ends it.
        RunEvent::ExitRequested { code: None, api, .. } if !handle.state::<Arc<Host>>().closing.load(std::sync::atomic::Ordering::Relaxed) => {
            api.prevent_exit();
        }
        RunEvent::Exit => handle.state::<Arc<Host>>().shutdown(),
        _ => {}
    });
}

fn content_type(path: &std::path::Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}
