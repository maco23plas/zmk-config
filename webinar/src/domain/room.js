// 「会場」— 同じ回に集まっている参加者どうしの状態。
//
// ここで扱う人数と入室は、すべて実際の参加者の行動そのものです。
// 開催枠が時刻で決まっているので、同じ時間に本当に複数人が居合わせます。
// 架空の人数を作らなくても「集まっている感じ」が成立するのが要点です。
//
// 参加者からの書き込み（コメント・質問）はこの画面では受け付けません。
// 質問は公式LINEで受けるため、画面には導線だけを置いています。

import { all, get, run, batch } from '../db.js';
import { MINUTE } from '../lib/time.js';

/** 在室とみなす時間。ポーリング間隔より十分長くとる。 */
export const PRESENCE_WINDOW_MS = 45 * 1000;

/**
 * 表示名。フルネームは出さず「山田さん」の形にする。
 * 入室通知は他の参加者の目に触れるので、姓だけに留める。
 */
export function displayNameFor(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'ゲスト';
  const head = trimmed.split(/[\s　]+/)[0];
  return (head.length > 8 ? head.slice(0, 8) : head) + 'さん';
}

/** 在室の記録を更新する間隔。毎回書き込むと無料枠の書き込み回数を無駄に使う。 */
export const PRESENCE_REFRESH_MS = 20 * 1000;

/**
 * 会場に入る／居ることを伝える。
 * 読み取りは毎回、書き込みは20秒に1回に抑える。
 * @returns {Promise<{firstTime:boolean}>} 初めての入室なら true（入室通知を出す）
 */
export async function touchPresence({ sessionId, reservationId, displayName }, now) {
  const existing = await get(
    'SELECT joined_at, last_seen FROM room_presence WHERE session_id = ? AND reservation_id = ?',
    sessionId, reservationId,
  );

  if (!existing) {
    await run(
      `INSERT INTO room_presence (session_id, reservation_id, display_name, joined_at, last_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, reservation_id) DO UPDATE SET last_seen = excluded.last_seen`,
      sessionId, reservationId, displayName, now, now,
    );
    return { firstTime: true };
  }

  if (now - existing.last_seen >= PRESENCE_REFRESH_MS) {
    await run(
      'UPDATE room_presence SET last_seen = ? WHERE session_id = ? AND reservation_id = ?',
      now, sessionId, reservationId,
    );
  }
  // しばらく離席していた場合は入り直し扱いにして、入室通知をもう一度出す
  return { firstTime: now - existing.last_seen > PRESENCE_WINDOW_MS * 4 };
}

/** いま会場にいる人数（実測） */
export async function countPresent(sessionId, now) {
  const row = await get(
    'SELECT COUNT(*) AS c FROM room_presence WHERE session_id = ? AND last_seen >= ?',
    sessionId, now - PRESENCE_WINDOW_MS,
  );
  return row ? row.c : 0;
}

/** 直近に入ってきた人（入室通知に使う。自分は除く） */
export async function recentJoins(sessionId, sinceMs, reservationId, limit = 5) {
  const rows = await all(
    `SELECT display_name, joined_at FROM room_presence
      WHERE session_id = ? AND joined_at > ? AND reservation_id != ?
      ORDER BY joined_at ASC LIMIT ?`,
    sessionId, sinceMs, reservationId, limit,
  );
  return rows.map((r) => ({ name: r.display_name, at: r.joined_at }));
}

/** 会場の状況（人数と入室）をまとめて取る */
export async function roomSnapshot({ sessionId, reservationId, minViewersShown }, now, sinceJoinMs) {
  const [viewers, joins] = await Promise.all([
    countPresent(sessionId, now),
    sinceJoinMs ? recentJoins(sessionId, sinceJoinMs, reservationId) : Promise.resolve([]),
  ]);
  return {
    viewers,
    // 1〜2人しかいないときに人数を出すと逆に寂しいので、一定数を超えてから見せる
    showViewers: viewers >= Math.max(1, minViewersShown || 1),
    joins,
  };
}

// ---- 投票 ------------------------------------------------------------------

export const listPolls = (webinarId) =>
  all('SELECT * FROM polls WHERE webinar_id = ? ORDER BY at_sec ASC, id ASC', webinarId);

