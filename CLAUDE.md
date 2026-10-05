# Achievement Hunter: Kontext für die Weiterentwicklung

Das [README](README.md) (Englisch) richtet sich an Nutzer: Download, Einrichtung, Features. Hier steht alles, was man beim Ändern wissen muss.

Befehle: `npm run tauri dev` (App), `npm run dev` (nur UI im Browser, Steam über Vite-Proxy, Daten in localStorage), `npm test`, `npm run check`, `npm run tauri build` (NSIS-Installer), `npm run release`.

## Projekt
- Windows-Desktop-App, Tauri 2 (Rust) + Svelte 5 (Runes) + TypeScript, SQLite über `tauri-plugin-sql`. UI-Texte auf Deutsch, Code und Kommentare auf Englisch.
- Ziel: **wenig RAM, wenige Steam-API-Calls.** Keine schweren Abhängigkeiten, keine Hintergrund-Threads ohne Grund, nichts dauerhaft im Speicher halten, was in SQLite liegt.
- Repo: `Fynn-Pritzkau/achievement-hunter` (öffentlich). Aktuelle Version siehe `package.json`.

## Datenfluss
- `SteamApi` (`src/lib/steam/api.ts`): Web-API mit Limiter (3 parallel, 120 ms Abstand) und Retry. `isFatal` (auth, private, rate) bricht den Lauf ab.
- `LocalSteam` (`src/lib/steam/local.ts`) → Rust `src-tauri/src/steam_local.rs`: liest Steams Cache **nur lesend**:
  - `appcache/stats/UserGameStatsSchema_<appid>.bin` und `UserGameStats_<accountId>_<appid>.bin`: binäre KeyValues. Achievements stehen unter `stats/<statId>/bits/<bit>`, freigeschaltet ist `data & (1<<bit)`, die Zeitstempel stehen in `AchievementTimes/<bit>`.
  - `userdata/<accountId>/config/localconfig.vdf`: nur `Software/Valve/Steam/apps/<appid>/{Playtime,LastPlayed}`. Die Datei enthält auch Auth-Tickets, die nie anfassen.
  - accountId = steamid64 − 76561197960265728. Icons im Cache sind bloße Dateinamen; `iconUrl()` baut die CDN-URL wie bei der API.
- `planSync` (`src/lib/sync/plan.ts`) entscheidet aus einem `GetOwnedGames`, welche Calls nötig sind. `SyncEngine` (`engine.ts`) führt sie aus. `Scheduler` taktet: Library-Sync im Intervall, Tick alle 15 s (laufendes Spiel aus der Registry plus `syncLocal`).
- Sync-Gründe (`SyncTask.reason`): `new`, `unknown`, `changed`, `force`, `live`, `local`, `schemaAge`, `globalAge`, `backfill`.

## Invarianten (nicht brechen)
- **Erst alles laden, dann schreiben.** Ein Fehler darf gespeicherte Daten nie verändern. `total: null` heißt „unbekannt“, `0` heißt „hat keine Achievements“. Ein Fehler darf nie zu `0` werden.
- **Lokale Daten fügen nur hinzu:** Sie sperren nie etwas und überschreiben keine Unlock-Zeit (die Client-Uhr weicht um Sekunden ab). Ein lokales Schema wird nur genommen, wenn die Datei neuer als `schemaFetchedAt` ist **und** die eingestellte Sprache enthält.
- Lokaler Fortschritt in einem API-Sync gilt nur, wenn `statsMtime >= rtime_last_played`. Sonst wurde woanders gespielt (anderer PC, Steam Deck), und die API wird gefragt.
- Spielzeit = max(API, lokal). `localconfig.vdf` wird erst am Sessionende geschrieben und hängt deshalb hinterher.
- `force` (`apiOnly`) ignoriert den lokalen Cache komplett.
- Nutzerdaten (Pins, Notizen, Ausschlüsse, manuelle Tags, manueller Status) überleben jeden Schema-Refresh (`mergeSchema`).
- Pro Game werden Aggregate (`easyOpen`, `effort`, `rarestOpen`, `rarityScore`, `lastUnlock`) gespeichert, damit Listen nicht alle Achievements laden müssen. Nach jeder Änderung an Achievements `aggregate()` neu rechnen.
- **Steam-Regeln:** nie in Steam-Ordner schreiben, nichts injizieren, keinen Prozessspeicher lesen, kein Steamworks-SDK mit fremden AppIDs, keine Achievements setzen. Web-API-Key bleibt im Windows Credential Manager (`get_secret`/`set_secret`).

