// 予約 → LINE連携 → 3時間前の視聴リンク送信 → 視聴 までを、
// 時計を進めながら実際のHTTPサーバー越しに通しで確認する。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const MEDIA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'webinar-media-'));
fs.writeFileSync(path.join(MEDIA_DIR, 'test.mp4'), Buffer.alloc(50_000, 7));
process.env.MEDIA_DIR = MEDIA_DIR;

const { freshDb, clock, startTestServer, form, formHeaders } = await import('./helpers.js');
const { createWebinar } = await import('../src/domain/webinars.js');
const { createSession } = await import('../src/domain/sessions.js');
const { runOnce } = await import('../src/worker.js');
const { signBody } = await import('../src/line/signature.js');
const { all, get } = await import('../src/db.js');
const { parseJstLocal, HOUR, MINUTE, DAY } = await import('../src/lib/time.js');

const START = parseJstLocal('2026-09-10T20:00');
let server;

before(async () => { server = await startTestServer(); });
after(async () => {
  await server.close();
  clock.setNow(null);
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
});

beforeEach(() => { freshDb(); clock.setNow(START - 5 * DAY); });

/** 説明会と開催枠を用意する */
async function setup({ capacity = 0, durationSec = 3600 } = {}) {
  const now = clock.now();
  const webinar = await createWebinar({
    title: 'オンライン説明会', video_url: 'file:test.mp4', duration_sec: durationSec,
    cta_label: '無料相談を申し込む', cta_url: 'https://lin.ee/example', cta_at_sec: 1800,
  }, now);
  return createSession({ webinarId: webinar.id, startAt: START, capacity }, now);
}

/** 予約フォームを送信して、予約トークンと連携コードを取り出す */
async function reserve(session, name = '山田太郎') {
  const res = await server.post('/reserve',
    form({ session_id: session.id, name, email: 'test@example.com', agree: '1' }), formHeaders);
  assert.equal(res.status, 303, '予約が受理される');
  const token = res.headers.get('location').split('/').pop();
  const code = (await get('SELECT link_code FROM reservations WHERE watch_token = ?', token)).link_code;
  return { token, code };
}

/** 署名付きでWebhookを叩く */
async function webhook(events) {
  const body = JSON.stringify({ destination: 'x', events });
  const signature = await signBody(new TextEncoder().encode(body), 'test-channel-secret');
  // Node アダプタでは waitUntil が無く、応答前に処理が完了している
  return fetch(server.base + '/line/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': signature },
    body,
  });
}

const linkEvent = (code, userId = 'U_e2e') => ([{
  type: 'message', webhookEventId: `evt_${code}_${userId}`, replyToken: 'rt',
  source: { type: 'user', userId }, message: { type: 'text', id: 'm', text: `予約コード ${code}` },
}]);

// ---------------------------------------------------------------------------

test('予約サイトに開催枠が並ぶ', async () => {
  await setup();
  const html = await (await server.get('/')).text();
  assert.match(html, /オンライン説明会/);
  assert.match(html, /2026年9月10日\(木\) 20:00/);
  assert.match(html, /Zoomのインストールは不要/);
});

