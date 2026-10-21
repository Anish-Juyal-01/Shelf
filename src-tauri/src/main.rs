//! Shelf's desktop app on Tauri. The React UI (ui/) talks to this host with the same messages it used with the old
//! WPF host: the UI calls the `ui_message` command, and the host answers with `host` events (see
//! ui/src/bridge/protocol.ts for both sides).
//!
//! Stage 1 of the Rust port: the window, the bridge, and a library read straight from the launchers ported so far
//! (Steam, Epic). The database, playtime tracking, folder scanning and the tray come in the next stages.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![bridge::ui_message])
        .run(tauri::generate_context!())
        .expect("Shelf couldn't start its window");
}
