// 「会場」のテスト。人数・入室・コメント・投票がすべて実データであることを確かめる。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';
import {
  displayNameFor, touchPresence, countPresent, recentJoins, roomSnapshot,
  postMessage, messagesSince, recentMessages, hideMessage,
  parsePollsText, pollsToText, replacePolls, listPolls, parsePollOptions,
  activePoll, vote, pollTally, myVote, cleanupPresence,
  ChatError, PRESENCE_WINDOW_MS, PRESENCE_REFRESH_MS, CHAT_COOLDOWN_MS,
} from '../src/domain/room.js';
import { createWebinar } from '../src/domain/webinars.js';
import { createSession } from '../src/domain/sessions.js';
import { createReservation } from '../src/domain/reservations.js';
import { parseJstLocal } from '../src/lib/time.js';

const START = parseJstLocal('2026-09-10T20:00');
let ctx;

beforeEach(async () => {
  freshDb();
  const webinar = await createWebinar({ title: '説明会', video_url: 'youtube:x', duration_sec: 3600 }, START);
  const session = await createSession({ webinarId: webinar.id, startAt: START }, START);
  const people = [];
  for (const name of ['山田 太郎', '佐藤 花子', '鈴木 一郎']) {
    people.push(await createReservation({ sessionId: session.id, name }, START));
  }
  ctx = { webinar, session, people };
});

const join = (person, now) => touchPresence({
  sessionId: ctx.session.id, reservationId: person.id, displayName: displayNameFor(person.name),
}, now);

test('表示名は姓だけにする（フルネームを他の参加者に見せない）', () => {
  assert.equal(displayNameFor('山田 太郎'), '山田さん');
  assert.equal(displayNameFor('田中　花子'), '田中さん');
  assert.equal(displayNameFor('佐藤'), '佐藤さん');
  assert.equal(displayNameFor(''), 'ゲスト');
});

test('会場にいる人数は実際に開いている人の数', async () => {
  assert.equal(await countPresent(ctx.session.id, START), 0);

  assert.equal((await join(ctx.people[0], START)).firstTime, true, '初回は入室扱い');
  assert.equal((await join(ctx.people[0], START + 1000)).firstTime, false, '2回目は入室扱いにしない');
  assert.equal(await countPresent(ctx.session.id, START + 1000), 1);

  await join(ctx.people[1], START + 2000);
  assert.equal(await countPresent(ctx.session.id, START + 2000), 2);

  // 一定時間が過ぎた人は数に入らない
  assert.equal(await countPresent(ctx.session.id, START + PRESENCE_WINDOW_MS + 5000), 0);
});

test('在室の書き込みは間引く（無料枠の書き込み回数を守る）', async () => {
  await join(ctx.people[0], START);
  const seen = async () => (await import('../src/db.js')).get(
    'SELECT last_seen FROM room_presence WHERE reservation_id = ?', ctx.people[0].id,
  );

  await join(ctx.people[0], START + 5000);
  assert.equal((await seen()).last_seen, START, '間隔が短いうちは書き込まない');

  await join(ctx.people[0], START + PRESENCE_REFRESH_MS + 100);
  assert.equal((await seen()).last_seen, START + PRESENCE_REFRESH_MS + 100, '間隔が空いたら更新する');
});

test('自分より後に入ってきた人だけが入室通知になる', async () => {
  await join(ctx.people[0], START);
  await join(ctx.people[1], START + 5000);
  await join(ctx.people[2], START + 6000);

  const joins = await recentJoins(ctx.session.id, START + 1000, ctx.people[0].id);
  assert.deepEqual(joins.map((j) => j.name), ['佐藤さん', '鈴木さん']);

  const forLate = await recentJoins(ctx.session.id, START + 5500, ctx.people[0].id);
  assert.deepEqual(forLate.map((j) => j.name), ['鈴木さん'], 'それ以降に入った人だけ');

  const self = await recentJoins(ctx.session.id, START - 1, ctx.people[1].id);
  assert.ok(!self.some((j) => j.name === '佐藤さん'), '自分の入室は通知しない');
});

test('少人数のときは人数を出さない（出すと逆に寂しいため）', async () => {
  await join(ctx.people[0], START);
  let snap = await roomSnapshot({ sessionId: ctx.session.id, reservationId: ctx.people[0].id, minViewersShown: 3 }, START);
  assert.equal(snap.viewers, 1);
  assert.equal(snap.showViewers, false);

  await join(ctx.people[1], START);
  await join(ctx.people[2], START);
  snap = await roomSnapshot({ sessionId: ctx.session.id, reservationId: ctx.people[0].id, minViewersShown: 3 }, START);
  assert.equal(snap.viewers, 3);
  assert.equal(snap.showViewers, true);
});

test('コメントは実際の参加者の発言として記録される', async () => {
  const saved = await postMessage({
    sessionId: ctx.session.id, reservationId: ctx.people[0].id,
    displayName: displayNameFor(ctx.people[0].name), body: '  よろしく  お願いします  ',
  }, START);
  assert.equal(saved.body, 'よろしく お願いします', '空白は整理する');

  const list = await messagesSince(ctx.session.id, 0);
  assert.equal(list.length, 1);
  assert.equal(list[0].display_name, '山田さん');

  assert.equal((await messagesSince(ctx.session.id, saved.id)).length, 0, '取得済みは返さない');
});

