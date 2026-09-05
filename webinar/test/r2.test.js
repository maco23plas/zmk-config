// R2から動画を配信する部分のテスト。
// 実物のR2の挙動（Rangeヘッダの解釈・範囲外での例外）を模した偽バケットで検証する。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { r2FileServer, toObjectKey } from '../src/r2-files.js';
import { parseRangeHeader } from '../src/lib/http.js';

/**
 * 実物のR2に合わせた偽バケット。
 * 実機で確かめたところ、R2は Range ヘッダを渡すと範囲外でも例外を投げず切り詰めて返す。
 * そのため配信側は自分で範囲を解釈する必要がある。ここでもその挙動を再現しておく。
 */
function fakeBucket(files) {
  const bodyOf = (buf) => new Response(buf).body;
  return {
    async head(key) {
      const b = files[key];
      return b ? { size: b.length, httpEtag: '"etag"' } : null;
    },
    async get(key, opts = {}) {
      const b = files[key];
      if (!b) return null;
      const base = { size: b.length, httpEtag: '"etag"' };
      const r = opts.range;
      if (!r || r.offset === undefined) return { ...base, body: bodyOf(b) };
      // 実物と同じく、はみ出した指定は切り詰める（例外は投げない）
      const start = Math.min(r.offset, b.length);
      const end = Math.min(start + (r.length ?? (b.length - start)), b.length);
      return { ...base, range: { offset: start, length: end - start }, body: bodyOf(b.subarray(start, end)) };
    },
  };
}

const CONTENT = Buffer.alloc(10_000, 0).map((_, i) => i % 251);
const serve = r2FileServer(fakeBucket({ 'seminar.mp4': CONTENT }));
const req = (range) => new Request('https://x.test/media', { headers: range ? { Range: range } : {} });

test('Rangeなしなら全体を返す', async () => {
  const res = await serve(null, 'seminar.mp4', req());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '10000');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-range'), null);
  assert.equal((await res.arrayBuffer()).byteLength, 10_000);
});

test('範囲指定に対して206と正しい部分を返す（動画の途中再生に必要）', async () => {
  const res = await serve(null, 'seminar.mp4', req('bytes=1000-1999'));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 1000-1999/10000');
  assert.equal(res.headers.get('content-length'), '1000');
  const body = Buffer.from(await res.arrayBuffer());
  assert.equal(body.length, 1000);
  assert.deepEqual([...body.subarray(0, 3)], [...CONTENT.subarray(1000, 1003)], '中身も正しい位置のもの');
});

test('終端を省略した範囲は最後まで返す', async () => {
  const res = await serve(null, 'seminar.mp4', req('bytes=9500-'));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 9500-9999/10000');
  assert.equal(res.headers.get('content-length'), '500');
});

test('末尾からの範囲指定（bytes=-500）に対応する', async () => {
  const res = await serve(null, 'seminar.mp4', req('bytes=-500'));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 9500-9999/10000');
  assert.equal((await res.arrayBuffer()).byteLength, 500);
});

test('範囲外の指定には416とファイル全体の大きさを返す', async () => {
  // R2は範囲外でも切り詰めて成功を返すため、配信側で弾かないと
  // 「全体を206で返す」という誤った応答になる（実機で確認した挙動）
  for (const bad of ['bytes=99999-', 'bytes=10000-', 'bytes=500-499', 'bytes=-0']) {
    const res = await serve(null, 'seminar.mp4', req(bad));
    assert.equal(res.status, 416, `${bad} は416`);
    assert.equal(res.headers.get('content-range'), 'bytes */10000');
  }
});

test('解釈できないRange指定は無視して全体を返す', async () => {
  const res = await serve(null, 'seminar.mp4', req('items=1-2'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '10000');
});

test('存在しないファイルは404', async () => {
  assert.equal((await serve(null, 'missing.mp4', req())).status, 404);
});

test('親ディレクトリへの脱出を拒否する', async () => {
  for (const path of ['../secret.mp4', '/a/../../secret.mp4', '..', '/', '']) {
    const res = await serve(null, path, req());
    assert.ok([400, 404].includes(res.status), `${path} → ${res.status}`);
  }
  assert.equal(toObjectKey('../x'), null);
  assert.equal(toObjectKey('/sub/a.mp4'), 'sub/a.mp4');
  assert.equal(toObjectKey('a.mp4'), 'a.mp4');
});

test('Rangeヘッダの解釈（ディスク配信とR2配信で共通）', () => {
  assert.deepEqual(parseRangeHeader('bytes=10-19', 100), { start: 10, end: 19, length: 10 });
  assert.deepEqual(parseRangeHeader('bytes=90-', 100), { start: 90, end: 99, length: 10 });
  assert.deepEqual(parseRangeHeader('bytes=-30', 100), { start: 70, end: 99, length: 30 });
  assert.deepEqual(parseRangeHeader('bytes=-500', 100), { start: 0, end: 99, length: 100 }, 'ファイルより長い指定は全体に丸める');
  assert.deepEqual(parseRangeHeader('bytes=0-999', 100), { start: 0, end: 99, length: 100 }, '終端は実サイズに丸める');
  assert.equal(parseRangeHeader(null, 100), null);
  assert.equal(parseRangeHeader('items=1-2', 100), null, '解釈できない指定は全体扱い');
  for (const bad of ['bytes=100-', 'bytes=200-300', 'bytes=50-40', 'bytes=-0']) {
    assert.equal(parseRangeHeader(bad, 100), 'invalid', `${bad} は範囲外`);
  }
});
