//! Diagnostics: a small rotating log file, a panic hook that writes to it, system info for bug
//! reports, and saving backups to the Downloads folder. No logging crate: a log line is rare.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The log rotates to `<name>.1.log` at this size, so at most twice this stays on disk.
const MAX_LOG_BYTES: u64 = 256 * 1024;
/// How much of the log `read_log` returns (the newest part).
const READ_LOG_BYTES: usize = 64 * 1024;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

/// Sets up the log file in the app's log directory and logs panics there.
/// Release builds abort on panic, so the hook is the only trace a crash leaves.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = LOG_PATH.set(dir.join("achievement-hunter.log"));
    }
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown".into());
        append("PANIC", &format!("{msg}{at}"));
        default(info);
    }));
}

fn timestamp() -> String {
    format_time(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

/// "2026-10-07 12:34:56Z" from Unix seconds, without a date crate.
fn format_time(secs: u64) -> String {
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn rotated(path: &Path) -> PathBuf {
    path.with_extension("1.log")
}

pub fn append(level: &str, message: &str) {
    let Some(path) = LOG_PATH.get() else { return };
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if fs::metadata(path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(path, rotated(path));
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        // One entry per line, so a multi-line message can't fake entries.
        let _ = writeln!(f, "{} {level} {}", timestamp(), message.replace(['\r', '\n'], " ⏎ "));
    }
}

/// The UI logs through this. It redacts secrets itself before sending.
#[tauri::command]
pub fn write_log(level: String, message: String) {
    let level = match level.as_str() {
        "info" => "INFO",
        "warn" => "WARN",
        _ => "ERROR",
    };
    append(level, &message);
}

/// The newest part of the log (previous file first), for the diagnostics the user copies.
#[tauri::command]
pub fn read_log() -> String {
    let Some(path) = LOG_PATH.get() else { return String::new() };
    let _guard = LOG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let text = [rotated(path), path.clone()]
        .iter()
        .filter_map(|p| fs::read(p).ok())
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .collect::<String>();
    match text.len().checked_sub(READ_LOG_BYTES) {
        Some(cut) => {
            // Start at a full line (and a char boundary).
            let start = text[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
            text[start..].to_string()
        }
        None => text,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    os: String,
    steam_installed: bool,
}

/// Windows version and whether a Steam client is installed, for bug reports. Registry only.
#[tauri::command]
pub fn system_info() -> SystemInfo {
    #[cfg(windows)]
    {
        use winreg::{enums::*, RegKey};
        let os = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .map(|k| {
                let build: String = k.get_value("CurrentBuildNumber").unwrap_or_default();
                let display: String = k.get_value("DisplayVersion").unwrap_or_default();
                // Windows 11 still says "Windows 10" in ProductName; the build tells them apart.
                let name = if build.parse::<u32>().unwrap_or(0) >= 22_000 { "Windows 11" } else { "Windows 10" };
                format!("{name} {display} (build {build})")
            })
            .unwrap_or_else(|_| "Windows".into());
        let steam_installed = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
            .is_ok();
        SystemInfo { os, steam_installed }
    }
    #[cfg(not(windows))]
    {
        SystemInfo { os: std::env::consts::OS.into(), steam_installed: false }
    }
}

/// Writes a backup to the Downloads folder and returns its path. Never overwrites a file:
/// `name.json` becomes `name (2).json` and so on.
#[tauri::command]
pub fn save_backup(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let name = name.replace(['/', '\\', ':'], "_");
    let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, "json"));
    for n in 1..100 {
        let file = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem} ({n}).{ext}") };
        let path = dir.join(file);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many backups with the same name".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_dates() {
        assert_eq!(format_time(0), "1970-01-01 00:00:00Z");
        assert_eq!(format_time(951_782_400), "2000-02-29 00:00:00Z");
        assert_eq!(format_time(1_791_394_805), "2026-10-07 17:40:05Z");
    }
}
