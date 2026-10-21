//! Shelf's desktop app on Tauri. The React UI (ui/) talks to this host with the same messages it used with the old
//! WPF host: the UI calls the `ui_message` command, and the host answers with `host` events (see
//! ui/src/bridge/protocol.ts for both sides). Cached game art is served to the UI over the `shelf` URI scheme.
//!
//! Stage 3 of the Rust port: the library database, scans, art and every UI command. Playtime tracking, the tray and
//! start-with-Windows come in stage 4.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod host;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::http::{header, Response, StatusCode};
use tauri::{Manager, RunEvent};

use host::Host;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        .setup(|app| {
            let host = Host::new(app.handle().clone())?;
            app.manage(host.clone());
            host.start();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Shelf couldn't start its window");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let host = handle.state::<Arc<Host>>();
            host.closing.store(true, Ordering::Relaxed);
            host.cancel_scan();
        }
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
