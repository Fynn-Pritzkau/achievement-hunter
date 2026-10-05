import { SteamApiError } from './steam/api';

export type Locale = 'de' | 'en';

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'de', label: 'Deutsch' },
  { id: 'en', label: 'English' },
];

/** German is the source; every other language must have the same keys. `{name}` is replaced by params. */
const de = {
  'app.loading': 'Lade …',

  'setup.intro': 'Verbinde deinen Steam-Account. Der Key wird im Windows-Anmeldeinformationsspeicher abgelegt, nicht im Klartext.',
  'setup.apiKey': 'Steam Web API Key',
  'setup.apiKeyPlaceholder': '32 Zeichen',
  'setup.apiKeyHint': 'Bekommst du unter steamcommunity.com/dev/apikey',
  'setup.profile': 'Steam-Profil',
  'setup.profilePlaceholder': 'SteamID64, Profil-URL oder eigener Name',
  'setup.profileHint': 'Die Spieldetails im Profil müssen öffentlich sein.',
  'setup.achLanguage': 'Sprache der Achievements',
  'setup.checking': 'Prüfe …',
  'setup.connect': 'Verbinden',

  'settings.title': 'Einstellungen',
  'settings.uiLanguage': 'Sprache der App',
  'settings.interval': 'Bibliothek synchronisieren alle (Minuten)',
  'settings.intervalHint': 'Kostet pro Sync meist nur 1 API-Call. Neue Achievements liest die App zusätzlich alle 15 s aus Steams lokalem Cache, ohne API-Call.',
  'settings.staleDays': '„Spiele ich“ wird „Pausiert“ nach (Tagen ohne Spielen, 0 = nie)',
  'settings.notify': 'Benachrichtigung bei neuen Achievements',
  'settings.revealHidden': 'Versteckte Achievements immer aufdecken',
  'settings.reloadAll': 'Alles neu laden',
  'settings.reloadAllHint': 'Lädt alle Achievements neu — viele API-Calls',
  'settings.cancel': 'Abbrechen',
  'settings.save': 'Speichern',
  'settings.restartHint': 'Intervall und Pausier-Regel greifen nach einem Neustart der App.',
  'settings.version': 'Version {v}',
  'settings.updChecking': 'suche …',
  'settings.updAvailable': '{v} verfügbar',
  'settings.updCurrent': 'aktuell',
  'settings.updFailed': 'Update-Prüfung fehlgeschlagen',
  'settings.installNow': 'Jetzt installieren',
  'settings.checkUpdates': 'Nach Updates suchen',

  'sidebar.search': 'Suchen …',
  'sidebar.perfect': 'Perfect',
  'sidebar.avgCompletion': 'Ø Completion',
  'sidebar.achievements': 'Achievements',
  'sidebar.rarityPoints': 'Rarity-Punkte',
  'sidebar.installing': 'Update wird installiert …',
  'sidebar.installingPct': 'Update wird installiert … {p} %',
  'sidebar.installUpdate': '⬆ Update auf {v} installieren',
  'sidebar.syncProgress': 'Sync {done}/{total}',
  'sidebar.lastSync': 'Sync {when}',
  'sidebar.never': 'noch nie',
  'sidebar.justNow': 'gerade eben',
  'sidebar.minAgo': 'vor {n} min',
  'sidebar.hAgo': 'vor {n} h',
  'sidebar.syncNow': 'Jetzt synchronisieren',

  'list.running': 'Läuft gerade',
  'list.running.hint': 'Das Spiel, das Steam gerade ausführt',
  'list.all': 'Alle mit Achievements',
  'list.all.hint': 'Jedes Spiel mit Achievements',
  'list.almost': 'Fast fertig',
  'list.almost.hint': 'Ab 80 %, aber noch nicht 100 %',
  'list.easy': 'Easy Wins',
  'list.easy.hint': 'Offene Achievements, die über 50 % der Spieler haben',
  'list.lost': 'Perfect verloren',
  'list.lost.hint': 'War 100 %, ein Update hat neue Achievements gebracht',
  'list.started': 'Angefangen, liegen gelassen',
  'list.started.hint': 'Über 50 %, seit 30 Tagen nicht gespielt',
  'list.rare': 'Seltenste offene',
  'list.rare.hint': 'Spiele mit offenen Achievements unter 5 %',
  'list.perfect': 'Perfect Games',
  'list.perfect.hint': '100 %',
  'list.unplayed': 'Nie angefangen',
  'list.unplayed.hint': 'Mit Achievements, 0 Minuten gespielt',
  'list.none': 'Ohne Achievements',
  'list.none.hint': 'Spiele ohne Achievements',
  'list.hidden': 'Ausgeblendet',
  'list.hidden.hint': 'Von dir ausgeblendete Spiele',

  'sort.recent': 'Zuletzt gespielt',
  'sort.recentUnlock': 'Letzter Unlock',
  'sort.completion': 'Fortschritt',
  'sort.remaining': 'Wenigste offen',
  'sort.effort': 'Wenigster Aufwand',
  'sort.easy': 'Meiste Easy Wins',
  'sort.rarest': 'Seltenstes offenes',
  'sort.rarity': 'Rarity-Punkte',
  'sort.playtime': 'Spielzeit',
  'sort.name': 'Name',

  'library.count': '{n} Spiele',
  'library.filter': 'Filtern … (z. B. min:50 status:paused)',
  'library.loading': 'Bibliothek wird geladen …',
  'library.empty': 'Nichts in dieser Liste.',
  'library.pinned': 'Angeheftet',
  'library.running': 'läuft',
  'library.lostHint': 'War 100 %, neue Achievements',
  'library.noAchievements': 'keine Achievements',
  'library.easyHint': 'Offene Achievements, die über 50 % der Spieler haben',
  'library.easy': '{n} easy',
  'library.rarestHint': 'Seltenstes offenes Achievement',
  'library.rarest': 'seltenstes {p}',

  'palette.placeholder': 'Spiel suchen …',

  'status.next': 'Als Nächstes',
  'status.playing': 'Spiele ich',
  'status.paused': 'Pausiert',
  'status.completed': 'Abgeschlossen',
  'status.dropped': 'Abgebrochen',

  'tag.online': 'Online',
  'tag.coop': 'Koop',
  'tag.difficulty': 'Schwierigkeit',
  'tag.collectible': 'Sammeln',
  'tag.grind': 'Grind',
  'tag.speedrun': 'Zeitlimit',

  'game.back': '← Zurück',
  'game.noAchievements': 'Keine Achievements',
  'game.lastPlayed': 'zuletzt {date}',
  'game.rarityPoints': '{n} Rarity-Punkte',
  'game.statusNone': '– Status –',
  'game.statusAuto': 'Status wieder automatisch setzen',
  'game.unpin': '📌 Gelöst',
  'game.pin': '📌 Anheften',
  'game.show': 'Einblenden',
  'game.hide': 'Ausblenden',
  'game.launch': '▶ Starten',
  'game.open': 'Offen {n}',
  'game.focus': '📌 Fokus {n}',
  'game.done': 'Erledigt {n}',
  'game.all': 'Alle',
  'game.orderEasy': 'Einfachste zuerst',
  'game.orderRare': 'Seltenste zuerst',
  'game.orderRecent': 'Zuletzt freigeschaltet',
  'game.orderName': 'Name',
  'game.spoiler': 'Verstecktes Achievement – klicken zum Aufdecken',
  'game.unfocus': 'Aus Fokus entfernen',
  'game.focusAdd': 'In den Fokus',
  'game.notePlaceholder': 'Eigene Notiz, z. B. „Kapitel 3, nach dem Boss links“',
  'game.exclude': 'Kaputt/unerreichbar – nicht mitzählen',
  'game.loadingNext': 'Achievements werden beim nächsten Sync geladen …',

  'sync.failedGames': '{n} Spiel(e) konnten nicht geladen werden — nächster Sync versucht es erneut.',
  'notify.rare': ' — nur {p} haben das!',

  'error.auth': 'Ungültiger Steam-API-Key oder Zugriff verweigert.',
  'error.private': 'Die Spieldetails sind privat. Stell sie in Steams Privatsphäre-Einstellungen auf „Öffentlich“.',
  'error.rate': 'Steam-Rate-Limit erreicht. Später erneut versuchen.',
  'error.notFound': 'Steam-Profil nicht gefunden.',
  'error.network': 'Netzwerkfehler. Bist du online?',

  'tray.open': 'Öffnen',
  'tray.quit': 'Beenden',
};

