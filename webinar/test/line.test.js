import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';
import { verifySignature, signBody } from '../src/line/signature.js';
import { codeCandidates } from '../src/lib/ids.js';
import { sign, unsign, timingSafeEqual } from '../src/lib/crypto.js';
import { buildMessage, buildContext, welcomeMessage } from '../src/line/messages.js';
import { handleEvents } from '../src/line/webhook.js';
import { createWebinar } from '../src/domain/webinars.js';
import { createSession } from '../src/domain/sessions.js';
import { createReservation } from '../src/domain/reservations.js';
import { all, get } from '../src/db.js';
import { parseJstLocal, HOUR, DAY } from '../src/lib/time.js';

const SECRET = 'test-channel-secret';
const START = parseJstLocal('2026-09-10T20:00');

test('署名が一致するリクエストだけを受け付ける', async () => {
  const body = new TextEncoder().encode(JSON.stringify({ events: [] }));
  const sig = await signBody(body, SECRET);
  assert.equal(await verifySignature(body, sig, SECRET), true);
  assert.equal(await verifySignature(body, sig, '別のシークレット'), false, 'シークレットが違えば拒否');
  assert.equal(await verifySignature(new TextEncoder().encode('改ざん'), sig, SECRET), false, '本文が変わっていれば拒否');
  assert.equal(await verifySignature(body, '', SECRET), false, '署名なしは拒否');
  assert.equal(await verifySignature(body, sig, ''), false, 'シークレット未設定なら拒否');
});

test('メッセージ本文から予約コードを拾う（全角・前後の文章込み）', () => {
  assert.ok(codeCandidates('予約コード ABC234').includes('ABC234'));
  assert.ok(codeCandidates('ＡＢＣ２３４').includes('ABC234'));
  assert.ok(codeCandidates('abc234 です').includes('ABC234'));
  assert.equal(codeCandidates('こんにちは').length, 0);
});

test('紛らわしい文字（0とO、1とI）の打ち間違いを吸収する', () => {
  const candidates = codeCandidates('ABC1O0');
  assert.ok(candidates.includes('ABC100'), '0/O の解釈違いを候補に含む');
  assert.ok(candidates.includes('ABCIOO'), 'I/1 の解釈違いを候補に含む');
});

test('署名付きCookieの改ざんを検出する', async () => {
  const signed = await sign('12345', 'secret');
  assert.equal(await unsign(signed, 'secret'), '12345');
  assert.equal(await unsign(signed.replace('12345', '99999'), 'secret'), null);
  assert.equal(await unsign(signed, 'other-secret'), null);
  assert.equal(await unsign('でたらめ', 'secret'), null);
});

test('パスワード照合は長さが違っても例外を出さない', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcdef'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('3時間前の通知に、視聴ページのボタンが入っている', () => {
  const ctx = buildContext({
    watch_token: 'TOKEN123', name: '山田太郎', title: 'テスト説明会',
    start_at: START, duration_sec: 2700,
  });
  const message = buildMessage('watch_link_3h', ctx, START - 3 * HOUR);
  assert.equal(message.type, 'flex');
  assert.match(message.altText, /視聴リンク/);

  const buttons = message.contents.footer.contents.map((b) => b.action.uri);
  assert.ok(buttons.some((u) => u === 'https://webinar.test/watch/TOKEN123'), '視聴URLのボタンがある');

  const bodyText = JSON.stringify(message.contents.body);
  assert.match(bodyText, /Zoom/, 'Zoom不要であることを伝えている');
});

test('公開URLがhttpsでないときはFlexをやめ、URL入りテキストに退避する', async () => {
  // LINEは https 以外のURLを持つFlexを拒否するため、通知が消えないよう退避させる
  const { config } = await import('../src/config.js');
  const original = config.baseUrl;
  config.baseUrl = 'http://localhost:3000';
  try {
    const ctx = buildContext({ watch_token: 'T', name: 'x', title: 't', start_at: START, duration_sec: 60 });
    const message = buildMessage('watch_link_3h', ctx, START - 3 * HOUR);
    assert.equal(message.type, 'text');
    assert.match(message.text, /http:\/\/localhost:3000\/watch\/T/);
  } finally {
    config.baseUrl = original;
  }
});

test('通知の種類ごとにメッセージを作れる', () => {
  const ctx = buildContext({ watch_token: 'T', name: '太郎', title: '説明会', start_at: START, duration_sec: 3600 });
  for (const kind of ['confirm', 'remind_1d', 'watch_link_3h', 'remind_10m', 'start', 'followup']) {
    const m = buildMessage(kind, ctx, START - DAY);
    assert.ok(m.type === 'flex' || m.type === 'text', `${kind} のメッセージが作れる`);
  }
  assert.throws(() => buildMessage('存在しない種類', ctx), /未知の通知種別/);
});

