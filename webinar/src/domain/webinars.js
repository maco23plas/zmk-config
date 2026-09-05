import { all, get, run, batch } from '../db.js';
import { newId } from '../lib/crypto.js';

const FIELDS = [
  'title', 'description', 'video_url', 'duration_sec', 'poster_url', 'presenter',
  'cta_label', 'cta_url', 'cta_at_sec', 'late_join_sec', 'archive_hours',
  'show_viewer_count', 'viewer_base', 'show_chat',
];

export const listWebinars = () => all('SELECT * FROM webinars ORDER BY created_at DESC');
export const getWebinar = (id) => get('SELECT * FROM webinars WHERE id = ?', id);

export async function createWebinar(data, now = Date.now()) {
  const id = newId('web');
  const values = FIELDS.map((f) => data[f] ?? defaultFor(f));
  await run(
    `INSERT INTO webinars (id, ${FIELDS.join(', ')}, created_at, updated_at)
     VALUES (?, ${FIELDS.map(() => '?').join(', ')}, ?, ?)`,
    id, ...values, now, now,
  );
  return getWebinar(id);
}

export async function updateWebinar(id, data, now = Date.now()) {
  const present = FIELDS.filter((f) => data[f] !== undefined);
  if (present.length === 0) return getWebinar(id);
  await run(
    `UPDATE webinars SET ${present.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...present.map((f) => data[f]), now, id,
  );
  return getWebinar(id);
}

function defaultFor(field) {
  if (field === 'duration_sec') return 3600;
  if (['cta_at_sec', 'late_join_sec', 'archive_hours', 'show_viewer_count', 'viewer_base', 'show_chat'].includes(field)) return 0;
  return '';
}

export const listChatScript = (webinarId) =>
  all('SELECT * FROM chat_script WHERE webinar_id = ? ORDER BY at_sec ASC, id ASC', webinarId);

/** 台本チャットを丸ごと入れ替える（削除と追加をひとまとめに実行する） */
export function replaceChatScript(webinarId, lines) {
  return batch([
    { sql: 'DELETE FROM chat_script WHERE webinar_id = ?', params: [webinarId] },
    ...lines.map((line) => ({
      sql: 'INSERT INTO chat_script (webinar_id, at_sec, author, body, kind) VALUES (?, ?, ?, ?, ?)',
      params: [
        webinarId, Math.max(0, Number(line.at_sec) || 0),
        String(line.author || ''), String(line.body || ''),
        line.kind === 'host' ? 'host' : 'guest',
      ],
    })),
  ]);
}

/**
 * 「01:30 山田さん こんばんは」形式のテキストを台本チャットに変換する。
 * 行頭に * を付けると主催者(host)扱い。
 */
export function parseChatScriptText(text) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\*?)\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const [, star, h, mm, ss, author, body] = m;
    lines.push({
      at_sec: (Number(h || 0) * 3600) + (Number(mm) * 60) + Number(ss),
      author, body, kind: star ? 'host' : 'guest',
    });
  }
  return lines.sort((a, b) => a.at_sec - b.at_sec);
}

export function chatScriptToText(rows) {
  const pad = (n) => String(n).padStart(2, '0');
  return rows.map((r) => {
    const h = Math.floor(r.at_sec / 3600);
    const m = Math.floor((r.at_sec % 3600) / 60);
    const s = r.at_sec % 60;
    const stamp = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return `${r.kind === 'host' ? '*' : ''}${stamp} ${r.author} ${r.body}`;
  }).join('\n');
}
