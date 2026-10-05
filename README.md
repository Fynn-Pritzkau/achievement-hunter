# Achievement Hunter

Schlanke Desktop-App (Tauri 2 + Svelte 5) für Steam-Achievement-Hunter. Nachfolger des Obsidian-Plugins `steam-tracker`.

## Voraussetzungen (einmalig)

```bash
winget install Rustlang.Rustup
```

```bash
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

WebView2 ist in Windows 11 schon enthalten.

## Entwicklung

```bash
npm install
npm run tauri dev     # Desktop-App
npm run dev           # nur UI im Browser (localhost:1420, Steam über Vite-Proxy, Daten in localStorage)
npm test              # Unit-Tests (Sync-Engine gegen einen Fake-Steam-Server)
npm run check         # Typprüfung
npm run tauri build   # Installer (NSIS)
```

## Updates veröffentlichen

```bash
npm run release -- patch "Was ist neu"
```

Statt `patch` gehen auch `minor`, `major` oder eine Version wie `1.4.0`. Das Skript setzt die Version in allen Dateien, lässt die Tests laufen, committet, taggt und pusht. GitHub Actions baut daraufhin den Installer, signiert ihn und veröffentlicht ihn als Release, zusammen mit einer `latest.json`. Installierte Apps finden das Update nach etwa 10 s und danach alle 12 h selbst. Es erscheint ein Button „Update installieren“ in der Seitenleiste, und unter Einstellungen gibt es „Nach Updates suchen“. Mit `--no-push` wird nur lokal getaggt.

### Einrichtung (einmalig)

1. Auf github.com ein Repo anlegen und das Projekt verbinden:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   ```
2. Repo → Settings → Secrets and variables → Actions → **Secrets**:
   - `TAURI_SIGNING_PRIVATE_KEY` = Inhalt von `%USERPROFILE%\.tauri\achievement-hunter.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = leer lassen bzw. nicht anlegen (der Key hat kein Passwort)
3. Den privaten Key zusätzlich im Passwort-Manager sichern. **Ohne ihn kann keine installierte App mehr Updates annehmen.** Der öffentliche Teil steht in `src-tauri/tauri.conf.json` und darf öffentlich sein.
4. Die Update-Adresse setzt der Workflow beim Bauen automatisch auf das eigene Repo. In `tauri.conf.json` steht deshalb nur ein Platzhalter. Lokal gebaute Installer finden darum keine Updates, das ist Absicht.

**Privates Repo:** Der Updater lädt ohne Login, also müssen die Releases öffentlich sein. Wenn der Code privat bleiben soll, lege ein zweites, öffentliches Repo nur für Releases an. Es braucht mindestens einen Commit, z. B. eine README. Dann im privaten Repo:
- Variable `RELEASE_REPO` = `<user>/<release-repo>`
- Secret `RELEASE_TOKEN` = ein Fine-grained Token mit „Contents: Read and write“ auf das Release-Repo

## Wie der Sync Steam schont

- **Pro Intervall 1 Call** (`GetOwnedGames`). Nur Spiele mit geänderter Spielzeit kosten je 1 weiteren Call (`GetPlayerAchievements`).
- **Schema und Rarity werden gecacht.** Das Schema wird nach 30 Tagen neu geladen oder sofort, wenn sich die Achievement-Anzahl ändert (Update/DLC). Die Rarity wird nach 7 Tagen aktualisiert. Höchstens 15 solcher Hintergrund-Refreshes pro Lauf.
- **Lokaler Steam-Cache zuerst:** Der Steam-Client legt Schema und Fortschritt jedes auf diesem PC gespielten Spiels in `Steam\appcache\stats\` ab. Die App liest diese Dateien nur. Schema und Unlocks kommen dann ohne API-Call von der Platte, die Spielzeit aus `userdata\<id>\config\localconfig.vdf` (es zählt der höhere Wert von lokal und API). Die API wird gefragt, wenn eine Datei fehlt, in einer anderen Sprache vorliegt, älter als die letzte API-Abfrage ist oder das Spiel seitdem woanders gespielt wurde (anderer PC, Steam Deck). Lokale Daten fügen nur Unlocks hinzu und sperren nie etwas. „Erzwingen“ fragt ausschließlich die API.
- **Live-Modus:** Steam schreibt das laufende Spiel in die Registry (`HKCU\Software\Valve\Steam\RunningAppID`). Mit lokalem Cache prüft die App alle 15 s nur die Änderungszeiten der Stats-Dateien (ein Verzeichnis-Listing, keine Datei wird geöffnet) und liest neu geschriebene Dateien ein. Das kostet 0 API-Calls. Ohne Cache fragt sie das laufende Spiel alle 2,5 min über die API ab, plus einmal beim Beenden.
- **Rarity** gibt es nur über die API (`GetGlobalAchievementPercentagesForApp`).
- **Fehler überschreiben nie Daten:** Erst wird alles geladen, dann geschrieben. Fehlgeschlagene Spiele werden im nächsten Lauf erneut versucht. Bei 429/5xx gibt es Backoff, bei privatem Profil, ungültigem Key oder Rate-Limit bricht der Lauf ab.

## Steam-Regeln

- Die App **liest** Steams Cache- und Config-Dateien nur. Sie schreibt dort nie etwas, injiziert nichts in Steam oder Spiele, liest keinen Prozessspeicher und nutzt nicht das Steamworks-SDK mit fremden AppIDs. Achievements werden also nie gesetzt und Spielzeit nie vorgetäuscht.
- Die Auth-Tickets in `localconfig.vdf` werden ignoriert. Gelesen werden nur `Playtime` und `LastPlayed` unter `Software\Valve\Steam\apps`.
- Web-API: ein eigener Key, im Windows-Tresor gespeichert und nie weitergegeben. Es werden nur die Daten des eigenen Profils abgefragt, weit unter dem Limit von 100.000 Calls pro Tag.
- **Gespeicherte Steam-Daten** (nur lokal in `%APPDATA%\de.fynnp.achievement-hunter\`): Spieleliste, Spielzeit, Achievement-Schema, eigener Fortschritt und globale Raten. Nichts davon verlässt den Rechner.

## Struktur

```
src/lib/steam/      API-Client, Rate-Limiter, Retry, local.ts (lokaler Steam-Cache)
src/lib/sync/       plan.ts (welche Calls), engine.ts, merge.ts, status.ts, scheduler.ts
src/lib/db/         Repo-Interface, SQLite (Tauri), In-Memory (Tests)
src/lib/lists.ts    Smart Lists und Sortierungen
src/lib/tags.ts     Auto-Tags (online, coop, difficulty, collectible, grind, speedrun)
src/views/          Svelte-Oberfläche
scripts/release.mjs Version setzen, taggen, pushen
.github/workflows/  release.yml: baut, signiert, veröffentlicht bei Tag v*
src-tauri/          Rust: Keyring, Registry, Tray, Plugins, steam_local.rs (liest Steams Cache-Dateien)
```
