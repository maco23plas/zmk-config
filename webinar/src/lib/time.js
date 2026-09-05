// 日本時間(JST)ユーティリティ。
// 保存は常に UTC の epoch ミリ秒。表示・入力だけ JST に変換する。
// 日本にサマータイムは無いため、オフセットは固定 +09:00 として厳密に扱える。

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** epoch ms → JSTの年月日時分と曜日 */
export function jstParts(ms) {
  const d = new Date(ms + JST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
    weekdayJa: WEEKDAY_JA[d.getUTCDay()],
  };
}

/** '2026年9月10日(木) 20:00' */
export function formatJst(ms, { withYear = true, withWeekday = true, withTime = true } = {}) {
  const p = jstParts(ms);
  let s = withYear ? `${p.year}年${p.month}月${p.day}日` : `${p.month}月${p.day}日`;
  if (withWeekday) s += `(${p.weekdayJa})`;
  if (withTime) s += ` ${pad(p.hour)}:${pad(p.minute)}`;
  return s;
}

/** '9/10(木) 20:00' 一覧向けの短い表記 */
export function formatJstShort(ms) {
  const p = jstParts(ms);
  return `${p.month}/${p.day}(${p.weekdayJa}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/** '20:00' */
export function formatJstTime(ms) {
  const p = jstParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** <input type="datetime-local"> の値 'YYYY-MM-DDTHH:MM' (JST) */
export function toDatetimeLocal(ms) {
  const p = jstParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** 'YYYY-MM-DDTHH:MM'（JSTとして解釈）→ epoch ms。不正なら null。 */
export function parseJstLocal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = Date.UTC(Number(y), month - 1, day, hour, minute, Number(s || 0));
  const ms = utc - JST_OFFSET_MS;
  // 2月31日のような繰り上がりを弾く
  const back = jstParts(ms);
  if (back.month !== month || back.day !== day) return null;
  return ms;
}

/** 'HH:MM' → 0時からの経過ミリ秒。不正なら null。 */
export function parseHhMm(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * HOUR + mi * MINUTE;
}

/** その時刻を含むJSTの日の 00:00 の epoch ms */
export function jstDayStart(ms) {
  const p = jstParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day) - JST_OFFSET_MS;
}

/** 2つの時刻が JST の同じ日かどうか（「当日」判定に使う） */
export function isSameJstDay(a, b) {
  return jstDayStart(a) === jstDayStart(b);
}

/** 秒 → '1時間30分' / '45分' / '30秒' */
export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  if (m > 0) return `${m}分`;
  return `${s}秒`;
}

/** 残り時間 → 'あと2時間15分' のような表現 */
export function formatRelative(ms) {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / MINUTE);
  if (mins < 1) return ms >= 0 ? 'まもなく' : 'たった今';
  const d = Math.floor(mins / (60 * 24));
  const h = Math.floor((mins % (60 * 24)) / 60);
  const m = mins % 60;
  let s = '';
  if (d > 0) s = `${d}日${h > 0 ? h + '時間' : ''}`;
  else if (h > 0) s = `${h}時間${m > 0 ? m + '分' : ''}`;
  else s = `${m}分`;
  return ms >= 0 ? `あと${s}` : `${s}前`;
}

/** Googleカレンダー登録URL（予約完了時のおまけ動線） */
export function googleCalendarUrl({ title, startMs, endMs, details, location }) {
  const fmt = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  };
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(startMs)}/${fmt(endMs)}`,
    details: details || '',
    location: location || '',
    ctz: 'Asia/Tokyo',
  });
  return `https://www.google.com/calendar/render?${q}`;
}
