use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod steam_local;

const KEYRING_SERVICE: &str = "achievement-hunter";

/// Reads a secret (the Steam API key) from the Windows Credential Manager.
#[tauri::command]
fn get_secret(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_secret(name: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// AppIDs of all games the Steam client is running right now (several when idling games side by side).
/// Steam keeps a `Running` flag per app in the registry, so checking it costs no API call.
/// `RunningAppID` only holds one game, so it is merely a fallback.
#[tauri::command]
fn running_app_ids() -> Vec<u32> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let Ok(steam) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") else {
            return Vec::new();
        };
        let mut ids: Vec<u32> = steam
            .open_subkey("Apps")
            .map(|apps| {
                apps.enum_keys()
                    .flatten()
                    .filter_map(|name| {
                        let running = apps.open_subkey(&name).ok()?.get_value::<u32, _>("Running").ok()?;
                        (running != 0).then(|| name.parse().ok()).flatten()
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Ok(id) = steam.get_value::<u32, _>("RunningAppID") {
            if id != 0 && !ids.contains(&id) {
                ids.push(id);
            }
        }
        ids.sort_unstable();
        ids
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Tray menu entries, kept so the UI can relabel them when the language changes.
struct TrayItems {
    open: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[tauri::command]
fn set_tray_labels(items: State<'_, TrayItems>, open: String, quit: String) -> Result<(), String> {
    items.open.set_text(open).map_err(|e| e.to_string())?;
    items.quit.set_text(quit).map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

const OVERLAY: &str = "overlay";
/// Logical size of the overlay window; the card inside sticks to the chosen corner, the rest stays transparent.
const OVERLAY_SIZE: (f64, f64) = (360.0, 520.0);
const OVERLAY_MARGIN: f64 = 16.0;

struct OverlayState {
    /// Screen corner: "tl", "tr", "bl" or "br".
    corner: String,
    /// The window is the short progress popup, not the overlay the user opened.
    toast: bool,
}

struct Overlay(Mutex<OverlayState>);

/// (Re)binds the global overlay hotkey. None or empty unbinds it.
#[tauri::command]
fn set_overlay_hotkey(
    app: AppHandle,
    state: State<'_, Overlay>,
    hotkey: Option<String>,
    corner: String,
) -> Result<(), String> {
    state.0.lock().unwrap().corner = corner;
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(|e| e.to_string())?;
    match hotkey.as_deref().map(str::trim) {
        Some(h) if !h.is_empty() => shortcuts.register(h).map_err(|e| e.to_string()),
        _ => Ok(()),
    }
}

/// Opens the overlay as a short popup. False when it is already open (then the UI just updates it).
/// Async on purpose: creating a window in a synchronous command deadlocks the app on Windows.
#[tauri::command]
async fn open_overlay_toast(app: AppHandle, state: State<'_, Overlay>) -> Result<bool, String> {
    if app.get_webview_window(OVERLAY).is_some() {
        return Ok(false);
    }
    state.0.lock().unwrap().toast = true;
    open_overlay(&app).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Closes the popup, unless the user turned it into the full overlay with the hotkey meanwhile.
#[tauri::command]
async fn close_overlay_toast(app: AppHandle, state: State<'_, Overlay>) -> Result<(), String> {
    if state.0.lock().unwrap().toast {
        if let Some(w) = app.get_webview_window(OVERLAY) {
            let _ = w.destroy();
        }
    }
    Ok(())
}

/// The overlay only exists while it is visible, so a closed overlay costs no memory.
fn toggle_overlay(app: &AppHandle) {
    let state = app.state::<Overlay>();
    let was_toast = std::mem::replace(&mut state.0.lock().unwrap().toast, false);
    if let Some(w) = app.get_webview_window(OVERLAY) {
        if was_toast {
            // The hotkey during a popup keeps it open as the full overlay.
            let _ = app.emit_to("main", "overlay:full", ());
        } else {
            let _ = w.destroy();
        }
    } else if let Err(e) = open_overlay(app) {
        eprintln!("overlay: {e}");
    }
}

/// A transparent, click-through window on top of the game. A plain window, nothing injected,
/// so it shows over windowed and borderless games but not over exclusive fullscreen.
fn open_overlay(app: &AppHandle) -> tauri::Result<()> {
    let corner = app.state::<Overlay>().0.lock().unwrap().corner.clone();
    let w = WebviewWindowBuilder::new(app, OVERLAY, WebviewUrl::App("overlay.html".into()))
        .title("Achievement Hunter Overlay")
        .inner_size(OVERLAY_SIZE.0, OVERLAY_SIZE.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()?;
    // The monitor the game is on is usually the one under the cursor.
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let area = m.work_area();
        let scale = m.scale_factor();
        let (w_px, h_px) = (OVERLAY_SIZE.0 * scale, OVERLAY_SIZE.1 * scale);
        let margin = OVERLAY_MARGIN * scale;
        let (ax, ay) = (area.position.x as f64, area.position.y as f64);
        let (aw, ah) = (area.size.width as f64, area.size.height as f64);
        let x = if corner.ends_with('l') { ax + margin } else { ax + aw - w_px - margin };
        let y = if corner.starts_with('b') { ay + ah - h_px - margin } else { ay + margin };
        w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))?;
    }
    w.set_ignore_cursor_events(true)?;
    w.show()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Creating a window inside an event handler deadlocks on Windows: do it off the main thread.
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { toggle_overlay(&app) });
                    }
                })
                .build(),
        )
        .manage(Overlay(Mutex::new(OverlayState { corner: "tr".into(), toast: false })))
        .invoke_handler(tauri::generate_handler![
            get_secret,
            set_secret,
            running_app_ids,
            set_tray_labels,
            set_overlay_hotkey,
            open_overlay_toast,
            close_overlay_toast,
            steam_local::local_achievements,
            steam_local::local_playtimes,
            steam_local::local_stats_changed
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Achievement Hunter")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            app.manage(TrayItems { open, quit });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window keeps the app in the tray so syncing and live tracking continue.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // Tells the main window to stop sending overlay updates.
            WindowEvent::Destroyed if window.label() == OVERLAY => {
                window.app_handle().state::<Overlay>().0.lock().unwrap().toast = false;
                let _ = window.app_handle().emit_to("main", "overlay:closed", ());
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