export type MessageKey = keyof typeof de;

const en: Record<MessageKey, string> = {
  'app.loading': 'Loading …',

  'setup.intro': 'Connect your Steam account. The key is stored in the Windows Credential Manager, not in plain text.',
  'setup.apiKey': 'Steam Web API key',
  'setup.apiKeyPlaceholder': '32 characters',
  'setup.apiKeyHint': 'Get one at steamcommunity.com/dev/apikey',
  'setup.profile': 'Steam profile',
  'setup.profilePlaceholder': 'SteamID64, profile URL or custom name',
  'setup.profileHint': 'Game details in your profile must be public.',
  'setup.achLanguage': 'Achievement language',
  'setup.checking': 'Checking …',
  'setup.connect': 'Connect',

  'settings.title': 'Settings',
  'settings.uiLanguage': 'App language',
  'settings.interval': 'Sync library every (minutes)',
  'settings.intervalHint': 'A sync usually costs just 1 API call. New achievements are also read from Steam’s local cache every 15 s, without any API call.',
  'settings.staleDays': '“Playing” becomes “Paused” after (days without playing, 0 = never)',
  'settings.notify': 'Notify me about new achievements',
  'settings.revealHidden': 'Always reveal hidden achievements',
  'settings.reloadAll': 'Reload everything',
  'settings.reloadAllHint': 'Reloads all achievements — many API calls',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save',
  'settings.restartHint': 'Interval and pause rule take effect after restarting the app.',
  'settings.version': 'Version {v}',
  'settings.updChecking': 'checking …',
  'settings.updAvailable': '{v} available',
  'settings.updCurrent': 'up to date',
  'settings.updFailed': 'Update check failed',
  'settings.installNow': 'Install now',
  'settings.checkUpdates': 'Check for updates',

  'sidebar.search': 'Search …',
  'sidebar.perfect': 'Perfect',
  'sidebar.avgCompletion': 'Avg. completion',
  'sidebar.achievements': 'Achievements',
  'sidebar.rarityPoints': 'Rarity points',
  'sidebar.installing': 'Installing update …',
  'sidebar.installingPct': 'Installing update … {p} %',
  'sidebar.installUpdate': '⬆ Install update {v}',
  'sidebar.syncProgress': 'Sync {done}/{total}',
  'sidebar.lastSync': 'Synced {when}',
  'sidebar.never': 'never',
  'sidebar.justNow': 'just now',
  'sidebar.minAgo': '{n} min ago',
  'sidebar.hAgo': '{n} h ago',
  'sidebar.syncNow': 'Sync now',

  'list.running': 'Running now',
  'list.running.hint': 'The game Steam is running right now',
  'list.all': 'All with achievements',
  'list.all.hint': 'Every game with achievements',
  'list.almost': 'Almost done',
  'list.almost.hint': '80 % or more, but not 100 % yet',
  'list.easy': 'Easy wins',
  'list.easy.hint': 'Open achievements that more than 50 % of players have',
  'list.lost': 'Perfect lost',
  'list.lost.hint': 'Was 100 %, an update added new achievements',
  'list.started': 'Started, left behind',
  'list.started.hint': 'Over 50 %, not played for 30 days',
  'list.rare': 'Rarest open',
  'list.rare.hint': 'Games with open achievements below 5 %',
  'list.perfect': 'Perfect games',
  'list.perfect.hint': '100 %',
  'list.unplayed': 'Never started',
  'list.unplayed.hint': 'Has achievements, 0 minutes played',
  'list.none': 'No achievements',
  'list.none.hint': 'Games without achievements',
  'list.hidden': 'Hidden',
  'list.hidden.hint': 'Games you have hidden',

  'sort.recent': 'Last played',
  'sort.recentUnlock': 'Last unlock',
  'sort.completion': 'Progress',
  'sort.remaining': 'Fewest open',
  'sort.effort': 'Least effort',
  'sort.easy': 'Most easy wins',
  'sort.rarest': 'Rarest open',
  'sort.rarity': 'Rarity points',
  'sort.playtime': 'Playtime',
  'sort.name': 'Name',

  'library.count': '{n} games',
  'library.filter': 'Filter … (e.g. min:50 status:paused)',
  'library.loading': 'Loading library …',
  'library.empty': 'Nothing in this list.',
  'library.pinned': 'Pinned',
  'library.running': 'running',
  'library.lostHint': 'Was 100 %, new achievements',
  'library.noAchievements': 'no achievements',
  'library.easyHint': 'Open achievements that more than 50 % of players have',
  'library.easy': '{n} easy',
  'library.rarestHint': 'Rarest open achievement',
  'library.rarest': 'rarest {p}',

  'palette.placeholder': 'Search games …',

  'status.next': 'Up next',
  'status.playing': 'Playing',
  'status.paused': 'Paused',
  'status.completed': 'Completed',
  'status.dropped': 'Dropped',

  'tag.online': 'Online',
  'tag.coop': 'Co-op',
  'tag.difficulty': 'Difficulty',
  'tag.collectible': 'Collectibles',
  'tag.grind': 'Grind',
  'tag.speedrun': 'Time limit',

  'game.back': '← Back',
  'game.noAchievements': 'No achievements',
  'game.lastPlayed': 'last played {date}',
  'game.rarityPoints': '{n} rarity points',
  'game.statusNone': '– Status –',
  'game.statusAuto': 'Set status automatically again',
  'game.unpin': '📌 Unpin',
  'game.pin': '📌 Pin',
  'game.show': 'Show',
  'game.hide': 'Hide',
  'game.launch': '▶ Play',
  'game.open': 'Open {n}',
  'game.focus': '📌 Focus {n}',
  'game.done': 'Done {n}',
  'game.all': 'All',
  'game.orderEasy': 'Easiest first',
  'game.orderRare': 'Rarest first',
  'game.orderRecent': 'Recently unlocked',
  'game.orderName': 'Name',
  'game.spoiler': 'Hidden achievement – click to reveal',
  'game.unfocus': 'Remove from focus',
  'game.focusAdd': 'Add to focus',
  'game.notePlaceholder': 'Your own note, e.g. “Chapter 3, left after the boss”',
  'game.exclude': 'Broken/unobtainable – don’t count it',
  'game.loadingNext': 'Achievements will be loaded with the next sync …',

  'sync.failedGames': '{n} game(s) could not be loaded — the next sync will try again.',
  'notify.rare': ' — only {p} have this!',

  'error.auth': 'Invalid Steam API key or access denied.',
  'error.private': 'Game details are private. Set them to “Public” in your Steam privacy settings.',
  'error.rate': 'Steam rate limit reached. Try again later.',
  'error.notFound': 'Steam profile not found.',
  'error.network': 'Network error. Are you online?',

  'tray.open': 'Open',
  'tray.quit': 'Quit',
};

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { de, en };

/** German for German systems, English for everything else. */
export function systemLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  return lang.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** The matching Steam language name for achievement texts. */
export const steamLanguage = (l: Locale) => (l === 'de' ? 'german' : 'english');

class I18n {
  locale = $state<Locale>(systemLocale());
}

export const i18n = new I18n();

export function setLocale(l: Locale) {
  i18n.locale = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/** Translates a key in the current locale. Reactive in templates because it reads `i18n.locale`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = MESSAGES[i18n.locale][key] ?? de[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : text;
}

export const isMessageKey = (key: string): key is MessageKey => key in de;

/** User-facing text for an error; Steam errors with a known cause get a translated message. */
export function errorText(e: unknown): string {
  if (e instanceof SteamApiError) {
    const key = `error.${e.kind}`;
    if (isMessageKey(key)) return t(key);
  }
  return e instanceof Error ? e.message : String(e);
}
