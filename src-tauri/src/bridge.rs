//! The UI ↔ host bridge: one command in, one event stream out, carrying the messages in ui/src/bridge/protocol.ts.

use serde::Deserialize;
use serde_json::{json, Value};
use shelf_core::matcher::{self, GameEntry};
use shelf_core::model::SourceResult;
use shelf_core::platform::SystemContext;
use tauri::{Emitter, WebviewWindow};

/// The messages this stage understands; anything else gets an honest "not yet" notice.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum UiMessage {
    Ready,
    Refresh,
    Window { action: String },
    #[serde(other)]
    Other,
}

#[tauri::command]
pub fn ui_message(window: WebviewWindow, message: Value) {
    match serde_json::from_value::<UiMessage>(message) {
        Ok(UiMessage::Ready) => {
            let state = build_state();
            let maximized = window.is_maximized().unwrap_or(false);
            emit(&window, json!({ "type": "hello", "version": env!("CARGO_PKG_VERSION"), "maximized": maximized, "state": state }));
        }
        Ok(UiMessage::Refresh) => emit(&window, json!({ "type": "state", "state": build_state() })),
        Ok(UiMessage::Window { action }) => window_action(&window, &action),
        Ok(UiMessage::Other) | Err(_) => emit(
            &window,
            json!({ "type": "notice", "tone": "info", "text": "That isn't in the Rust build of Shelf yet — it's being ported." }),
        ),
    }
}

fn emit(window: &WebviewWindow, message: Value) {
    let _ = window.emit("host", message);
}

/// Moving and resizing are started by the UI itself (they must begin inside the mouse-down); the rest happens here.
fn window_action(window: &WebviewWindow, action: &str) {
    let _ = match action {
        "minimize" => window.minimize(),
        "maximize" => {
            let max = window.is_maximized().unwrap_or(false);
            let r = if max { window.unmaximize() } else { window.maximize() };
            emit(window, json!({ "type": "window", "maximized": !max }));
            r
        }
        // Closing to the tray arrives with the tray (stage 4); until then both close and quit end the app.
        "close" | "quit" => window.close(),
        _ => Ok(()),
    };
}

/// The whole app state the UI renders. For now: every launcher's games, merged into one entry per game (no database
/// or folder scanning yet), and honest empty values for everything that isn't ported yet.
fn build_state() -> Value {
    let ctx = SystemContext::real();
    let results = shelf_core::sources::read_all(&ctx);
    let now = iso(now_secs());
    // Launcher installs go straight in; Windows' installed apps only when the classifier is confident.
    let installs = results.iter().flat_map(|r| r.installs.iter().cloned()).filter(|i| i.source.is_store() || i.confidence >= 70).collect();
    let games: Vec<Value> = matcher::merge(installs).iter().enumerate().map(|(n, g)| game_view(n as i64 + 1, g, &now)).collect();
    json!({
        "games": games,
        "review": [],
        "sources": results.iter().map(source_view).collect::<Vec<_>>(),
        "leftovers": [],
        "drives": [],
        "scan": { "running": false, "phase": null, "dirs": 0, "path": null, "lastRun": now, "lastSeconds": null, "error": null },
        "settings": {
            "theme": "system", "palette": "sunset", "heroStyle": "wheel",
            "scanRoots": [], "suggestedRoots": [], "drives": [],
            "runtimeDetection": false, "watchFolders": false, "startWithWindows": false, "closeToTray": false,
            "webArt": false, "hasSteamGridDbKey": false, "dataDir": ""
        },
        "playing": [],
        "sessions": [],
        "gaps": [],
        "watch": { "running": false, "gpuCounters": false, "trackingSince": null }
    })
}

fn game_view(id: i64, g: &GameEntry, now: &str) -> Value {
    let mut sources: Vec<_> = g.installs.iter().map(|i| i.source).collect();
    sources.dedup();
    json!({
        "id": id,
        "title": g.title,
        "sources": sources,
        "installed": g.is_installed(),
        "hidden": false,
        "sizeBytes": g.size_bytes(),
        "copies": g.installs.iter().filter(|i| i.is_installed).count(),
        "playSeconds": g.imported_play_seconds(),
        "trackedSeconds": 0,
        "importedSeconds": g.imported_play_seconds(),
        "lastPlayed": g.imported_last_played().map(iso),
        "firstSeen": now,
        "path": g.primary().install_path,
        "canLaunch": false,
        "genres": [],
        "year": null,
        "coverUrl": null, "heroUrl": null, "logoUrl": null, "iconUrl": null
    })
}

fn source_view(r: &SourceResult) -> Value {
    json!({
        "source": r.source,
        "name": r.source.display_name(),
        "state": r.state,
        "message": r.message,
        "count": r.installs.len()
    })
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Unix seconds → `2026-10-21T12:34:56Z` (UTC), without pulling in a date library for one format.
fn iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::iso;

    #[test]
    fn iso_dates() {
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_710_000_000), "2024-03-09T16:00:00Z");
    }
}
