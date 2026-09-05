import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';
import {
  planJobs, syncJobs, cancelJobs, dueJobs, markSent, markFailure,
  RETRY_BACKOFF_MS, MAX_ATTEMPTS,
} from '../src/domain/notifications.js';
import { createWebinar } from '../src/domain/webinars.js';
import { createSession } from '../src/domain/sessions.js';
import { createReservation, linkLineUser, cancelReservation } from '../src/domain/reservations.js';
import { all, get } from '../src/db.js';
import { parseJstLocal, HOUR, MINUTE, DAY } from '../src/lib/time.js';

const START = parseJstLocal('2026-09-10T20:00');
const ALL_ON = { confirm: true, remind_1d: true, watch_link_3h: true, remind_10m: true, start: false, followup: false };
const byKind = (jobs) => Object.fromEntries(jobs.map((j) => [j.kind, j]));

test('十分前に予約すると、3時間前ちょうどに視聴リンクが積まれる', () => {
  const now = START - 5 * DAY;
  const jobs = byKind(planJobs({ startAt: START, durationSec: 3600 }, now, ALL_ON));
  assert.equal(jobs.watch_link_3h.scheduledAt, START - 3 * HOUR);
  assert.equal(jobs.watch_link_3h.status, 'pending');
  assert.equal(jobs.remind_1d.scheduledAt, START - DAY);
  assert.equal(jobs.remind_10m.scheduledAt, START - 10 * MINUTE);
  assert.equal(jobs.confirm.scheduledAt, now, '予約完了通知はすぐ送る');
});

test('3時間を切って予約した場合は、視聴リンクを即時送信に繰り上げる', () => {
  const now = START - 90 * MINUTE;
  const jobs = byKind(planJobs({ startAt: START, durationSec: 3600 }, now, ALL_ON));
  assert.equal(jobs.watch_link_3h.scheduledAt, now, '過去の予定時刻は「今すぐ」に繰り上がる');
  assert.equal(jobs.watch_link_3h.status, 'pending');
  assert.equal(jobs.remind_1d.status, 'skipped', '前日リマインドはもう意味がないので送らない');
});

test('開始後に予約しても、配信中なら視聴リンクは届く', () => {
  const now = START + 20 * MINUTE;
  const jobs = byKind(planJobs({ startAt: START, durationSec: 3600 }, now, ALL_ON));
  assert.equal(jobs.watch_link_3h.status, 'pending');
  assert.equal(jobs.remind_10m.status, 'skipped', '10分前リマインドは期限切れ');
});

test('終了後に予約しても、視聴リンクは送らない', () => {
  const now = START + 2 * HOUR;
  const jobs = byKind(planJobs({ startAt: START, durationSec: 3600 }, now, ALL_ON));
  assert.equal(jobs.watch_link_3h.status, 'skipped');
});

test('無効にした種類の通知は積まれない', () => {
  const jobs = planJobs({ startAt: START, durationSec: 3600 }, START - DAY * 2,
    { ...ALL_ON, remind_1d: false, remind_10m: false });
  assert.deepEqual(jobs.map((j) => j.kind), ['confirm', 'watch_link_3h']);
});

// ---- DBを使う結合テスト ----

function scenario(now, startAt = START) {
  const w = createWebinar({ title: 'テスト説明会', video_url: 'file:a.mp4', duration_sec: 3600 }, now);
  const s = createSession({ webinarId: w.id, startAt }, now);
  const r = createReservation({ sessionId: s.id, name: 'テスト太郎' }, now);
  return { webinar: w, session: s, reservation: r };
}

beforeEach(() => freshDb());

test('LINE未連携のうちは通知を積まない（送る手段が無いため）', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  syncJobs(reservation.id, now);
  assert.equal(all('SELECT * FROM notification_jobs').length, 0);
});

