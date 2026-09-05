// ルーティングとリクエスト処理の本体。Node でも Cloudflare Workers でもここを共有する。
// 実行環境ごとの違い（HTTPサーバーの立て方・DBの接続・ファイル配信）は各アダプタが受け持つ。

import { log } from './lib/log.js';
import { Router, readBody, parseBody, sameOrigin, html, text, PayloadTooLarge } from './lib/http.js';
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

const router = createRouter();
const EMPTY = new Uint8Array(0);

/**
 * リクエストを1件処理する。
 * @param {Request} request
 * @param {{waitUntil?:Function}} [runtime]
 * @returns {Promise<Response>}
 */
export async function handleRequest(request, runtime = {}) {
  const started = Date.now();
  let response;

  try {
    const url = new URL(request.url);
    const found = router.match(request.method, url.pathname);

    if (!found) {
      response = html(errorPage(404, 'ページが見つかりません'), 404);
    } else if (found.methodNotAllowed) {
      response = text('method not allowed', 405);
    } else {
      const isWrite = request.method === 'POST';
      const rawBody = isWrite ? await readBody(request) : EMPTY;

      // 外部サイトからのフォーム送信を弾く（LINEのWebhookは署名で検証するので対象外）
      if (isWrite && !found.route.opts.noCsrf && !sameOrigin(request)) {
        log.warn(`CSRF疑い: ${request.method} ${url.pathname} origin=${request.headers.get('origin') || '(なし)'}`);
        response = text('forbidden', 403);
      } else {
        response = await found.route.handler({
          request,
          url,
          params: found.params,
          query: url.searchParams,
          rawBody,
          form: isWrite ? parseBody(rawBody, request.headers.get('content-type') || '') : {},
          waitUntil: runtime.waitUntil,
        });
      }
    }
  } catch (err) {
    if (err instanceof PayloadTooLarge) {
      response = html(errorPage(413, '送信内容が大きすぎます'), 413);
    } else {
      log.error(`${request.method} ${request.url} で例外:`, err?.stack || err);
      response = html(errorPage(500, 'エラーが発生しました'), 500);
    }
  }

  if (response.status >= 400) {
    log.warn(`${request.method} ${new URL(request.url).pathname} → ${response.status} (${Date.now() - started}ms)`);
  }
  return response;
}
