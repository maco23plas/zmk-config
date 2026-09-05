// Node.js 用のアダプタ。
// HTTPサーバーを立て、SQLiteに接続し、ファイル配信と常駐ワーカーを有効にする。
// アプリ本体（ルーティング）は src/app.js と共通。

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { config, configure, configWarnings } from './config.js';
import { clock } from './clock.js';
import { log } from './lib/log.js';
import { setFileServer, contentTypeFor, SECURITY_HEADERS } from './lib/http.js';
import { setDriver } from './db.js';
import { openSqlite, nodeDriver } from './db-node.js';
import { handleRequest } from './app.js';
import { startWorker, stopWorker } from './worker.js';
import { generateSessionsFromRules } from './domain/sessions.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** .env があれば読む（依存ライブラリなしの簡易パーサ） */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const resolveDir = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

/** ディレクトリ外への脱出（../）を防いだ上で絶対パスを返す。範囲外なら null。 */
export function resolveWithin(baseDir, requestPath) {
  let cleaned;
  try { cleaned = decodeURIComponent(String(requestPath)); } catch { cleaned = String(requestPath); }
  cleaned = cleaned.replace(/\0/g, '');
  const full = path.resolve(baseDir, '.' + (cleaned.startsWith('/') ? cleaned : '/' + cleaned));
  const rel = path.relative(path.resolve(baseDir), full);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : full;
}

/** Range に対応したファイル配信（動画の途中再生に必要） */
export function nodeFileServer(baseDir, relativePath, request, { cache = 'public, max-age=300' } = {}) {
  // /static/app.css のような絶対パスで来る場合はそのまま、ファイル名だけの場合も扱えるようにする
  const full = resolveWithin(resolveDir(baseDir), relativePath);
  if (!full) return new Response('bad path', { status: 400 });

  let stat;
  try { stat = fs.statSync(full); } catch { return new Response('not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('not found', { status: 404 });

  const base = {
    ...SECURITY_HEADERS,
    'Content-Type': contentTypeFor(full),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  };
  const stream = (start, end) => Readable.toWeb(fs.createReadStream(full, { start, end }));

  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null && end !== null) { start = Math.max(0, stat.size - end); end = stat.size - 1; }
    else { start = start ?? 0; end = end === null ? stat.size - 1 : Math.min(end, stat.size - 1); }

    if (start > end || start >= stat.size) {
      return new Response('', { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}` } });
    }
    return new Response(stream(start, end), {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }

  return new Response(stream(0, stat.size - 1), {
    status: 200,
    headers: { ...base, 'Content-Length': String(stat.size) },
  });
}

/** node の IncomingMessage を Web の Request に変換する */
function toWebRequest(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  });
}

/** Web の Response を node の ServerResponse に書き出す */
async function writeWebResponse(res, response, isHead) {
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);

  const headers = {};
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'set-cookie') headers[key] = value;
  }
  res.writeHead(response.status, headers);

  if (isHead || !response.body) return res.end();
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (!res.write(chunk)) await new Promise((r) => res.once('drain', r));
    }
  } catch (err) {
    log.warn('レスポンスの送信が中断されました:', err.message);
  }
  res.end();
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const response = await handleRequest(toWebRequest(req));
      await writeWebResponse(res, response, req.method === 'HEAD');
    } catch (err) {
      log.error('リクエスト処理で例外:', err?.stack || err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('internal error');
    }
  });
}

/** Node実行時の初期化（設定・DB・ファイル配信） */
export function initNodeRuntime() {
  loadDotEnv();
  configure(process.env, {
    mediaDir: resolveDir(process.env.MEDIA_DIR || './media'),
    publicDir: resolveDir(process.env.PUBLIC_DIR || './public'),
    canServeFiles: true,
  });
  setFileServer(nodeFileServer);

  const dbPath = process.env.DB_PATH === ':memory:' ? ':memory:' : resolveDir(config.dbPath);
  const schema = fs.readFileSync(path.join(ROOT, 'src', 'schema.sql'), 'utf8');
  setDriver(nodeDriver(openSqlite(dbPath, schema)));
}

export async function start() {
  initNodeRuntime();
  await generateSessionsFromRules(clock.now()); // 定期開催ルールから枠を用意

  const warnings = configWarnings();
  if (warnings.length) {
    log.warn('設定の確認:');
    for (const w of warnings) log.warn('  - ' + w);
  }

  const server = createServer();
  server.listen(config.port, () => {
    log.info(`起動しました: ${config.baseUrl}（ポート ${config.port}）`);
    log.info(`  予約サイト  ${config.baseUrl}/`);
    log.info(`  管理画面    ${config.baseUrl}/admin`);
    log.info(`  Webhook URL ${config.baseUrl}/line/webhook`);
  });
  startWorker();

  const shutdown = (signal) => {
    log.info(`${signal} を受信しました。終了します。`);
    stopWorker();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// 直接実行されたときだけ起動する（テストからは import できるようにしておく）
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) start();