test('通し: 予約 → LINE連携 → 3時間前に視聴リンク → 開始時刻に再生 → 終了', async () => {
  const session = await setup();

  // 1. 予約する
  const { token, code } = await reserve(session);
  const thanks = await (await server.get(`/thanks/${token}`)).text();
  assert.match(thanks, new RegExp(code), '予約完了ページに連携コードが出る');
  assert.match(thanks, /line\.me\/R\/oaMessage/, '1タップで連携できるLINEリンクがある');

  // 2. LINEで連携コードを送る
  await webhook(linkEvent(code));
  assert.equal((await get('SELECT line_user_id FROM reservations WHERE watch_token=?', token)).line_user_id, 'U_e2e');

  // 3. 開始4時間前 … まだ視聴リンクは送らない
  clock.setNow(START - 4 * HOUR);
  await runOnce(clock.now());
  assert.equal((await get(`SELECT status FROM notification_jobs WHERE kind='watch_link_3h'`)).status, 'pending');

  // 4. 開始3時間前 … 視聴リンクが届く（本システムの中核）
  clock.setNow(START - 3 * HOUR);
  const stats = await runOnce(clock.now());
  assert.ok(stats.sent >= 1);
  assert.equal((await get(`SELECT status FROM notification_jobs WHERE kind='watch_link_3h'`)).status, 'sent');

  const sentPayload = (await get(`SELECT payload FROM outbound_log WHERE kind LIKE 'watch_link_3h%'`)).payload;
  assert.match(sentPayload, new RegExp(`/watch/${token}`), '通知に視聴ページのURLが入っている');

  // 5. 開始前に視聴ページを開くとカウントダウン。動画はまだ渡さない。
  const waiting = await (await server.get(`/watch/${token}`)).text();
  assert.match(waiting, /"state":"scheduled"/);
  assert.match(waiting, /"media":null/, '開始前に動画の在処を渡さない');
  assert.equal((await server.get(`/watch/${token}/media`)).status, 403, '開始前は動画を配信しない');

  // 6. 開始10分後 … 10分の位置から再生される
  clock.setNow(START + 10 * MINUTE);
  const live = await (await server.get(`/watch/${token}`)).text();
  assert.match(live, /"state":"live"/);
  assert.match(live, new RegExp(`"src":"/watch/${token}/media"`));

  const state = await (await server.post(`/watch/${token}/state`,
    JSON.stringify({ atSec: 600 }), { 'Content-Type': 'application/json' })).json();
  assert.equal(state.state, 'live');
  assert.equal(state.positionSec, 600, '開始10分後なら再生位置も600秒');
  assert.equal(state.seekable, false, '巻き戻し・早送りは不可');

  const media = await server.get(`/watch/${token}/media`);
  assert.equal(media.status, 200, '配信中は動画を配信する');

  // 7. 本編終了後 … 視聴できなくなる
  clock.setNow(START + 61 * MINUTE);
  const ended = await (await server.get(`/watch/${token}`)).text();
  assert.match(ended, /この回は終了しました/);
  assert.equal((await server.get(`/watch/${token}/media`)).status, 403);
});

test('開始3時間を切ってからの駆け込み予約でも、視聴リンクがすぐ届く', async () => {
  const session = await setup();
  clock.setNow(START - 40 * MINUTE);

  const { token, code } = await reserve(session, '駆け込み花子');
  await webhook(linkEvent(code, 'U_late'));

  const sent = await runOnce(clock.now());
  assert.ok(sent.sent >= 1);
  const link = await get(`SELECT status FROM notification_jobs WHERE kind='watch_link_3h'`);
  assert.equal(link.status, 'sent', '3時間前を過ぎていても即時送信される');
  assert.match(
    (await get(`SELECT payload FROM outbound_log WHERE kind LIKE 'watch_link_3h%'`)).payload,
    new RegExp(`/watch/${token}`),
  );
});

