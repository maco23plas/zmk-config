import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJstLocal, formatJst, formatJstShort, toDatetimeLocal, jstParts,
  isSameJstDay, jstDayStart, parseHhMm, formatDuration, formatRelative, JST_OFFSET_MS,
} from '../src/lib/time.js';

test('JSTの日時をUTCの内部表現へ正しく変換する', () => {
  const ms = parseJstLocal('2026-09-10T20:00');
  assert.equal(new Date(ms).toISOString(), '2026-09-10T11:00:00.000Z');
  assert.equal(ms + JST_OFFSET_MS, Date.UTC(2026, 8, 10, 20, 0));
});

test('日本にサマータイムは無いので、夏でも冬でもオフセットは+9時間', () => {
  for (const [input, iso] of [
    ['2026-01-15T09:00', '2026-01-15T00:00:00.000Z'],
    ['2026-07-15T09:00', '2026-07-15T00:00:00.000Z'],
  ]) {
    assert.equal(new Date(parseJstLocal(input)).toISOString(), iso);
  }
});

test('入力とdatetime-local表記が往復する', () => {
  for (const v of ['2026-09-10T20:00', '2027-01-01T00:00', '2026-12-31T23:59']) {
    assert.equal(toDatetimeLocal(parseJstLocal(v)), v);
  }
});

test('存在しない日付や不正な形式は null', () => {
  for (const bad of ['2026-02-31T10:00', '2026-13-01T10:00', '2026-09-10T25:00', 'あああ', '', null]) {
    assert.equal(parseJstLocal(bad), null, `${bad} は不正として扱う`);
  }
});

test('日付をまたぐ「当日」判定がJST基準になる', () => {
  // 2026-09-10 00:30 JST は UTC では前日15:30。JST基準で同じ日と判定されること。
  const a = parseJstLocal('2026-09-10T00:30');
  const b = parseJstLocal('2026-09-10T23:30');
  assert.ok(isSameJstDay(a, b));
  assert.ok(!isSameJstDay(a, parseJstLocal('2026-09-09T23:30')));
  assert.equal(jstDayStart(a), parseJstLocal('2026-09-10T00:00'));
});

test('曜日と表示形式', () => {
  const ms = parseJstLocal('2026-09-10T20:00'); // 木曜
  assert.equal(jstParts(ms).weekdayJa, '木');
  assert.equal(formatJst(ms), '2026年9月10日(木) 20:00');
  assert.equal(formatJstShort(ms), '9/10(木) 20:00');
});

test('HH:MM のパース', () => {
  assert.equal(parseHhMm('20:00'), 20 * 3600 * 1000);
  assert.equal(parseHhMm('9:05'), (9 * 3600 + 5 * 60) * 1000);
  assert.equal(parseHhMm('24:00'), null);
  assert.equal(parseHhMm('20:60'), null);
});

test('所要時間と相対時間の表示', () => {
  assert.equal(formatDuration(3600), '1時間');
  assert.equal(formatDuration(2700), '45分');
  assert.equal(formatDuration(5400), '1時間30分');
  assert.equal(formatRelative(3 * 3600 * 1000), 'あと3時間');
  assert.equal(formatRelative(-90 * 60 * 1000), '1時間30分前');
});
