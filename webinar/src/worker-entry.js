// Cloudflare Workers 用のエントリポイント。
//   fetch      … 予約サイト・視聴ページ・管理画面・LINE Webhook
//   scheduled  … 1分ごとの Cron Trigger（通知送信と開催枠の自動生成）
// アプリ本体（ルーティング）は src/app.js と共通。

import { configure } from './config.js';
import { clock } from './clock.js';
import { log } from './lib/log.js';
import { setDriver } from './db.js';
import { d1Driver } from './db-d1.js';
import { handleRequest } from './app.js';
import { tickOnce } from './worker.js';

let initializedFor = null;

function init(env) {
  if (initializedFor === env) return;
  if (!env.DB) throw new Error('D1データベースのバインディング(DB)が設定されていません');
  configure(env, {
    // Workers はディスクを持たないため、動画の自前配信はできない
    // （YouTube限定公開 または CDN の URL を使う）
    canServeFiles: false,
  });
  setDriver(d1Driver(env.DB));
  initializedFor = env;
}

export default {
  async fetch(request, env, ctx) {
    init(env);
    return handleRequest(request, { waitUntil: ctx.waitUntil.bind(ctx) });
  },

  async scheduled(event, env, ctx) {
    init(env);
    ctx.waitUntil(
      tickOnce(clock.now()).catch((err) => log.error('定期実行で例外:', err?.stack || err)),
    );
  },
};