test('動画のRangeリクエストに対応する（途中からの読み込み・シークに必要）', async () => {
  const session = await setup();
  const { token, code } = await reserve(session);
  await webhook(linkEvent(code));
  clock.setNow(START + 5 * MINUTE);

  const res = await fetch(`${server.base}/watch/${token}/media`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 100-199/50000');
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('定員に達したら受け付けない', async () => {
  const session = await setup({ capacity: 1 });
  await reserve(session, '一人目');

  const res = await server.post('/reserve',
    form({ session_id: session.id, name: '二人目', agree: '1' }), formHeaders);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /満席/);
  assert.equal((await get('SELECT COUNT(*) c FROM reservations')).c, 1);
});

test('同意のチェックが無ければ受け付けない', async () => {
  const session = await setup();
  const res = await server.post('/reserve', form({ session_id: session.id, name: '未同意' }), formHeaders);
  assert.equal(res.status, 400);
  assert.equal((await get('SELECT COUNT(*) c FROM reservations')).c, 0);
});

test('中止した回の視聴ページは開けず、通知も止まる', async () => {
  const session = await setup();
  const { token, code } = await reserve(session);
  await webhook(linkEvent(code));

  const { setSessionStatus } = await import('../src/domain/sessions.js');
  await setSessionStatus(session.id, 'canceled');

  clock.setNow(START - 3 * HOUR);
  await runOnce(clock.now());
  assert.equal((await get(`SELECT status FROM notification_jobs WHERE kind='watch_link_3h'`)).status, 'skipped');

  clock.setNow(START + 5 * MINUTE);
  assert.match(await (await server.get(`/watch/${token}`)).text(), /中止/);
  assert.equal((await server.get(`/watch/${token}/media`)).status, 403);
});

test('利用者が予約をキャンセルすると通知が止まる', async () => {
  const session = await setup();
  const { token, code } = await reserve(session);
  await webhook(linkEvent(code));

  const res = await server.post(`/r/${token}/cancel`, '', formHeaders);
  assert.equal(res.status, 303);

  const statuses = (await all('SELECT status FROM notification_jobs')).map((j) => j.status);
  assert.ok(statuses.every((s) => s === 'canceled' || s === 'sent'), `実際: ${statuses}`);

  clock.setNow(START - 3 * HOUR);
  await runOnce(clock.now());
  assert.notEqual((await get(`SELECT status FROM notification_jobs WHERE kind='watch_link_3h'`)).status, 'sent');
});

test('存在しないトークンの視聴ページは404', async () => {
  const res = await server.get('/watch/deadbeef');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /視聴ページが見つかりません/);
});

test('外部サイトからのフォーム送信（CSRF）を拒否する', async () => {
  const session = await setup();
  const res = await fetch(server.base + '/reserve', {
    method: 'POST', redirect: 'manual',
    headers: { ...formHeaders, Origin: 'https://evil.example.com' },
    body: form({ session_id: session.id, name: '攻撃者', agree: '1' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await get('SELECT COUNT(*) c FROM reservations')).c, 0);
});

test('署名のないWebhookは受け付けない', async () => {
  const res = await fetch(server.base + '/line/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(res.status, 401);
});

test('管理画面はログインしないと見られない', async () => {
  const redirected = await server.get('/admin');
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('location'), '/admin/login');

  const bad = await server.post('/admin/login', form({ user: 'admin', pass: 'まちがい' }), formHeaders);
  assert.equal(bad.status, 401);

  const ok = await server.post('/admin/login', form({ user: 'admin', pass: 'test-password' }), formHeaders);
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie').split(';')[0];

  const dashboard = await server.get('/admin', { cookie });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /ダッシュボード/);
});

test('管理画面で予約とCSVを確認できる', async () => {
  const session = await setup();
  const { code } = await reserve(session, '確認 太郎');
  await webhook(linkEvent(code));

  const login = await server.post('/admin/login', form({ user: 'admin', pass: 'test-password' }), formHeaders);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const list = await (await server.get('/admin/reservations', { cookie })).text();
  assert.match(list, /確認 太郎/);
  assert.match(list, /連携済/);

  const csvRes = await server.get('/admin/reservations.csv', { cookie });
  const csvBytes = Buffer.from(await csvRes.arrayBuffer());
  // Response.text() は BOM を取り除いてしまうので、生バイトで確認する
  assert.deepEqual([...csvBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'Excel向けにBOMを付ける');
  assert.match(csvBytes.toString('utf8'), /確認 太郎/);
  assert.match(csvRes.headers.get('content-disposition'), /attachment/);
});

test('視聴ログと質問が記録される', async () => {
  const session = await setup();
  const { token, code } = await reserve(session);
  await webhook(linkEvent(code));
  clock.setNow(START + 20 * MINUTE);

  await server.post(`/watch/${token}/event`, JSON.stringify({ kind: 'cta_click', atSec: 1200 }), { 'Content-Type': 'application/json' });
  await server.post(`/watch/${token}/question`, JSON.stringify({ body: '対象になりますか？', atSec: 1250 }), { 'Content-Type': 'application/json' });

  assert.equal((await get(`SELECT COUNT(*) c FROM watch_events WHERE kind='cta_click'`)).c, 1);
  assert.equal((await get('SELECT body FROM questions')).body, '対象になりますか？');

  const empty = await server.post(`/watch/${token}/question`, JSON.stringify({ body: '   ' }), { 'Content-Type': 'application/json' });
  assert.equal(empty.status, 400, '空の質問は保存しない');
});