test('LINE連携した時点で通知予定が作られる', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  const result = linkLineUser(reservation.link_code, 'U_1', 'テスト', now);
  assert.equal(result.ok, true);
  syncJobs(reservation.id, now);

  const jobs = byKind(all('SELECT * FROM notification_jobs'));
  assert.ok(jobs.watch_link_3h, '視聴リンクの通知が積まれている');
  assert.equal(jobs.watch_link_3h.scheduled_at, START - 3 * HOUR);
});

test('syncJobs を何度呼んでも通知は重複しない', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  for (let i = 0; i < 5; i++) syncJobs(reservation.id, now + i);
  const kinds = all('SELECT kind FROM notification_jobs').map((j) => j.kind);
  assert.equal(new Set(kinds).size, kinds.length, '同じ種類が二重に積まれていない');
});

test('送信済みの通知は再スケジュールで巻き戻らない', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  syncJobs(reservation.id, now);

  const job = get(`SELECT id FROM notification_jobs WHERE kind='watch_link_3h'`);
  markSent(job.id, now);
  syncJobs(reservation.id, now + 1000);
  assert.equal(get('SELECT status FROM notification_jobs WHERE id=?', job.id).status, 'sent');
});

test('予約をキャンセルすると未送信の通知が止まる', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  syncJobs(reservation.id, now);

  cancelReservation(reservation.id, now);
  cancelJobs(reservation.id);
  const statuses = all('SELECT status FROM notification_jobs').map((j) => j.status);
  assert.ok(statuses.every((s) => s === 'canceled'), `全て取消: ${statuses}`);
  assert.equal(dueJobs(START).length, 0);
});

test('送信時刻が来た通知だけが取り出される', () => {
  const now = START - 3 * DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  syncJobs(reservation.id, now);

  const atLinkTime = dueJobs(now).map((j) => j.kind);
  assert.deepEqual(atLinkTime, ['confirm'], '連携直後は予約完了通知だけ');

  const oneDayBefore = dueJobs(START - DAY).map((j) => j.kind);
  assert.ok(oneDayBefore.includes('remind_1d'), '前日になったら前日リマインドが対象になる');
  assert.ok(!oneDayBefore.includes('watch_link_3h'), '視聴リンクはまだ対象外');

  const threeHoursBefore = dueJobs(START - 3 * HOUR).map((j) => j.kind);
  assert.ok(threeHoursBefore.includes('watch_link_3h'), '3時間前になったら視聴リンクが対象になる');
  assert.ok(!threeHoursBefore.includes('remind_10m'), '10分前リマインドはまだ対象外');
});

test('失敗した通知は指数バックオフで再試行し、規定回数で打ち切る', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  syncJobs(reservation.id, now);

  let job = dueJobs(now)[0];
  for (let i = 0; i < RETRY_BACKOFF_MS.length; i++) {
    const { retryAt } = markFailure(job, '一時的なエラー', now);
    assert.equal(retryAt, now + RETRY_BACKOFF_MS[i], `${i + 1}回目の再試行間隔`);
    job = get('SELECT * FROM notification_jobs WHERE id=?', job.id);
    assert.equal(job.status, 'pending');
  }
  const last = markFailure(job, '一時的なエラー', now);
  assert.equal(last.retryAt, null);
  assert.equal(last.attempts, MAX_ATTEMPTS);
  assert.equal(get('SELECT status FROM notification_jobs WHERE id=?', job.id).status, 'failed');
});

test('恒久的なエラー（ブロック等）は即座に打ち切る', () => {
  const now = START - DAY;
  const { reservation } = scenario(now);
  linkLineUser(reservation.link_code, 'U_1', '', now);
  syncJobs(reservation.id, now);

  const job = dueJobs(now)[0];
  const result = markFailure(job, 'ブロックされています', now, { permanent: true });
  assert.equal(result.retryAt, null);
  assert.equal(get('SELECT status FROM notification_jobs WHERE id=?', job.id).status, 'failed');
});
