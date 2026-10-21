//! The UI ↔ host bridge: one command in, one event stream out, carrying the messages in ui/src/bridge/protocol.ts.

use std::sync::Arc;

use serde_json::{json, Value};
use tauri::{Emitter, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::host::Host;

/// Every message the UI sends. Anything slow runs off the main thread, so the window never stalls.
#[tauri::command]
pub fn ui_message(window: WebviewWindow, host: State<'_, Arc<Host>>, message: Value) {
    let host = host.inner().clone();
    let kind = message["type"].as_str().unwrap_or_default().to_string();
    if kind == "window" {
        window_action(&window, message["action"].as_str().unwrap_or_default());
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    std::thread::spawn(move || handle(&host, &kind, &message, maximized));
}

fn id(m: &Value, key: &str) -> Option<i64> {
    m[key].as_i64()
}

fn text<'a>(m: &'a Value, key: &str) -> Option<&'a str> {
    m[key].as_str()
}

fn handle(host: &Arc<Host>, kind: &str, m: &Value, maximized: bool) {
    match kind {
        "ready" => host.hello(maximized),
        "getGame" => id(m, "id").into_iter().for_each(|g| host.get_game(g)),
        "launch" => id(m, "gameId").into_iter().for_each(|g| host.launch(g)),
        "openFolder" => text(m, "path").into_iter().for_each(|p| host.open_folder(p)),
        "reveal" => text(m, "path").into_iter().for_each(|p| host.reveal(p)),
        "uninstall" => id(m, "installId").into_iter().for_each(|i| host.uninstall(i)),
        "setHidden" => {
            if let (Some(g), Some(h)) = (id(m, "gameId"), m["hidden"].as_bool()) {
                host.set_hidden(g, h);
            }
        }
        "rename" => {
            if let (Some(g), Some(t)) = (id(m, "gameId"), text(m, "title")) {
                host.rename(g, t);
            }
        }
        "accept" => id(m, "id").into_iter().for_each(|d| host.accept(d, text(m, "title"))),
        "reject" => id(m, "id").into_iter().for_each(|d| host.reject(d)),
        "addExe" => {
            let picked = host_app(host).dialog().file().set_title("Pick the game's .exe").add_filter("Programs", &["exe"]).blocking_pick_file();
            if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
                host.add_paths(vec![path.to_string_lossy().into_owned()]);
            }
        }
        // Real paths of files dropped on the window (Tauri's drag-drop event, forwarded by the UI bridge).
        "dropPaths" => {
            let paths: Vec<String> = m["paths"].as_array().into_iter().flatten().filter_map(|p| p.as_str().map(String::from)).collect();
            if !paths.is_empty() {
                host.add_paths(paths);
            }
        }
        "refresh" => host.refresh_all(false),
        "cancelScan" => host.cancel_scan(),
        "addRoot" => {
            let picked = host_app(host).dialog().file().set_title("Pick a folder where you keep games").blocking_pick_folder();
            if let Some(path) = picked.and_then(|p| p.into_path().ok()) {
                host.add_root(&path.to_string_lossy());
            }
        }
        "addRootPath" => text(m, "path").into_iter().for_each(|p| host.add_root(p)),
        "removeRoot" => text(m, "path").into_iter().for_each(|p| host.remove_root(p)),
        "scanDrive" => text(m, "root").into_iter().for_each(|r| host.scan_once(r.to_string())),
        "updateSettings" => host.update_settings(&m["patch"]),
        "openDataFolder" => host.open_data_folder(),
        _ => {}
    }
}

fn host_app(host: &Host) -> &tauri::AppHandle {
    host.app()
}

/// Moving and resizing are started by the UI itself (they must begin inside the mouse-down); the rest happens here.
fn window_action(window: &WebviewWindow, action: &str) {
    let _ = match action {
        "minimize" => window.minimize(),
        "maximize" => {
            let max = window.is_maximized().unwrap_or(false);
            let r = if max { window.unmaximize() } else { window.maximize() };
            let _ = window.emit("host", json!({ "type": "window", "maximized": !max }));
            r
        }
        // Closing to the tray arrives with the tray (stage 4); until then both close and quit end the app.
        "close" | "quit" => window.close(),
        _ => Ok(()),
    };
}
