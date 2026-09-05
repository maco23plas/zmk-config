import { all, get, run, tx } from '../db.js';
import { newId, randomToken, randomCode } from '../lib/ids.js';
import { getSession, seatsLeft, isReservable } from './sessions.js';

const RES_SELECT = `
  SELECT r.*, s.start_at, s.status AS session_status, s.webinar_id,
         w.title, w.description, w.duration_sec, w.video_url, w.poster_url, w.presenter,
         w.cta_label, w.cta_url, w.cta_at_sec, w.late_join_sec, w.archive_hours,
         w.show_viewer_count, w.viewer_base, w.show_chat
    FROM reservations r
    JOIN sessions s ON s.id = r.session_id
    JOIN webinars w ON w.id = s.webinar_id`;

export const getReservation = (id) => get(`${RES_SELECT} WHERE r.id = ?`, id);
export const getByWatchToken = (token) => get(`${RES_SELECT} WHERE r.watch_token = ?`, token);
export const getByLinkCode = (code) => get(`${RES_SELECT} WHERE r.link_code = ?`, code);

export const listBySession = (sessionId) =>
  all('SELECT * FROM reservations WHERE session_id = ? ORDER BY created_at ASC', sessionId);

/** そのLINEユーザーの、これから開催される予約 */
export const listUpcomingByLineUser = (lineUserId, now) =>
  all(`${RES_SELECT}
        WHERE r.line_user_id = ? AND r.status = 'active'
          AND s.start_at + w.duration_sec * 1000 > ?
        ORDER BY s.start_at ASC`, lineUserId, now);

export class ReservationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * 予約を作る。定員チェックと採番を1トランザクションで行うので、
 * 同時アクセスでも定員を超えない。
 */
export function createReservation(input, now = Date.now()) {
  const name = String(input.name || '').trim();
  if (!name) throw new ReservationError('name_required', 'お名前を入力してください');
  if (name.length > 80) throw new ReservationError('name_too_long', 'お名前が長すぎます');

  const email = String(input.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ReservationError('email_invalid', 'メールアドレスの形式が正しくありません');
  }

  return tx(() => {
    const session = getSession(input.sessionId);
    if (!session) throw new ReservationError('session_not_found', '選択された開催枠が見つかりません');
    if (!isReservable(session, now)) {
      const left = seatsLeft(session);
      if (left === 0) throw new ReservationError('full', 'この回は満席です');
      throw new ReservationError('closed', 'この回は受付を終了しました');
    }

    if (input.lineUserId) {
      const dup = get(
        `SELECT id FROM reservations WHERE session_id = ? AND line_user_id = ? AND status = 'active'`,
        input.sessionId, input.lineUserId,
      );
      if (dup) throw new ReservationError('duplicate', 'この回はすでに予約済みです');
    }

    const id = newId('res');
    run(
      `INSERT INTO reservations
         (id, session_id, name, email, phone, note, watch_token, link_code,
          line_user_id, line_display_name, linked_at, status, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`,
      id, input.sessionId, name, email,
      String(input.phone || '').trim().slice(0, 32),
      String(input.note || '').trim().slice(0, 1000),
      uniqueWatchToken(), uniqueLinkCode(),
      input.lineUserId || null, String(input.lineDisplayName || '').slice(0, 100),
      input.lineUserId ? now : null,
      input.source || 'web', now, now,
    );
    return getReservation(id);
  });
}

function uniqueWatchToken() {
  for (let i = 0; i < 5; i++) {
    const token = randomToken(18);
    if (!get('SELECT 1 AS x FROM reservations WHERE watch_token = ?', token)) return token;
  }
  throw new ReservationError('token_conflict', '受付に失敗しました。もう一度お試しください');
}

function uniqueLinkCode() {
  for (let len = 6; len <= 8; len++) {
    for (let i = 0; i < 12; i++) {
      const code = randomCode(len);
      if (!get('SELECT 1 AS x FROM reservations WHERE link_code = ?', code)) return code;
    }
  }
  throw new ReservationError('code_conflict', '受付に失敗しました。もう一度お試しください');
}

/**
 * 予約とLINEユーザーを紐付ける。これが済んで初めてリマインドを送れる。
 * @returns {{ok:boolean, reason?:string, reservation?:object}}
 */
export function linkLineUser(code, lineUserId, displayName, now = Date.now()) {
  return tx(() => {
    const reservation = getByLinkCode(code);
    if (!reservation) return { ok: false, reason: 'not_found' };
    if (reservation.status !== 'active') return { ok: false, reason: 'canceled' };
    if (reservation.line_user_id && reservation.line_user_id !== lineUserId) {
      return { ok: false, reason: 'already_linked_other' };
    }
    if (reservation.line_user_id === lineUserId) {
      return { ok: true, already: true, reservation };
    }
    // 同じ人が同じ枠を別コードで二重予約していないか
    const dup = get(
      `SELECT id FROM reservations WHERE session_id = ? AND line_user_id = ? AND status = 'active' AND id != ?`,
      reservation.session_id, lineUserId, reservation.id,
    );
    if (dup) return { ok: false, reason: 'duplicate' };

    run(
      `UPDATE reservations SET line_user_id = ?, line_display_name = ?, linked_at = ?, updated_at = ? WHERE id = ?`,
      lineUserId, String(displayName || '').slice(0, 100), now, now, reservation.id,
    );
    return { ok: true, reservation: getReservation(reservation.id) };
  });
}

export function cancelReservation(id, now = Date.now()) {
  run(`UPDATE reservations SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'active'`, now, id);
  return getReservation(id);
}

export function recordWatchEvent({ reservationId, sessionId, kind, atSec }, now = Date.now()) {
  run('INSERT INTO watch_events (reservation_id, session_id, kind, at_sec, created_at) VALUES (?,?,?,?,?)',
    reservationId, sessionId, kind, Math.max(0, Math.round(Number(atSec) || 0)), now);
}

export function addQuestion({ reservationId, sessionId, body, atSec }, now = Date.now()) {
  const trimmed = String(body || '').trim().slice(0, 1000);
  if (!trimmed) return null;
  run('INSERT INTO questions (reservation_id, session_id, body, at_sec, created_at) VALUES (?,?,?,?,?)',
    reservationId, sessionId, trimmed, Math.max(0, Math.round(Number(atSec) || 0)), now);
  return trimmed;
}

/** 視聴の到達状況（管理画面の分析用） */
export function watchSummary(reservationId) {
  const row = get(
    `SELECT MIN(created_at) AS first_at, MAX(created_at) AS last_at,
            MAX(at_sec) AS max_sec, COUNT(*) AS events,
            SUM(CASE WHEN kind = 'cta_click' THEN 1 ELSE 0 END) AS cta_clicks
       FROM watch_events WHERE reservation_id = ?`, reservationId);
  if (!row || !row.events) return null;
  return row;
}