export function parsePollOptions(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch { return []; }
}

/**
 * いま出すべき投票を選ぶ。再生位置で決まるので、全員の画面に同じものが同時に出る。
 * 直近に始まった投票を1つだけ出し、それが締め切られていれば何も出さない
 * （締切後に前の投票へ戻ってしまわないようにする）。
 */
export function activePoll(polls, positionSec) {
  let latest = null;
  for (const poll of polls) {
    if (positionSec >= poll.at_sec) latest = poll;
  }
  if (!latest) return null;
  if (latest.close_sec > 0 && positionSec > latest.close_sec) return null;
  return latest;
}

/**
 * 投票をテキストから読み取る。
 *   「10:00 | あなたの状況は？ | 退職済み | 退職予定 | 検討中」
 *   「10:00..15:00 | ...」… 15分の時点で締め切る
 */
export function parsePollsText(text) {
  const polls = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('|').map((x) => x.trim());
    if (parts.length < 3) continue;

    const time = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\.(?:(\d+):)?(\d{1,2}):(\d{2}))?$/.exec(parts[0]);
    if (!time) continue;
    const at = (Number(time[1] || 0) * 3600) + (Number(time[2]) * 60) + Number(time[3]);
    const close = time[5] !== undefined
      ? (Number(time[4] || 0) * 3600) + (Number(time[5]) * 60) + Number(time[6]) : 0;

    const options = parts.slice(2).filter(Boolean);
    if (options.length < 2) continue;
    polls.push({ at_sec: at, close_sec: close, question: parts[1], options });
  }
  return polls.sort((a, b) => a.at_sec - b.at_sec);
}

export function pollsToText(rows) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return (h > 0 ? `${h}:${pad(m)}` : pad(m)) + ':' + pad(sec % 60);
  };
  return rows.map((r) => {
    const when = r.close_sec > 0 ? `${stamp(r.at_sec)}..${stamp(r.close_sec)}` : stamp(r.at_sec);
    return [when, r.question, ...parsePollOptions(r.options)].join(' | ');
  }).join('\n');
}

export function replacePolls(webinarId, polls) {
  return batch([
    { sql: 'DELETE FROM polls WHERE webinar_id = ?', params: [webinarId] },
    ...polls.map((p) => ({
      sql: 'INSERT INTO polls (webinar_id, at_sec, question, options, close_sec) VALUES (?,?,?,?,?)',
      params: [webinarId, Math.max(0, p.at_sec), String(p.question).slice(0, 200),
        JSON.stringify(p.options.slice(0, 6).map((o) => String(o).slice(0, 60))), Math.max(0, p.close_sec)],
    })),
  ]);
}

export async function vote({ pollId, sessionId, reservationId, choice }, now) {
  await run(
    `INSERT INTO poll_votes (poll_id, session_id, reservation_id, choice, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(poll_id, session_id, reservation_id) DO UPDATE SET choice = excluded.choice`,
    pollId, sessionId, reservationId, choice, now,
  );
}

/** 集計。結果は実際の投票のみ。 */
export async function pollTally(pollId, sessionId, optionCount) {
  const rows = await all(
    'SELECT choice, COUNT(*) AS c FROM poll_votes WHERE poll_id = ? AND session_id = ? GROUP BY choice',
    pollId, sessionId,
  );
  const tally = new Array(optionCount).fill(0);
  let total = 0;
  for (const row of rows) {
    if (row.choice >= 0 && row.choice < optionCount) tally[row.choice] = row.c;
    total += row.c;
  }
  return { tally, total };
}

export const myVote = async (pollId, sessionId, reservationId) => {
  const row = await get(
    'SELECT choice FROM poll_votes WHERE poll_id = ? AND session_id = ? AND reservation_id = ?',
    pollId, sessionId, reservationId,
  );
  return row ? row.choice : null;
};

// ---- 後片付け --------------------------------------------------------------

/** 終わった回の在室情報を消す（溜め続けない） */
export const cleanupPresence = (now) =>
  run('DELETE FROM room_presence WHERE last_seen < ?', now - 24 * 60 * MINUTE);
