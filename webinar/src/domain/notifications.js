// 通知のスケジューリング（アウトボックス方式）。
// 予約が確定した時点で「いつ・何を送るか」をDBに積んでおき、
// ワーカーが期限の来たものを順に送る。プロセスが落ちても予定は消えない。

import { all, get, run } from '../db.js';
import { config } from '../config.js';
import { HOUR, MINUTE, DAY } from '../lib/time.js';

/**
 * 通知の種類。offset は開催時刻からの相対時間（負=前）。
 * deadline を過ぎたものは送らずに skipped にする（深夜に前日リマインドが飛ぶ等を防ぐ）。
 */
export const JOB_KINDS = {
  confirm: {
    label: '予約完了',
    offset: () => null,                       // null = 予約した瞬間に送る
    deadline: ({ endAt }) => endAt,
  },
  remind_1d: {
    label: '前日リマインド',
    offset: ({ startAt }) => startAt - DAY,
    deadline: ({ startAt }) => startAt - 3 * HOUR, // 3時間前の本命通知に任せる
  },
  // ★本システムの中核。開催当日の3時間前に視聴リンクを送る。
  watch_link_3h: {
    label: '視聴リンク（3時間前）',
    offset: ({ startAt }) => startAt - 3 * HOUR,
    deadline: ({ endAt }) => endAt,            // 開始後でも配信中なら送る価値がある
  },
  remind_10m: {
    label: '直前リマインド（10分前）',
    offset: ({ startAt }) => startAt - 10 * MINUTE,
    deadline: ({ startAt }) => startAt + 10 * MINUTE,
  },
  start: {
    label: '開始通知',
    offset: ({ startAt }) => startAt,
    deadline: ({ startAt }) => startAt + 15 * MINUTE,
  },
  followup: {
    label: 'フォローアップ',
    offset: ({ endAt }) => endAt + 30 * MINUTE,
    deadline: ({ endAt }) => endAt + DAY,
  },
};

export const JOB_ORDER = ['confirm', 'remind_1d', 'watch_link_3h', 'remind_10m', 'start', 'followup'];

/** 送信失敗時の再試行間隔。使い切ったら failed。 */
export const RETRY_BACKOFF_MS = [30 * 1000, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE];
export const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;

/**
 * 送るべきジョブの一覧を組み立てる純粋関数。
 * @param {{startAt:number, durationSec:number}} session
 * @param {number} now
 * @param {object} [enabled] 種類ごとのON/OFF（既定は config.notify）
 * @returns {Array<{kind:string, scheduledAt:number, deadlineAt:number, status:string}>}
 */
export function planJobs(session, now, enabled = config.notify) {
  const startAt = Number(session.startAt);
  const endAt = startAt + Math.max(0, Number(session.durationSec) || 0) * 1000;
  const ctx = { startAt, endAt };
  const jobs = [];

  for (const kind of JOB_ORDER) {
    if (!enabled[kind]) continue;
    const spec = JOB_KINDS[kind];
    const rawOffset = spec.offset(ctx);
    const deadlineAt = spec.deadline(ctx);
    // 予定時刻が過去なら「今すぐ」に繰り上げる（開催直前の駆け込み予約でも視聴リンクが届く）
    const scheduledAt = rawOffset === null ? now : Math.max(rawOffset, now);
    const status = now > deadlineAt ? 'skipped' : 'pending';
    jobs.push({ kind, scheduledAt, deadlineAt, status });
  }
  return jobs;
}

/**
 * 予約に対する通知予定をDBへ反映する（何度呼んでも安全）。
 * LINE未連携の間は送る手段が無いので積まない。連携された時点で呼び直す。
 */
export function syncJobs(reservationId, now) {
  const res = get(
    `SELECT r.id, r.status, r.line_user_id, s.start_at, w.duration_sec
       FROM reservations r
       JOIN sessions s ON s.id = r.session_id
       JOIN webinars w ON w.id = s.webinar_id
      WHERE r.id = ?`,
    reservationId,
  );
  if (!res) return [];
  if (res.status !== 'active' || !res.line_user_id) {
    cancelJobs(reservationId);
    return [];
  }

  const jobs = planJobs({ startAt: res.start_at, durationSec: res.duration_sec }, now);
  for (const job of jobs) {
    run(
      `INSERT INTO notification_jobs
         (reservation_id, kind, scheduled_at, deadline_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(reservation_id, kind) DO UPDATE SET
         scheduled_at = excluded.scheduled_at,
         deadline_at  = excluded.deadline_at,
         status       = excluded.status,
         updated_at   = excluded.updated_at
       WHERE notification_jobs.status IN ('pending', 'skipped', 'canceled')`,
      reservationId, job.kind, job.scheduledAt, job.deadlineAt, job.status, now, now,
    );
  }
  return jobs;
}

/** 予約キャンセル時など。未送信のジョブを止める。 */
export function cancelJobs(reservationId) {
  run(
    `UPDATE notification_jobs SET status = 'canceled', updated_at = ?
      WHERE reservation_id = ? AND status IN ('pending', 'skipped', 'failed')`,
    Date.now(), reservationId,
  );
}

/** 送信すべきジョブを取り出す（配信対象の情報を結合して返す） */
export function dueJobs(now, limit = 50) {
  return all(
    `SELECT j.*, r.watch_token, r.link_code, r.name, r.line_user_id, r.status AS reservation_status,
            s.id AS session_id, s.start_at, s.status AS session_status,
            w.title, w.duration_sec
       FROM notification_jobs j
       JOIN reservations r ON r.id = j.reservation_id
       JOIN sessions s     ON s.id = r.session_id
       JOIN webinars w     ON w.id = s.webinar_id
      WHERE j.status = 'pending' AND j.scheduled_at <= ?
      ORDER BY j.scheduled_at ASC, j.id ASC
      LIMIT ?`,
    now, limit,
  );
}

export function markSent(jobId, now) {
  run(`UPDATE notification_jobs SET status='sent', sent_at=?, updated_at=?, last_error='' WHERE id=?`, now, now, jobId);
}

export function markSkipped(jobId, reason, now) {
  run(`UPDATE notification_jobs SET status='skipped', last_error=?, updated_at=? WHERE id=?`, reason, now, jobId);
}

/**
 * 送信失敗の記録。一時的なエラーなら指数バックオフで再試行、
 * 恒久的なエラー（ブロック済み等）は即 failed。
 */
export function markFailure(job, error, now, { permanent = false } = {}) {
  const attempts = job.attempts + 1;
  const message = String(error).slice(0, 500);
  if (permanent || attempts >= MAX_ATTEMPTS) {
    run(`UPDATE notification_jobs SET status='failed', attempts=?, last_error=?, updated_at=? WHERE id=?`,
      attempts, message, now, job.id);
    return { retryAt: null, attempts };
  }
  const retryAt = now + RETRY_BACKOFF_MS[attempts - 1];
  run(`UPDATE notification_jobs SET status='pending', attempts=?, last_error=?, scheduled_at=?, updated_at=? WHERE id=?`,
    attempts, message, retryAt, now, job.id);
  return { retryAt, attempts };
}

/** 管理画面から手動で再送する */
export function requeue(jobId, now) {
  run(`UPDATE notification_jobs SET status='pending', attempts=0, last_error='', scheduled_at=?, updated_at=?
        WHERE id=? AND status IN ('failed','skipped','sent')`, now, now, jobId);
}
