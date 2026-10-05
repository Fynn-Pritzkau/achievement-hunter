use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent, Wry,
};

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
        .invoke_handler(tauri::generate_handler![
            get_secret,
            set_secret,
            running_app_ids,
            set_tray_labels,
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
        // Closing the window keeps the app in the tray so syncing and live tracking continue.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
