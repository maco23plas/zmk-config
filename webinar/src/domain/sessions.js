import { all, get, run } from '../db.js';
import { newId } from '../lib/ids.js';
import { jstDayStart, jstParts, parseHhMm, DAY } from '../lib/time.js';
import { playbackState, PlaybackState } from './playback.js';

const SESSION_SELECT = `
  SELECT s.*, w.title, w.description, w.duration_sec, w.video_url, w.poster_url, w.presenter,
         w.cta_label, w.cta_url, w.cta_at_sec, w.late_join_sec, w.archive_hours,
         w.show_viewer_count, w.viewer_base, w.show_chat,
         (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status = 'active') AS reserved
    FROM sessions s
    JOIN webinars w ON w.id = s.webinar_id`;

export const getSession = (id) => get(`${SESSION_SELECT} WHERE s.id = ?`, id);

/** 予約受付中の開催枠。終了済みの枠は出さない。 */
export function listOpenSessions(now, limit = 20) {
  return all(
    `${SESSION_SELECT}
      WHERE s.status = 'open' AND s.start_at + w.duration_sec * 1000 > ?
      ORDER BY s.start_at ASC LIMIT ?`,
    now, limit,
  ).filter((s) => seatsLeft(s) !== 0);
}

/** 管理画面用（中止・満席も含む） */
export function listSessions(fromMs, limit = 200) {
  return all(`${SESSION_SELECT} WHERE s.start_at >= ? ORDER BY s.start_at ASC LIMIT ?`, fromMs, limit);
}

export function listRecentSessions(limit = 50) {
  return all(`${SESSION_SELECT} ORDER BY s.start_at DESC LIMIT ?`, limit);
}

/** 残席。capacity=0 は無制限なので null を返す。 */
export function seatsLeft(session) {
  if (!session.capacity || session.capacity <= 0) return null;
  return Math.max(0, session.capacity - (session.reserved ?? 0));
}

/** いま予約を受け付けてよい枠か（配信中の飛び込み参加も許可する） */
export function isReservable(session, now) {
  if (session.status !== 'open') return false;
  const st = playbackState(toPlan(session), now);
  if (st.state === PlaybackState.ENDED || st.state === PlaybackState.ARCHIVE) return false;
  const left = seatsLeft(session);
  return left === null || left > 0;
}

export const toPlan = (session) => ({
  startAt: session.start_at,
  durationSec: session.duration_sec,
  lateJoinSec: session.late_join_sec,
  archiveHours: session.archive_hours,
  status: session.status,
});

export function createSession({ webinarId, startAt, capacity = 0, ruleId = null }, now = Date.now()) {
  const id = newId('ses');
  run('INSERT INTO sessions (id, webinar_id, start_at, capacity, status, rule_id, created_at) VALUES (?,?,?,?,?,?,?)',
    id, webinarId, startAt, capacity, 'open', ruleId, now);
  return getSession(id);
}

export function setSessionStatus(id, status) {
  run('UPDATE sessions SET status = ? WHERE id = ?', status, id);
  return getSession(id);
}

export const deleteSession = (id) => run('DELETE FROM sessions WHERE id = ?', id);

// ---- 定期開催ルール --------------------------------------------------------

export const listRules = () =>
  all(`SELECT sr.*, w.title FROM schedule_rules sr JOIN webinars w ON w.id = sr.webinar_id ORDER BY sr.id`);

export function createRule({ webinarId, weekdays, timeJst, capacity = 0, horizonDays = 14 }, now = Date.now()) {
  run('INSERT INTO schedule_rules (webinar_id, weekdays, time_jst, capacity, horizon_days, active, created_at) VALUES (?,?,?,?,?,1,?)',
    webinarId, weekdays, timeJst, capacity, horizonDays, now);
  return get('SELECT * FROM schedule_rules WHERE id = last_insert_rowid()');
}

export const setRuleActive = (id, active) =>
  run('UPDATE schedule_rules SET active = ? WHERE id = ?', active ? 1 : 0, id);

export const deleteRule = (id) => run('DELETE FROM schedule_rules WHERE id = ?', id);

/**
 * 定期開催ルールから、まだ存在しない開催枠を作る。
 * 起動時とワーカーの巡回で呼ばれるので、毎日ぶんの枠が自動的に先まで用意される。
 * @returns {number} 追加した枠の数
 */
export function generateSessionsFromRules(now = Date.now()) {
  const rules = all('SELECT * FROM schedule_rules WHERE active = 1');
  let created = 0;

  for (const rule of rules) {
    const timeOffset = parseHhMm(rule.time_jst);
    if (timeOffset === null) continue;
    const weekdays = new Set(String(rule.weekdays).split(',').map((s) => Number(s.trim())).filter(Number.isInteger));
    if (weekdays.size === 0) continue;

    const today = jstDayStart(now);
    for (let d = 0; d <= rule.horizon_days; d++) {
      const dayStart = today + d * DAY;
      const startAt = dayStart + timeOffset;
      if (startAt <= now) continue;
      const weekday = jstParts(dayStart).weekday;
      if (!weekdays.has(weekday)) continue;

      const result = run(
        `INSERT INTO sessions (id, webinar_id, start_at, capacity, status, rule_id, created_at)
         VALUES (?,?,?,?, 'open', ?, ?)
         ON CONFLICT(rule_id, start_at) WHERE rule_id IS NOT NULL DO NOTHING`,
        newId('ses'), rule.webinar_id, startAt, rule.capacity, rule.id, now,
      );
      if (result.changes > 0) created++;
    }
  }
  return created;
}
