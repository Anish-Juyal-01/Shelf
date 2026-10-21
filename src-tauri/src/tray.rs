//! Notification-area icon: open, what's playing, refresh, quit. Left click opens Shelf.

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::host::Host;

pub struct Tray {
    icon: TrayIcon,
    playing: MenuItem<Wry>,
}

pub fn create(app: &AppHandle) -> tauri::Result<Tray> {
    let open = MenuItem::with_id(app, "open", "Open Shelf", true, None::<&str>)?;
    let playing = MenuItem::with_id(app, "playing", "Not playing anything", false, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh library", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Shelf (stops tracking)", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &playing, &PredefinedMenuItem::separator(app)?, &refresh, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id("shelf").tooltip("Shelf · tracking playtime").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let icon = builder
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_window(app),
            "refresh" => app.state::<Arc<Host>>().refresh_all(false),
            "quit" => app.state::<Arc<Host>>().quit(),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(Tray { icon, playing })
}

impl Tray {
    /// Tooltip and menu line: what's being played right now.
    pub fn set_playing(&self, titles: &[String]) {
        let list = titles.join(", ");
        let tip = if titles.is_empty() { "Shelf · tracking playtime".to_string() } else { format!("Shelf · playing {list}") };
        let _ = self.icon.set_tooltip(Some(tip.chars().take(127).collect::<String>()));
        let _ = self.playing.set_text(if titles.is_empty() { "Not playing anything".to_string() } else { format!("Playing: {list}") });
    }
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
