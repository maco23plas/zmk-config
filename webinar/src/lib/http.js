// Web標準(Request/Response)ベースの最小ルーター。
// Node.js でも Cloudflare Workers でも同じハンドラがそのまま動く。
// ※ node: 系を import しないこと。ファイル配信は setFileServer で差し込む。

const MAX_BODY_BYTES = 1024 * 1024; // 1MB

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, opts = {}) {
    const keys = [];
    let source = pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
    if (source.endsWith('*')) { source = source.slice(0, -1) + '(.*)'; keys.push('wildcard'); }
    this.routes.push({ method, regex: new RegExp(`^${source}$`), keys, handler, opts });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }

  match(method, pathname) {
    const m = method === 'HEAD' ? 'GET' : method; // HEAD は GET のハンドラで処理する
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = safeDecode(found[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

function safeDecode(v) {
  try { return decodeURIComponent(v ?? ''); } catch { return v ?? ''; }
}

// ---- レスポンスの組み立て --------------------------------------------------

const build = (body, status, headers) =>
  new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

export const html = (body, status = 200, headers = {}) =>
  build(String(body), status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

export const json = (data, status = 200, headers = {}) =>
  build(JSON.stringify(data), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

export const text = (body, status = 200, headers = {}) =>
  build(String(body), status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });

export const redirect = (location, status = 302, headers = {}) =>
  build('', status, { Location: location, ...headers });

/** レスポンスにCookieを足す（Responseのヘッダは後から追記できる） */
export function withCookie(response, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) bits.push('Secure');
  response.headers.append('Set-Cookie', bits.join('; '));
  return response;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = safeDecode(part.slice(i + 1).trim());
  }
  return out;
}

// ---- リクエストの解釈 ------------------------------------------------------

export class PayloadTooLarge extends Error {
  constructor() { super('payload too large'); this.status = 413; }
}

/** 本文を読む。生バイト列も保持する（LINEの署名検証に必要）。 */
export async function readBody(request) {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) throw new PayloadTooLarge();
  return raw;
}

/** Content-Type に応じて本文を解釈する。 */
export function parseBody(raw, contentType = '') {
  const body = new TextDecoder().decode(raw);
  if (contentType.includes('application/json')) {
    try { return JSON.parse(body || '{}'); } catch { return {}; }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return {};
}

/**
 * フォーム送信のCSRF対策。
 * ブラウザは同一オリジンのPOSTにも Origin を付けるので、送信元がこのサイト自身かを確認する。
 */
export function sameOrigin(request) {
  const host = new URL(request.url).host;
  for (const header of ['origin', 'referer']) {
    const value = request.headers.get(header);
    if (!value) continue;
    try { return new URL(value).host === host; } catch { return false; }
  }
  return false;
}

// ---- ファイル配信（Nodeでのみ差し込まれる） --------------------------------

let fileServer = null;

/** 実行環境がファイルを配信できる場合に、その実装を登録する */
export function setFileServer(fn) { fileServer = fn; }

/**
 * ファイルを配信する。差し込まれていない環境（Workers）では null を返す。
 * @returns {Promise<Response|null>}
 */
export function serveFile(baseDir, relativePath, request, opts) {
  return fileServer ? fileServer(baseDir, relativePath, request, opts) : null;
}

const TYPES = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t', m4s: 'video/iso.segment', mp3: 'audio/mpeg',
};

export const contentTypeFor = (name) =>
  TYPES[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

export { SECURITY_HEADERS };
