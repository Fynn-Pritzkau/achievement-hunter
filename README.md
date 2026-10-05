# 🏆 Achievement Hunter

A lightweight Windows app for Steam achievement hunters. It shows which games are closest to 100 %, which open achievements are easy, and which are rare. It also notifies you the moment you unlock something.

> The interface is available in English and German (switch it under Settings → App language). Achievement names can be shown in German or English.

## Download

Get the latest `Achievement.Hunter_x.y.z_x64-setup.exe` from **[Releases](https://github.com/Fynn-Pritzkau/achievement-hunter/releases/latest)** and run it. Windows 10 or 11 is required.

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
- **Quick search** with `Ctrl+K`
- Runs quietly in the **system tray**

## Fast and light

Achievement Hunter reads the data your Steam client already keeps on your PC. Most updates therefore need **no internet request at all**, and new unlocks show up within about 15 seconds. The Steam Web API is only used for your game list, global rarity, and games you played on another device (e.g. a Steam Deck).

## Privacy and Steam rules

- Everything stays on your PC. Your API key is stored in the Windows Credential Manager, your data in `%APPDATA%\de.fynnp.achievement-hunter\`.
- The app only **reads** Steam's files. It never changes Steam, games or your achievements, injects nothing, and doesn't count as a cheat or idler.
- Only your own profile is queried, far below Steam's API limits.

To uninstall, use Windows Settings → Apps → *Achievement Hunter*. To remove your data as well, delete the folder above.

## For developers

Built with Tauri 2 (Rust) and Svelte 5.

```bash
npm install
npm run tauri dev
```

```bash
npm test
```

Publish a new version with one command. GitHub Actions then builds, signs and releases it, and installed apps update themselves:

```bash
npm run release -- patch "What's new"
```

Architecture, invariants and release setup are documented in [CLAUDE.md](CLAUDE.md) (German).
