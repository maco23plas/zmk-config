// LINE Webhook の受け口。
// 署名を検証してから 200 を返し、実処理は非同期で走らせる（LINEは応答が遅いと再送する）。

import { config } from '../config.js';
import { clock } from '../clock.js';
import { log } from '../lib/log.js';
import { send } from '../lib/http.js';
import { verifySignature } from '../line/signature.js';
import { handleEvents } from '../line/webhook.js';

export function register(router) {
  router.post('/line/webhook', (req, res, ctx) => {
    if (!config.line.channelSecret) {
      log.warn('LINE_CHANNEL_SECRET が未設定のため Webhook を拒否しました');
      return send(res, 503, 'channel secret not configured');
    }

    const signature = req.headers['x-line-signature'];
    if (!verifySignature(ctx.rawBody, signature, config.line.channelSecret)) {
      log.warn('LINE Webhook の署名検証に失敗しました');
      return send(res, 401, 'invalid signature');
    }

    let payload;
    try {
      payload = JSON.parse(ctx.rawBody.toString('utf8') || '{}');
    } catch {
      return send(res, 400, 'invalid json');
    }

    // 先に200を返してから処理する（LINEの3秒タイムアウト対策）
    send(res, 200, 'ok');

    const events = Array.isArray(payload.events) ? payload.events : [];
    if (events.length === 0) return; // 接続確認（Verify）はイベント無しで飛んでくる

    handleEvents(events, clock.now()).catch((err) => {
      log.error('Webhook処理で例外:', err?.stack || err);
    });
  }, { noCsrf: true });
}
