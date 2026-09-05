// LINE Webhook の受け口。
// 署名を検証してから 200 を返し、実処理は非同期で走らせる（LINEは応答が遅いと再送する）。

import { config } from '../config.js';
import { clock } from '../clock.js';
import { log } from '../lib/log.js';
import { text } from '../lib/http.js';
import { verifySignature } from '../line/signature.js';
import { handleEvents } from '../line/webhook.js';

export function register(router) {
  router.post('/line/webhook', async (ctx) => {
    if (!config.line.channelSecret) {
      log.warn('LINE_CHANNEL_SECRET が未設定のため Webhook を拒否しました');
      return text('channel secret not configured', 503);
    }

    const signature = ctx.request.headers.get('x-line-signature');
    if (!(await verifySignature(ctx.rawBody, signature, config.line.channelSecret))) {
      log.warn('LINE Webhook の署名検証に失敗しました');
      return text('invalid signature', 401);
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(ctx.rawBody) || '{}');
    } catch {
      return text('invalid json', 400);
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    // 接続確認（Verify）はイベント無しで飛んでくる
    if (events.length === 0) return text('ok');

    // 200を先に返し、処理は裏で続ける（LINEの3秒タイムアウト対策）。
    // waitUntil があればレスポンス後も実行が保証される。
    const work = handleEvents(events, clock.now()).catch((err) => {
      log.error('Webhook処理で例外:', err?.stack || err);
    });
    if (ctx.waitUntil) ctx.waitUntil(work); else await work;

    return text('ok');
  }, { noCsrf: true });
}
