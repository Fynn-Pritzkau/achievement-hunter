//! Read-only access to the data the Steam client keeps on disk.
//!
//! Nothing here writes to Steam's folders, talks to the Steam client or touches
//! a game process. Only plain cache/config files are read:
//! - `appcache/stats/UserGameStatsSchema_<appid>.bin`  achievement list (binary KeyValues)
//! - `appcache/stats/UserGameStats_<account>_<appid>.bin`  the user's unlocks (binary KeyValues)
//! - `userdata/<account>/config/localconfig.vdf`  playtime and last played (text KeyValues)
//!
//! Every file is read, parsed and dropped within one call, so memory use stays at
//! the size of a single file. Values borrow from the file buffer instead of copying.

use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    time::UNIX_EPOCH,
};

// ---------- Binary KeyValues ----------

enum Kv<'a> {
    Section(Vec<(&'a str, Kv<'a>)>),
    Str(&'a str),
    Int(i64),
    Float(f32),
    Other,
}

fn cstr<'a>(b: &'a [u8], p: &mut usize) -> Option<&'a str> {
    let len = b.get(*p..)?.iter().position(|&c| c == 0)?;
    let s = std::str::from_utf8(&b[*p..*p + len]).unwrap_or("");
    *p += len + 1;
    Some(s)
}

fn take<const N: usize>(b: &[u8], p: &mut usize) -> Option<[u8; N]> {
    let v = b.get(*p..*p + N)?.try_into().ok()?;
    *p += N;
    Some(v)
}

/// Parses entries until the section's end marker. The root may also end at EOF;
/// a nested section cut off by EOF (file being written) fails the whole parse.
fn section<'a>(b: &'a [u8], p: &mut usize, root: bool) -> Option<Vec<(&'a str, Kv<'a>)>> {
    let mut out = Vec::new();
    loop {
        let Some(&t) = b.get(*p) else {
            return root.then_some(out);
        };
        *p += 1;
        if t == 0x08 || t == 0x0b {
            return Some(out);
        }
        let name = cstr(b, p)?;
        let v = match t {
            0x00 => Kv::Section(section(b, p, false)?),
            0x01 => Kv::Str(cstr(b, p)?),
            0x02 => Kv::Int(i32::from_le_bytes(take::<4>(b, p)?) as i64),
            0x03 => Kv::Float(f32::from_le_bytes(take::<4>(b, p)?)),
            0x04 | 0x06 => {
                take::<4>(b, p)?;
                Kv::Other
            }
            0x07 => Kv::Int(u64::from_le_bytes(take::<8>(b, p)?) as i64),
            0x0a => Kv::Int(i64::from_le_bytes(take::<8>(b, p)?)),
            _ => return None,
        };
        out.push((name, v));
    }
}

fn get<'a, 'b>(s: &'b [(&'a str, Kv<'a>)], key: &str) -> Option<&'b Kv<'a>> {
    s.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v)
}

fn sec<'a, 'b>(v: Option<&'b Kv<'a>>) -> &'b [(&'a str, Kv<'a>)] {
    match v {
        Some(Kv::Section(s)) => s,
        _ => &[],
    }
}

