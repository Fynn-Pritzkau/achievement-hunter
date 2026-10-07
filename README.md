# 🏆 Achievement Hunter

A lightweight Windows app for Steam achievement hunters. It shows which games are closest to 100 %, which open achievements are easy, and which are rare. It also notifies you the moment you unlock something.

> The interface is available in English and German (switch it under Settings → App language). Achievement names can be shown in German or English.

## Download

Get the latest `Achievement.Hunter_x.y.z_x64-setup.exe` from **[Releases](https://github.com/Fynn-Pritzkau/achievement-hunter/releases/latest)** and run it. Windows 10 or 11 is required.

The installer isn't signed with a paid code-signing certificate, so Windows SmartScreen may say *"Windows protected your PC"* on the first install. Click **More info → Run anyway**. Updates after that are signed and checked by the app itself.

The app updates itself: when a new version is out, a button appears at the bottom left. Click it and the update installs.

## Getting started

1. **Get a Steam Web API key** at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). Any domain name works, e.g. `localhost`.
2. **Make your game details public:** Steam → Profile → Edit Profile → Privacy Settings → *Game details: Public*.
3. Open the app and enter the key and your Steam profile. A profile URL, a custom name or a SteamID64 all work.

The first sync loads your library. It can take a minute for big libraries.

## Features

- **Smart lists:** *Almost done* (80 %+), *Easy wins* (open achievements over half of all players have), *Perfect lost* (an update added new achievements), *Started and abandoned*, *Rarest open*, *Perfect games*, *Never started*, and more
- **Sorting** by progress, fewest left, least effort, rarity, last played, last unlock and playtime
- **Status per game** (next, playing, paused, completed, dropped). It is set automatically and can be overridden.
- **Game page:** filter by open, done or focus. Auto-tags (online, co-op, difficulty, collectibles, grind, time limit), personal notes, a focus list, excluding broken achievements from your completion, hidden-achievement spoiler protection, and quick links to guides
- **Live unlock notifications** while you play, with how rare the achievement is
- **In-game overlay** toggled with `Ctrl+Shift+A` (configurable): a small click-through card with your progress, pinned achievements and the easiest ones still open. Counters like "37/50 collectibles" show as progress bars, and when one goes up, a short popup shows it, even with the overlay closed. Counters that climb nonstop (clicks, steps) only pop up now and then. It's a plain always-on-top window, so it shows over windowed and borderless games but not over exclusive fullscreen.
- **Quick search** with `Ctrl+K`
- Runs quietly in the **system tray**

## Fast and light

Achievement Hunter reads the data your Steam client already keeps on your PC. Most updates therefore need **no internet request at all**, and new unlocks show up within about 15 seconds. The Steam Web API is only used for your game list, global rarity, and games you played on another device (e.g. a Steam Deck).

## Privacy and Steam rules

- Everything stays on your PC. Your API key is stored in the Windows Credential Manager, your data in `%APPDATA%\de.fynnp.achievement-hunter\`.
- The app only **reads** Steam's files. It never changes Steam, games or your achievements, injects nothing, and doesn't count as a cheat or idler.
- Only your own profile is queried, far below Steam's API limits.

To uninstall, use Windows Settings → Apps → *Achievement Hunter*. To remove your data as well, delete the folder above and `%LOCALAPPDATA%\de.fynnp.achievement-hunter\` (the app's log).

## Backup, new PC, other account

**Settings → Backup → Save backup** writes a small JSON file to your Downloads folder. It holds what only exists in the app: game status, pins, notes, your own tags, excluded achievements, your history, milestones and settings. Everything else comes back from Steam.

On a new PC, set the app up, then **Load backup**. Games that haven't synced yet get their data as soon as they do.

You can change your API key or Steam account under **Settings → Steam account**. When you switch to a different account, the app first saves a backup of the current one, then starts fresh, so two accounts never mix.

## Reporting a bug

Open **Settings → Report a problem → Copy diagnostics** and paste the text into a [bug report](https://github.com/Fynn-Pritzkau/achievement-hunter/issues/new/choose). It contains the app and Windows version, your settings and the app's log. Your API key, SteamID and Windows user name are removed.

## For developers

Built with Tauri 2 (Rust) and Svelte 5.

```bash
npm install
npm run tauri dev
```

```bash
npm test
```

To try the UI without a Steam account, run the mock mode. The whole app then runs in the browser against a fake Steam with a sample library. A control panel lets you start games, unlock achievements, count stats up, open the overlay and simulate Steam outages:

```bash
npm run dev:mock
```

Then open http://localhost:1421. Scenarios: `?mock=fresh` (setup screen), `?mock=nolocal` (no Steam install), `?mock=empty`, `?mock=private`.

Publish a new version with one command. GitHub Actions then builds, signs and releases it, and installed apps update themselves:

```bash
npm run release -- patch "What's new"
```

## License

[GPL-3.0](LICENSE). You may use, change and share the code, as long as what you share stays under the same license.

Not affiliated with Valve or Steam.
