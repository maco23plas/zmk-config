// Cloudflare R2 から動画を配信するドライバ。
//
// Workers はディスクを持たないが、R2（オブジェクトストレージ）をバインドすれば
// 自前のMP4を配信できる。R2は転送量が無料なので、動画配信でも費用が増えない。
//
// Node版の media/ ディレクトリと同じ扱いにしてあるので、
// 管理画面の指定は両環境とも `file:seminar.mp4` のままでよい。
//
// ※ R2 に Range ヘッダをそのまま渡すと、範囲外の指定を「切り詰めて成功」として
//    返してしまう。誤った Content-Range を返さないよう、範囲は自分で解釈する。

import { SECURITY_HEADERS, contentTypeFor, parseRangeHeader } from './lib/http.js';

/** '/seminar.mp4' や 'sub/seminar.mp4' をR2のキーに正規化する。範囲外なら null。 */
export function toObjectKey(relativePath) {
  let value;
  try { value = decodeURIComponent(String(relativePath ?? '')); } catch { value = String(relativePath ?? ''); }
  value = value.replace(/\0/g, '').replace(/^\/+/, '');
  if (!value) return null;
  // 親ディレクトリへの参照を含むキーは拒否する
  if (value.split('/').some((part) => part === '..' || part === '.')) return null;
  return value;
}

export function r2FileServer(bucket) {
  return async (baseDir, relativePath, request, { cache = 'private, max-age=60' } = {}) => {
    const key = toObjectKey(relativePath);
    if (!key) return new Response('bad path', { status: 400 });

    const headers = (size) => ({
      ...SECURITY_HEADERS,
      'Content-Type': contentTypeFor(key),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
      'Content-Length': String(size),
    });

    // 範囲指定なし … 1回の取得で済ませる
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) {
      const object = await bucket.get(key);
      if (!object) return new Response('not found', { status: 404 });
      return new Response(object.body, {
        status: 200,
        headers: { ...headers(object.size), ETag: object.httpEtag },
      });
    }

    // 範囲指定あり … Content-Range と 416 の判定にファイル全体の大きさが要る
    const head = await bucket.head(key);
    if (!head) return new Response('not found', { status: 404 });

    const range = parseRangeHeader(rangeHeader, head.size);
    if (range === 'invalid') {
      return new Response('', {
        status: 416,
        headers: { ...SECURITY_HEADERS, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${head.size}` },
      });
    }
    if (!range) {
      const object = await bucket.get(key);
      if (!object) return new Response('not found', { status: 404 });
      return new Response(object.body, { status: 200, headers: { ...headers(object.size), ETag: object.httpEtag } });
    }

    const object = await bucket.get(key, { range: { offset: range.start, length: range.length } });
    if (!object) return new Response('not found', { status: 404 });
    return new Response(object.body, {
      status: 206,
      headers: {
        ...headers(range.length),
        ETag: object.httpEtag,
        'Content-Range': `bytes ${range.start}-${range.end}/${head.size}`,
      },
    });
  };
}
