import http from 'node:http';
import { config, configWarnings } from './config.js';
import { clock } from './clock.js';
import { log } from './lib/log.js';
import { Router, readBody, send, html, logRequest } from './lib/http.js';
import { getDb } from './db.js';
import { startWorker, stopWorker } from './worker.js';
import { generateSessionsFromRules } from './domain/sessions.js';
import * as publicRoutes from './routes/public.js';
import * as watchRoutes from './routes/watch.js';
import * as lineRoutes from './routes/line.js';
import * as adminRoutes from './routes/admin.js';
import { errorPage } from './views/layout.js';
import { watchPage, watchBlockedPage, watchNotFoundPage } from './views/watch.js';

export function createRouter() {
  const router = new Router();
  publicRoutes.register(router);
  watchRoutes.register(router, { watchPage, watchBlockedPage, watchNotFoundPage });
  lineRoutes.register(router);
  adminRoutes.register(router);
  return router;
}

/**
 * フォーム送信のCSRF対策。
 * ブラウザは同一オリジンのPOSTにも Origin を付けるので、
 * 送信元がこのサイト自身であることを確認する。
 */
function sameOrigin(req) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  const referer = req.headers.referer;
  if (referer) {
    try { return new URL(referer).host === host; } catch { return false; }
  }
  return false;
}

export function createServer() {
  const router = createRouter();

  return http.createServer(async (req, res) => {
    const started = Date.now();
    res.req = req;

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const found = router.match(req.method, url.pathname);

      if (!found) return html(res, errorPage(404, 'ページが見つかりません'), 404);
      if (found.methodNotAllowed) return send(res, 405, 'method not allowed');

      const isWrite = req.method === 'POST';
      const rawBody = isWrite ? await readBody(req) : Buffer.alloc(0);

      if (isWrite && !found.route.opts.noCsrf && !sameOrigin(req)) {
        log.warn(`CSRF疑い: ${req.method} ${url.pathname} origin=${req.headers.origin || '(なし)'}`);
        return send(res, 403, 'forbidden');
      }

      await found.route.handler(req, res, {
        params: found.params,
        query: url.searchParams,
        url,
        rawBody,
      });
    } catch (err) {
      const status = err?.statusCode || 500;
      if (status >= 500) log.error(`${req.method} ${req.url} で例外:`, err?.stack || err);
      if (res.headersSent) return res.end();
      if (status === 413) {
        // 受信途中で打ち切っているので、接続を閉じることを伝えてから返す
        return send(res, 413, errorPage(413, '送信内容が大きすぎます'),
          { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      }
      html(res, errorPage(status, 'エラーが発生しました'), status);
    } finally {
      logRequest(req, res, started);
    }
  });
}

export function start() {
  getDb();                                  // スキーマ適用
  generateSessionsFromRules(clock.now());   // 定期開催ルールから枠を用意

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
