export function log(tag: string, ...args: unknown[]) {
  console.log(`[${new Date().toISOString()}] [${tag}]`, ...args);
}

export function slug(s: string, max = 40): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (cleaned || 'meeting').slice(0, max);
}

export function ymd(d: Date = new Date(), tz = 'Asia/Tokyo'): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(d); // YYYY-MM-DD
}

export function hms(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `\n…(以下 ${s.length - max} 文字省略)`;
}

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
