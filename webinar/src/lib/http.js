// 依存なしの最小HTTPルーター。パターンは '/watch/:token' 形式。
import fs from 'node:fs';
import path from 'node:path';
import { log } from './log.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1MB

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, k) => {
      keys.push(k);
      return '/([^/]+)';
    }).replace(/\*$/, '(.*)') + '$');
    if (pattern.endsWith('*')) keys.push('wildcard');
    this.routes.push({ method, regex, keys, handler, opts });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }

  match(method, pathname) {
    // HEAD は GET のハンドラで処理する
    const m = method === 'HEAD' ? 'GET' : method;
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

/** リクエストボディを読む。生バイト列も保持する（LINEの署名検証に必要）。 */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c) => {
      if (tooLarge) return;   // 上限超過後は捨てる（ここで destroy すると413を返せない）
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Content-Type に応じて本文を解釈する。 */
export function parseBody(raw, contentType = '') {
  const text = raw.toString('utf8');
  if (contentType.includes('application/json')) {
    try { return JSON.parse(text || '{}'); } catch { return {}; }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  return {};
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

export function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure) bits.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...list, bits.join('; ')]);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

export function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': buf.length, ...headers });
  if (res.req?.method === 'HEAD') return res.end();
  res.end(buf);
}

export const html = (res, body, status = 200) =>
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });

export const json = (res, data, status = 200) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

export const text = (res, body, status = 200) =>
  send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8' });

export const redirect = (res, location, status = 302) =>
  send(res, status, '', { Location: location });

/** 静的ファイル配信。Range に対応（動画のシーク／途中再生に必須）。 */
export function sendFile(req, res, filePath, { contentType, cache = 'public, max-age=300' } = {}) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return send(res, 404, 'not found'); }
  if (!stat.isFile()) return send(res, 404, 'not found');

  const type = contentType || contentTypeFor(filePath);
  const range = req.headers.range;
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache, ...SECURITY_HEADERS };

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : Number(m[1]);
      let end = m[2] === '' ? null : Number(m[2]);
      if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
      else { start = start ?? 0; end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1); }
      if (start > end || start >= stat.size) {
        return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
      }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp3': 'audio/mpeg',
};
export const contentTypeFor = (p) => TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';

/** ディレクトリ外への脱出（../）を防いだ上で絶対パスを返す。範囲外なら null。 */
export function resolveWithin(baseDir, requestPath) {
  const cleaned = safeDecode(requestPath).replace(/\0/g, '');
  const full = path.resolve(baseDir, '.' + (cleaned.startsWith('/') ? cleaned : '/' + cleaned));
  const rel = path.relative(path.resolve(baseDir), full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

export function logRequest(req, res, started) {
  const ms = Date.now() - started;
  if (res.statusCode >= 400) log.warn(`${req.method} ${req.url} → ${res.statusCode} (${ms}ms)`);
}