// ---- Webhook 経由の連携 ----

beforeEach(() => freshDb());

async function makeReservation(now) {
  const w = await createWebinar({ title: 'テスト説明会', video_url: 'file:a.mp4', duration_sec: 3600 }, now);
  const s = await createSession({ webinarId: w.id, startAt: START }, now);
  return createReservation({ sessionId: s.id, name: 'テスト太郎' }, now);
}

const textEvent = (text, { userId = 'U_1', eventId = 'evt_1' } = {}) => ({
  type: 'message', webhookEventId: eventId, replyToken: 'rt',
  source: { type: 'user', userId },
  message: { type: 'text', id: 'm1', text },
});

test('予約コードを送るとLINEと紐づき、通知予定が作られる', async () => {
  const now = START - DAY;
  const reservation = await makeReservation(now);

  await handleEvents([textEvent(`予約コード ${reservation.link_code}`)], now);

  const after = await get('SELECT line_user_id FROM reservations WHERE id = ?', reservation.id);
  assert.equal(after.line_user_id, 'U_1');

  const kinds = (await all('SELECT kind FROM notification_jobs')).map((j) => j.kind);
  assert.ok(kinds.includes('watch_link_3h'), '3時間前の視聴リンクが積まれている');
});

test('同じイベントが再送されても二重に処理しない', async () => {
  const now = START - DAY;
  const reservation = await makeReservation(now);
  const event = textEvent(`${reservation.link_code}`, { eventId: 'evt_same' });

  await handleEvents([event], now);
  await handleEvents([event], now);

  const replies = await all(`SELECT * FROM outbound_log WHERE kind LIKE 'linked%'`);
  assert.equal(replies.length, 1, '返信は1回だけ');
});

test('存在しないコードには「確認できません」と返す', async () => {
  await handleEvents([textEvent('ZZZZZZ')], START - DAY);
  const logs = await all('SELECT kind FROM outbound_log');
  assert.ok(logs.some((l) => l.kind.startsWith('code_not_found')), `実際: ${JSON.stringify(logs)}`);
});

test('他人が連携済みのコードは横取りできない', async () => {
  const now = START - DAY;
  const reservation = await makeReservation(now);
  await handleEvents([textEvent(reservation.link_code, { userId: 'U_first', eventId: 'e1' })], now);
  await handleEvents([textEvent(reservation.link_code, { userId: 'U_second', eventId: 'e2' })], now);

  assert.equal((await get('SELECT line_user_id FROM reservations WHERE id=?', reservation.id)).line_user_id, 'U_first');
  assert.ok((await all('SELECT kind FROM outbound_log')).some((l) => l.kind.startsWith('link_already_linked_other')));
});

test('ブロック（友だち解除）されたら送信対象から外す', async () => {
  const now = START - DAY;
  await handleEvents([{ type: 'follow', webhookEventId: 'f1', replyToken: 'rt', source: { userId: 'U_x' } }], now);
  assert.equal((await get('SELECT followed FROM line_users WHERE user_id=?', 'U_x')).followed, 1);

  await handleEvents([{ type: 'unfollow', webhookEventId: 'u1', source: { userId: 'U_x' } }], now);
  assert.equal((await get('SELECT followed FROM line_users WHERE user_id=?', 'U_x')).followed, 0);

  const { canPushTo } = await import('../src/line/webhook.js');
  assert.equal(await canPushTo('U_x'), false);
});

test('「予約」と送ると日程を案内する', async () => {
  const now = START - DAY;
  await makeReservation(now);
  await handleEvents([textEvent('予約したい')], now);
  assert.ok((await all('SELECT kind FROM outbound_log')).some((l) => l.kind.startsWith('session_list')));
});

test('雑談には自動返信せず、担当者が対応できる状態にする', async () => {
  await handleEvents([textEvent('今日はいい天気ですね。担当の方はいらっしゃいますか')], START - DAY);
  assert.equal((await all('SELECT * FROM outbound_log')).length, 0);
});

test('友だち追加時に案内を返す', async () => {
  await handleEvents([{ type: 'follow', webhookEventId: 'f2', replyToken: 'rt', source: { userId: 'U_new' } }], START - DAY);
  assert.ok((await all('SELECT kind FROM outbound_log')).some((l) => l.kind.startsWith('follow')));
  assert.ok(welcomeMessage());
});
