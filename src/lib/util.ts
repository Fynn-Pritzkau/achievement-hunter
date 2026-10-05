export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const pad = (n: number) => String(n).padStart(2, '0');

export const DAY_MS = 86_400_000;

export function fmtDate(unix: number): string | null {
  if (!unix) return null;
  return dayKey(unix * 1000);
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function oneLine(text: string | undefined | null): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

export function coverUrl(appid: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
}

export function capsuleUrl(appid: number): string {
  return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_231x87.jpg`;
}

export function fmtHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

export function fmtPercent(p: number | null): string {
  if (p == null) return '–';
  return p < 1 ? `${p.toFixed(1)} %` : `${Math.round(p)} %`;
}
