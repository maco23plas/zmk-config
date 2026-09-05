import { all, get, run, batch } from '../db.js';
import { newId } from '../lib/crypto.js';

const FIELDS = [
  'title', 'description', 'video_url', 'duration_sec', 'poster_url', 'presenter',
  'cta_label', 'cta_url', 'cta_at_sec', 'late_join_sec', 'archive_hours',
  'show_viewer_count', 'viewer_base', 'show_chat',
  'lobby_open_min', 'min_viewers_shown', 'welcome_message', 'closing_message',
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
  const numbers = {
    duration_sec: 3600, lobby_open_min: 15, min_viewers_shown: 3,
    show_viewer_count: 1, show_chat: 1,
  };
  if (field in numbers) return numbers[field];
  if (['cta_at_sec', 'late_join_sec', 'archive_hours', 'viewer_base'].includes(field)) return 0;
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
        webinarId, Math.round(Number(line.at_sec) || 0),   // 負の値=開始前（ロビー）
        String(line.author || ''), String(line.body || ''),
        line.kind === 'guest' ? 'guest' : 'host',
      ],
    })),
  ]);
}

/**
 * 司会の進行台本をテキストから読み取る。
 *   「05:00 事務局 ご案内します」        … 開始5分後
 *   「-05:00 事務局 まもなく開始します」  … 開始5分前（ロビー）
 *   「~03:00 参加者A なるほど」          … 参加者を装う演出（非推奨）
 */
export function parseChatScriptText(text) {
  const lines = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(~?)\s*(-?)(?:(\d+):)?(\d{1,2}):(\d{2})\s+(\S+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const [, tilde, minus, h, mm, ss, author, body] = m;
    const seconds = (Number(h || 0) * 3600) + (Number(mm) * 60) + Number(ss);
    lines.push({
      at_sec: minus ? -seconds : seconds,
      author,
      body,
      kind: tilde ? 'guest' : 'host',
    });
  }
  return lines.sort((a, b) => a.at_sec - b.at_sec);
}

export function chatScriptToText(rows) {
  const pad = (n) => String(n).padStart(2, '0');
  return rows.map((r) => {
    const abs = Math.abs(r.at_sec);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    const stamp = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    return `${r.kind === 'guest' ? '~' : ''}${r.at_sec < 0 ? '-' : ''}${stamp} ${r.author} ${r.body}`;
  }).join('\n');
}