test('空のコメントと連続投稿を弾く', async () => {
  const send = (body, now) => postMessage({
    sessionId: ctx.session.id, reservationId: ctx.people[0].id, displayName: '山田さん', body,
  }, now);

  await assert.rejects(() => send('   ', START), (e) => e instanceof ChatError && e.code === 'empty');

  await send('1回目', START);
  await assert.rejects(() => send('すぐ2回目', START + 500),
    (e) => e instanceof ChatError && e.code === 'too_fast');
  await send('時間をおいて', START + CHAT_COOLDOWN_MS + 100);
  assert.equal((await messagesSince(ctx.session.id, 0)).length, 2);
});

test('非表示にしたコメントは誰にも配られない', async () => {
  const a = await postMessage({ sessionId: ctx.session.id, reservationId: ctx.people[0].id, displayName: '山田さん', body: '通常' }, START);
  const b = await postMessage({ sessionId: ctx.session.id, reservationId: ctx.people[1].id, displayName: '佐藤さん', body: '消す' }, START);

  await hideMessage(b.id);
  const list = await messagesSince(ctx.session.id, 0);
  assert.deepEqual(list.map((m) => m.body), ['通常']);
  assert.deepEqual((await recentMessages(ctx.session.id)).map((m) => m.id), [a.id]);
});

test('入室直後は直近のコメントが見える（会場に人がいた形跡）', async () => {
  for (let i = 1; i <= 25; i++) {
    await postMessage({
      sessionId: ctx.session.id, reservationId: ctx.people[i % 3].id,
      displayName: '誰か', body: 'コメント' + i,
    }, START + i * CHAT_COOLDOWN_MS * 2);
  }
  const recent = await recentMessages(ctx.session.id, 20);
  assert.equal(recent.length, 20);
  assert.equal(recent[0].body, 'コメント6', '古い順に並ぶ');
  assert.equal(recent[19].body, 'コメント25');
});

test('投票は再生位置で決まるので全員に同じものが出る', async () => {
  await replacePolls(ctx.webinar.id, parsePollsText(
    '10:00 | いまのご状況は？ | 退職済み | 退職予定 | 検討中\n25:00..30:00 | 個別相談に興味は？ | はい | いいえ',
  ));
  const polls = await listPolls(ctx.webinar.id);
  assert.equal(polls.length, 2);
  assert.deepEqual(parsePollOptions(polls[0].options), ['退職済み', '退職予定', '検討中']);

  assert.equal(activePoll(polls, 300), null, '時刻前は出ない');
  assert.equal(activePoll(polls, 700).question, 'いまのご状況は？');
  assert.equal(activePoll(polls, 1400).question, 'いまのご状況は？', '次が始まるまで出続ける');
  assert.equal(activePoll(polls, 1600).question, '個別相談に興味は？', '次の投票に入れ替わる');
  assert.equal(activePoll(polls, 2000), null, '締切を過ぎたら出ない（前の投票に戻らない）');
});

test('投票の集計はその回の実際の回答だけ', async () => {
  await replacePolls(ctx.webinar.id, parsePollsText('10:00 | 状況は？ | A | B | C'));
  const poll = (await listPolls(ctx.webinar.id))[0];
  const options = parsePollOptions(poll.options);

  await vote({ pollId: poll.id, sessionId: ctx.session.id, reservationId: ctx.people[0].id, choice: 0 }, START);
  await vote({ pollId: poll.id, sessionId: ctx.session.id, reservationId: ctx.people[1].id, choice: 2 }, START);
  await vote({ pollId: poll.id, sessionId: ctx.session.id, reservationId: ctx.people[2].id, choice: 2 }, START);

  let result = await pollTally(poll.id, ctx.session.id, options.length);
  assert.deepEqual(result.tally, [1, 0, 2]);
  assert.equal(result.total, 3);
  assert.equal(await myVote(poll.id, ctx.session.id, ctx.people[1].id), 2);

  // 投票し直しても二重に数えない
  await vote({ pollId: poll.id, sessionId: ctx.session.id, reservationId: ctx.people[0].id, choice: 2 }, START + 1000);
  result = await pollTally(poll.id, ctx.session.id, options.length);
  assert.deepEqual(result.tally, [0, 0, 3]);
  assert.equal(result.total, 3);
});

test('別の回の投票は混ざらない', async () => {
  await replacePolls(ctx.webinar.id, parsePollsText('10:00 | 状況は？ | A | B'));
  const poll = (await listPolls(ctx.webinar.id))[0];
  const other = await createSession({ webinarId: ctx.webinar.id, startAt: START + 86400000 }, START);

  await vote({ pollId: poll.id, sessionId: ctx.session.id, reservationId: ctx.people[0].id, choice: 0 }, START);
  await vote({ pollId: poll.id, sessionId: other.id, reservationId: ctx.people[1].id, choice: 1 }, START);

  assert.deepEqual((await pollTally(poll.id, ctx.session.id, 2)).tally, [1, 0]);
  assert.deepEqual((await pollTally(poll.id, other.id, 2)).tally, [0, 1]);
});

test('投票の書式は往復できる', () => {
  const text = '10:00 | いまのご状況は？ | 退職済み | 検討中\n25:00..30:00 | 興味は？ | はい | いいえ';
  const parsed = parsePollsText(text);
  const back = pollsToText(parsed.map((p) => ({ ...p, options: JSON.stringify(p.options) })));
  assert.equal(back, text);
  assert.equal(parsePollsText('5:00 | 選択肢が足りない').length, 0);
  assert.equal(parsePollsText('でたらめ').length, 0);
});

test('古い在室情報は消える', async () => {
  await join(ctx.people[0], START);
  await cleanupPresence(START + 2 * 24 * 60 * 60 * 1000);
  assert.equal(await countPresent(ctx.session.id, START), 0);
});