## Tests
- `npm test` (Vitest): `tests/fakeSteam.ts` ist eine Fake-Web-API, die Calls zählt; `tests/fakeLocal.ts` ein Fake-Cache. Neue Sync-Logik immer mit einer Call-Anzahl testen („kostet genau N Calls“).
- `cargo test --lib` in `src-tauri`: Parser-Tests mit synthetischen Bytes. Keine Tests mit echten Nutzerdaten oder echten Steam-IDs committen.
- `npm run check` (svelte-check) muss ohne Fehler laufen.

## Release
- `npm run release -- patch|minor|major|x.y.z "Notizen"` setzt die Version in `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml` und `Cargo.lock`, committet, taggt und pusht. `.github/workflows/release.yml` baut, signiert und veröffentlicht.
- Der Updater-Endpoint in `tauri.conf.json` ist ein Platzhalter (`OWNER/REPO`), den der Workflow ersetzt. Bitte nicht hart eintragen.
- Signatur-Key: `%USERPROFILE%\.tauri\achievement-hunter.key` (ohne Passwort), als Secret `TAURI_SIGNING_PRIVATE_KEY` in GitHub. Niemals ins Repo; `*.key` steht in der `.gitignore`. Geht der Key verloren, können installierte Apps keine Updates mehr annehmen.
- Lokal gebaute Installer (`npm run tauri build`) finden wegen des Platzhalters keine Updates. Das ist Absicht.
- Installierte Apps prüfen 10 s nach dem Start und danach alle 12 h `latest.json`.
- Privates Repo wäre möglich: Releases in ein zweites, öffentliches Repo (mindestens ein Commit). Dafür Variable `RELEASE_REPO=<user>/<repo>` und Secret `RELEASE_TOKEN` (Fine-grained, „Contents: Read and write“ auf das Release-Repo) setzen. Der Workflow unterstützt das schon.
- Build-Voraussetzungen unter Windows: Rustup (`winget install Rustlang.Rustup`), VS 2022 Build Tools mit dem Workload VCTools, WebView2 (in Windows 11 enthalten).

## Sync-Kosten (Stand)
- Library-Sync: 1 Call (`GetOwnedGames`) plus `GetPlayerAchievements` nur für Spiele mit geänderter Spielzeit, deren lokale Stats nicht aktuell sind.
- Schema wird nach 30 Tagen neu geladen (lokal, wenn Steams Datei neuer ist), Rarity nach 7 Tagen. Höchstens 15 Hintergrund-Refreshes pro Lauf.
- Ohne lokalen Cache (Browser-Modus, kein Steam installiert) ist der Live-Modus API-basiert: Das laufende Spiel wird alle 2,5 min abgefragt, plus einmal beim Beenden.
- Bei 429/5xx gibt es Backoff. Bei privatem Profil, ungültigem Key oder Rate-Limit bricht der Lauf ab.

## Stolpersteine
- Neue Tauri-Plugins brauchen einen Eintrag in `src-tauri/capabilities/default.json`. Eigene `#[tauri::command]`s nicht.
- Tauri-Command-Argumente kommen in JS als camelCase an (`account_id` → `accountId`).
- `npm run dev` (Browser) hat keinen lokalen Cache, keinen Updater und keine Registry. `platform.ts` kapselt das.
- Offene Ideen: Snapshots und `getUnlocks` werden gespeichert, haben aber noch keine UI (Verlauf, Statistik). `recentUnlocks` im App-State wird noch nicht angezeigt. Manuelle Tags bleiben bei `mergeSchema` erhalten, lassen sich in der UI aber noch nicht bearbeiten.
