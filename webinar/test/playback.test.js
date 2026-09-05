import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackState, mediaAllowed, parseVideoSource, PlaybackState } from '../src/domain/playback.js';
import { parseJstLocal } from '../src/lib/time.js';

const START = parseJstLocal('2026-09-10T20:00');
const HOUR = 3600 * 1000;
const base = { startAt: START, durationSec: 3600, status: 'open' };

test('開始前は待機状態で、動画を渡さない', () => {
  const s = playbackState(base, START - 2 * HOUR);
  assert.equal(s.state, PlaybackState.SCHEDULED);
  assert.equal(s.canWatch, false);
  assert.equal(mediaAllowed(s.state), false);
  assert.equal(s.msUntilStart, 2 * HOUR);
});

test('開始10分前からは「まもなく開始」', () => {
  assert.equal(playbackState(base, START - 11 * 60 * 1000).state, PlaybackState.SCHEDULED);
  assert.equal(playbackState(base, START - 9 * 60 * 1000).state, PlaybackState.SOON);
});

test('再生位置は「現在時刻 − 開始時刻」で決まる（誰が開いても同じ場面）', () => {
  for (const min of [0, 1, 17, 59]) {
    const s = playbackState(base, START + min * 60 * 1000);
    assert.equal(s.state, PlaybackState.LIVE);
    assert.equal(s.positionSec, min * 60);
    assert.equal(s.canWatch, true);
    assert.equal(s.seekable, false, '配信中は巻き戻し不可');
  }
});

test('本編の長さを過ぎると終了になり、動画は渡さない', () => {
  const s = playbackState(base, START + 3600 * 1000);
  assert.equal(s.state, PlaybackState.ENDED);
  assert.equal(mediaAllowed(s.state), false);
  assert.equal(s.progress, 1);
});

test('見逃し配信を設定すると、終了後もその時間だけ最初から視聴できる', () => {
  const plan = { ...base, archiveHours: 24 };
  const s = playbackState(plan, START + 2 * HOUR);
  assert.equal(s.state, PlaybackState.ARCHIVE);
  assert.equal(s.canWatch, true);
  assert.equal(s.seekable, true, '見逃し配信はシーク可');
  assert.equal(s.positionSec, 0, '見逃し配信は最初から');
  // 期限を過ぎたら終了
  assert.equal(playbackState(plan, START + 26 * HOUR).state, PlaybackState.ENDED);
});

test('途中入場の締切を設定すると、遅れて開いた人は入れない', () => {
  const plan = { ...base, lateJoinSec: 600 };
  assert.equal(playbackState(plan, START + 9 * 60 * 1000).state, PlaybackState.LIVE);
  const late = playbackState(plan, START + 11 * 60 * 1000);
  assert.equal(late.state, PlaybackState.LATE_CLOSED);
  assert.equal(mediaAllowed(late.state), false);
});

test('締切0は「配信中いつでも入場可」を意味する', () => {
  const plan = { ...base, lateJoinSec: 0 };
  assert.equal(playbackState(plan, START + 55 * 60 * 1000).state, PlaybackState.LIVE);
});

test('中止した回はどの時刻でも視聴できない', () => {
  for (const now of [START - HOUR, START + 60 * 1000, START + 2 * HOUR]) {
    const s = playbackState({ ...base, status: 'canceled' }, now);
    assert.equal(s.state, PlaybackState.CANCELED);
    assert.equal(s.canWatch, false);
  }
});

test('動画ソースの種別を判定する', () => {
  assert.deepEqual(parseVideoSource('youtube:dQw4w9WgXcQ'), { type: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseVideoSource('file:seminar.mp4'), { type: 'file', name: 'seminar.mp4' });
  assert.deepEqual(parseVideoSource('https://cdn.test/a.mp4'), { type: 'url', url: 'https://cdn.test/a.mp4' });
  assert.equal(parseVideoSource('').type, 'unknown');
});