fn int(v: Option<&Kv>) -> Option<i64> {
    match v? {
        Kv::Int(i) => Some(*i),
        Kv::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn num(v: Option<&Kv>) -> Option<f64> {
    match v? {
        Kv::Int(i) => Some(*i as f64),
        Kv::Float(f) => Some(*f as f64),
        Kv::Str(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn text<'a>(v: Option<&Kv<'a>>) -> &'a str {
    match v {
        Some(Kv::Str(s)) => s,
        _ => "",
    }
}

/// A display string is either plain text or a section of languages.
/// Returns the text and whether it was in the requested language.
fn localized<'a>(v: Option<&Kv<'a>>, lang: &str) -> (&'a str, bool) {
    match v {
        Some(Kv::Str(s)) => (s, false),
        Some(Kv::Section(langs)) => {
            if let Some(Kv::Str(s)) = get(langs, lang) {
                if !s.is_empty() {
                    return (s, true);
                }
            }
            let fallback = text(get(langs, "english"));
            if !fallback.is_empty() {
                return (fallback, false);
            }
            let any = langs
                .iter()
                .find_map(|(k, v)| match v {
                    Kv::Str(s) if !k.eq_ignore_ascii_case("token") && !s.is_empty() => Some(*s),
                    _ => None,
                })
                .unwrap_or("");
            (any, false)
        }
        _ => ("", false),
    }
}

// ---------- Paths ----------

fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(p) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Valve\Steam")
            .and_then(|k| k.get_value::<String, _>("SteamPath"))
        {
            let p = PathBuf::from(p);
            if p.is_dir() {
                return Some(p);
            }
        }
        let p = PathBuf::from(r"C:\Program Files (x86)\Steam");
        p.is_dir().then_some(p)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn mtime_secs(m: &fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

// ---------- Commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAchievement {
    apiname: String,
    name: String,
    description: String,
    hidden: bool,
    /// File names on Steam's CDN, e.g. "abc123.jpg".
    icon: String,
    icongray: String,
    achieved: bool,
    unlocktime: i64,
    /// How far an open achievement is, for those Steam tracks with a stat ("37 / 50").
    progress: Option<Progress>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Progress {
    current: f64,
    max: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGame {
    /// Unix seconds when Steam last wrote the schema file.
    schema_mtime: u64,
    /// Unix seconds when Steam last wrote the user's stats, None = no stats file.
    stats_mtime: Option<u64>,
    /// True when names and descriptions are in the requested language.
    language_match: bool,
    achievements: Vec<LocalAchievement>,
}

/// Achievements of one game from Steam's local cache. None = Steam has no schema file for it.
#[tauri::command]
pub fn local_achievements(account_id: u32, appid: u32, language: String) -> Option<LocalGame> {
    let dir = steam_root()?.join("appcache").join("stats");
    let schema_path = dir.join(format!("UserGameStatsSchema_{appid}.bin"));
    let schema_mtime = mtime_secs(&fs::metadata(&schema_path).ok()?);
    let schema_buf = fs::read(&schema_path).ok()?;

    let stats_path = dir.join(format!("UserGameStats_{account_id}_{appid}.bin"));
    let stats_mtime = fs::metadata(&stats_path).ok().map(|m| mtime_secs(&m));
    let stats_buf = stats_mtime.and_then(|_| fs::read(&stats_path).ok());

    let (language_match, achievements) = parse_game(&schema_buf, stats_buf.as_deref(), appid, &language)?;
    Some(LocalGame { schema_mtime, stats_mtime, language_match, achievements })
}

/// Parses the schema and (if present) the user's stats file of one game.
/// Returns whether names were in `language`, and the achievements. None = a file is unreadable.
fn parse_game(schema_buf: &[u8], stats_buf: Option<&[u8]>, appid: u32, language: &str) -> Option<(bool, Vec<LocalAchievement>)> {
    let schema_root = section(schema_buf, &mut 0, true)?;
    let stats_root = match stats_buf {
        Some(b) => Some(section(b, &mut 0, true)?),
        None => None,
    };
    let stats = stats_root.as_deref().map(|r| sec(get(r, "cache")));

    // Root holds one section named after the appid.
    let game = sec(get(&schema_root, &appid.to_string()).or_else(|| schema_root.first().map(|(_, v)| v)));
    let mut stat_ids: Vec<(u32, &[(&str, Kv)])> = sec(get(game, "stats"))
        .iter()
        .filter_map(|(k, v)| Some((k.parse().ok()?, sec(Some(v)))))
        .collect();
    stat_ids.sort_by_key(|(id, _)| *id);

    // Plain stats (no achievement bits) by name, for progress. Steam leaves out stats still at 0.
    let values: Option<HashMap<&str, f64>> = stats.map(|s| {
        stat_ids
            .iter()
            .filter(|(_, stat)| sec(get(stat, "bits")).is_empty())
            .filter_map(|(id, stat)| {
                let name = text(get(stat, "name"));
                (!name.is_empty()).then(|| (name, num(get(sec(get(s, &id.to_string())), "data")).unwrap_or(0.0)))
            })
            .collect()
    });

    let mut language_match = false;
    let mut achievements = Vec::new();
    for (stat_id, stat) in stat_ids.iter().copied() {
        let bits = sec(get(stat, "bits"));
        if bits.is_empty() {
            continue;
        }
        let user_stat = stats.map(|s| sec(get(s, &stat_id.to_string())));
        let data = user_stat.and_then(|s| int(get(s, "data"))).unwrap_or(0) as u32;
        let times = user_stat.map(|s| sec(get(s, "AchievementTimes"))).unwrap_or(&[]);

        let mut bit_list: Vec<(u32, &[(&str, Kv)])> = bits
            .iter()
            .filter_map(|(k, v)| Some((k.parse().ok()?, sec(Some(v)))))
            .collect();
        bit_list.sort_by_key(|(b, _)| *b);
        for (bit, a) in bit_list {
            let apiname = text(get(a, "name"));
            if apiname.is_empty() || bit > 31 {
                continue;
            }
            let display = sec(get(a, "display"));
            let (name, matched) = localized(get(display, "name"), language);
            let (description, _) = localized(get(display, "desc"), language);
            language_match |= matched;
            let hidden = int(get(display, "hidden")).or_else(|| int(get(a, "hidden"))).unwrap_or(0) != 0;
            let achieved = data & (1 << bit) != 0;
            let field = |k: &str| {
                let v = text(get(display, k));
                if v.is_empty() { text(get(a, k)) } else { v }
            };
            achievements.push(LocalAchievement {
                apiname: apiname.to_owned(),
                name: if name.is_empty() { apiname } else { name }.to_owned(),
                description: description.to_owned(),
                hidden,
                icon: field("icon").to_owned(),
                icongray: field("icon_gray").to_owned(),
                achieved,
                unlocktime: if achieved { int(get(times, &bit.to_string())).unwrap_or(0) } else { 0 },
                progress: if achieved { None } else { values.as_ref().and_then(|v| progress(a, v)) },
            });
        }
    }

    Some((language_match, achievements))
}

/// `bits/<bit>/progress`: the stat a "collect 50" achievement counts, shifted by `min_val`.
/// Only the plain "statvalue" operation is understood; anything else is left out.
fn progress(bit: &[(&str, Kv)], values: &HashMap<&str, f64>) -> Option<Progress> {
    let p = sec(get(bit, "progress"));
    let value = sec(get(p, "value"));
    if !text(get(value, "operation")).eq_ignore_ascii_case("statvalue") {
        return None;
    }
    let min = num(get(p, "min_val")).unwrap_or(0.0);
    let max = num(get(p, "max_val"))? - min;
    if max <= 0.0 {
        return None;
    }
    let stat = values.get(text(get(value, "operand1")))?;
    Some(Progress { current: (stat - min).clamp(0.0, max), max })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaytime {
    appid: u32,
    /// Minutes.
    playtime: u32,
    /// Unix seconds.
    last_played: u32,
}

/// Playtime and last-played time per app from localconfig.vdf.
/// Streams the file line by line and keeps only the `Software/Valve/Steam/apps/<appid>` values.
#[tauri::command]
pub fn local_playtimes(account_id: u32) -> Vec<LocalPlaytime> {
    let Some(root) = steam_root() else { return Vec::new() };
    let path = root.join("userdata").join(account_id.to_string()).join("config").join("localconfig.vdf");
    let Ok(file) = fs::File::open(path) else { return Vec::new() };

    const APPS_PATH: [&str; 5] = ["userlocalconfigstore", "software", "valve", "steam", "apps"];
    let mut stack: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;
    let mut out: Vec<LocalPlaytime> = Vec::new();
    let mut line = String::new();
    let mut reader = BufReader::new(file);

    let in_apps = |stack: &[String]| {
        stack.len() == 6 && stack[..5].iter().zip(APPS_PATH).all(|(a, b)| a.eq_ignore_ascii_case(b))
    };

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let l = line.trim();
        if l == "{" {
            stack.push(pending.take().unwrap_or_default());
            if in_apps(&stack) {
                if let Ok(appid) = stack[5].parse() {
                    out.push(LocalPlaytime { appid, playtime: 0, last_played: 0 });
                }
            }
            continue;
        }
        if l == "}" {
            stack.pop();
            continue;
        }
        // "key" or "key"  "value"
        let mut parts = l.split('"').skip(1).step_by(2);
        let (Some(key), value) = (parts.next(), parts.next()) else { continue };
        match value {
            None => pending = Some(key.to_owned()),
            Some(v) if in_apps(&stack) => {
                if let Some(entry) = out.last_mut().filter(|e| stack[5] == e.appid.to_string()) {
                    if key.eq_ignore_ascii_case("Playtime") {
                        entry.playtime = v.parse().unwrap_or(0);
                    } else if key.eq_ignore_ascii_case("LastPlayed") {
                        entry.last_played = v.parse().unwrap_or(0);
                    }
                }
            }
            Some(_) => {}
        }
    }
    out.retain(|e| e.playtime > 0 || e.last_played > 0);
    out
}

/// AppIDs whose stats file Steam wrote after `since` (unix seconds).
/// One directory listing, no file is opened — cheap enough to run every few seconds.
#[tauri::command]
pub fn local_stats_changed(account_id: u32, since: u64) -> Vec<u32> {
    let Some(root) = steam_root() else { return Vec::new() };
    let Ok(dir) = fs::read_dir(root.join("appcache").join("stats")) else { return Vec::new() };
    let prefix = format!("UserGameStats_{account_id}_");
    dir.flatten()
        .filter_map(|e| {
            let name = e.file_name();
            let appid = name.to_str()?.strip_prefix(&prefix)?.strip_suffix(".bin")?.parse().ok()?;
            (mtime_secs(&e.metadata().ok()?) > since).then_some(appid)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(out: &mut Vec<u8>, t: u8, k: &str) {
        out.push(t);
        out.extend_from_slice(k.as_bytes());
        out.push(0);
    }

    #[test]
    fn parses_binary_keyvalues() {
        // { "cache" { "12" { "data" 0b101  "AchievementTimes" { "0" 1700000000 } } } }
        let mut b = Vec::new();
        s(&mut b, 0x00, "cache");
        s(&mut b, 0x00, "12");
        s(&mut b, 0x02, "data");
        b.extend_from_slice(&5i32.to_le_bytes());
        s(&mut b, 0x00, "AchievementTimes");
        s(&mut b, 0x02, "0");
        b.extend_from_slice(&1_700_000_000i32.to_le_bytes());
        b.extend_from_slice(&[0x08, 0x08, 0x08, 0x08]);

        let root = section(&b, &mut 0, true).unwrap();
        let stat = sec(get(sec(get(&root, "cache")), "12"));
        assert_eq!(int(get(stat, "data")), Some(5));
        assert_eq!(int(get(sec(get(stat, "achievementtimes")), "0")), Some(1_700_000_000));
    }

    #[test]
    fn rejects_truncated_sections() {
        let mut b = Vec::new();
        s(&mut b, 0x00, "cache");
        s(&mut b, 0x02, "data");
        b.extend_from_slice(&[1, 0]); // cut off mid-value
        assert!(section(&b, &mut 0, true).is_none());
    }

    fn put_str(b: &mut Vec<u8>, k: &str, v: &str) {
        s(b, 0x01, k);
        b.extend_from_slice(v.as_bytes());
        b.push(0);
    }

    fn put_int(b: &mut Vec<u8>, k: &str, v: i32) {
        s(b, 0x02, k);
        b.extend_from_slice(&v.to_le_bytes());
    }

    /// An achievement bit counting `stat` from `min` to `max` with the given operation.
    fn put_bit(b: &mut Vec<u8>, bit: &str, name: &str, op: &str, stat: &str, min: &str, max: &str) {
        s(b, 0x00, bit);
        put_str(b, "name", name);
        s(b, 0x00, "progress");
        s(b, 0x00, "value");
        put_str(b, "operation", op);
        put_str(b, "operand1", stat);
        b.push(0x08);
        put_str(b, "min_val", min);
        put_str(b, "max_val", max);
        b.extend_from_slice(&[0x08, 0x08]);
    }

    /// Schema: stats 1 = "kills" (int), 2 = "distance" (float), 3 = "unused",
    /// 10 = achievement bits counting them.
    fn schema() -> Vec<u8> {
        let mut b = Vec::new();
        s(&mut b, 0x00, "5");
        s(&mut b, 0x00, "stats");
        for (id, name) in [("1", "kills"), ("2", "distance"), ("3", "unused")] {
            s(&mut b, 0x00, id);
            put_str(&mut b, "name", name);
            b.push(0x08);
        }
        s(&mut b, 0x00, "10");
        s(&mut b, 0x00, "bits");
        put_bit(&mut b, "0", "KILL_50", "statvalue", "kills", "0", "50");
        put_bit(&mut b, "1", "WALK_10", "statvalue", "distance", "0", "10");
        put_bit(&mut b, "2", "UNUSED_5", "statvalue", "unused", "0", "5");
        put_bit(&mut b, "3", "ODD", "somethingelse", "kills", "0", "50");
        put_bit(&mut b, "4", "DONE", "statvalue", "kills", "10", "20");
        b.extend_from_slice(&[0x08, 0x08, 0x08, 0x08, 0x08]);
        b
    }

    /// User stats: kills 37, distance 2.5, nothing for "unused", bit 4 unlocked.
    fn stats() -> Vec<u8> {
        let mut b = Vec::new();
        s(&mut b, 0x00, "cache");
        s(&mut b, 0x00, "1");
        put_int(&mut b, "data", 37);
        b.push(0x08);
        s(&mut b, 0x00, "2");
        s(&mut b, 0x03, "data");
        b.extend_from_slice(&2.5f32.to_le_bytes());
        b.push(0x08);
        s(&mut b, 0x00, "10");
        put_int(&mut b, "data", 1 << 4);
        b.extend_from_slice(&[0x08, 0x08]);
        b
    }

    #[test]
    fn reads_progress_of_stat_achievements() {
        let (_, list) = parse_game(&schema(), Some(&stats()), 5, "english").unwrap();
        let by = |n: &str| list.iter().find(|a| a.apiname == n).unwrap();
        assert_eq!(by("KILL_50").progress, Some(Progress { current: 37.0, max: 50.0 }));
        assert_eq!(by("WALK_10").progress, Some(Progress { current: 2.5, max: 10.0 }));
        // Steam leaves out stats that are still 0.
        assert_eq!(by("UNUSED_5").progress, Some(Progress { current: 0.0, max: 5.0 }));
        assert_eq!(by("ODD").progress, None);
        assert!(by("DONE").achieved);
        assert_eq!(by("DONE").progress, None);
        // Plain stats are not achievements.
        assert_eq!(list.len(), 5);
    }

    #[test]
    fn no_progress_without_stats_file() {
        let (_, list) = parse_game(&schema(), None, 5, "english").unwrap();
        assert!(list.iter().all(|a| a.progress.is_none() && !a.achieved));
    }

    #[test]
    fn picks_language_with_fallback() {
        let langs = vec![("english", Kv::Str("Hi")), ("german", Kv::Str("Hallo")), ("token", Kv::Str("T"))];
        let v = Kv::Section(langs);
        assert_eq!(localized(Some(&v), "german"), ("Hallo", true));
        assert_eq!(localized(Some(&v), "french"), ("Hi", false));
    }
}
