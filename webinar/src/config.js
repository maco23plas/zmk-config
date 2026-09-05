// 設定。Node では process.env（＋.env）、Cloudflare Workers では env バインディングを渡す。
// ※ Workers にもバンドルされるため node: 系を import しないこと。

const bool = (v, dflt) => (v === undefined || v === '' ? dflt : /^(1|on|true|yes)$/i.test(String(v)));
const num = (v, dflt) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : dflt;
};

export function makeConfig(source = {}) {
  const env = source || {};
  const port = num(env.PORT, 3000);
  const basicId = String(env.LINE_BASIC_ID || '').trim();
  const accessToken = String(env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();

  return {
    port,
    baseUrl: String(env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),

    line: {
      accessToken,
      channelSecret: String(env.LINE_CHANNEL_SECRET || '').trim(),
      basicId,
      addFriendUrl: String(env.LINE_ADD_FRIEND_URL || '').trim()
        || (basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : ''),
    },

    admin: {
      user: String(env.ADMIN_USER || 'admin'),
      pass: String(env.ADMIN_PASS || ''),
      sessionSecret: String(env.SESSION_SECRET || ''),
    },

    // 画面に出す名前。事業ごとに差し替える。
    brand: {
      name: String(env.BRAND_NAME || 'オンライン説明会'),
      sub: String(env.BRAND_SUB || ''),          // ブランド名（小さく併記）
      company: String(env.COMPANY_NAME || ''),   // フッターの運営者表記
    },

    dbPath: String(env.DB_PATH || './data/webinar.db'),
    mediaDir: String(env.MEDIA_DIR || './media'),
    publicDir: String(env.PUBLIC_DIR || './public'),

    notify: {
      confirm: bool(env.NOTIFY_CONFIRM, true),
      remind_1d: bool(env.NOTIFY_REMIND_1D, true),
      // watch_link_3h（3時間前の視聴リンク）は本システムの中核要件のため常時有効。
      watch_link_3h: true,
      remind_10m: bool(env.NOTIFY_REMIND_10M, true),
      start: bool(env.NOTIFY_START, false),
      followup: bool(env.NOTIFY_FOLLOWUP, false),
    },

    workerIntervalMs: num(env.WORKER_INTERVAL_MS, 20000),

    // 1回の実行で送るLINEメッセージの上限。
    // Cloudflare Workers の無料プランは1呼び出しあたり50サブリクエストまでなので、
    // 余裕を見て既定を40にしている（1分ごとに実行されるので毎時2400通まで捌ける）。
    maxSendsPerRun: num(env.MAX_SENDS_PER_RUN, 40),

    // 動画ファイルの自前配信ができる環境か（Workers はディスクを持たない）
    canServeFiles: true,

    // アクセストークン未設定ならドライラン（送信せずログのみ）
    dryRun: !accessToken,
  };
}

/** 実行中の設定。initRuntime / configure で中身が入る。 */
export const config = makeConfig({});

export function configure(source, overrides = {}) {
  const next = makeConfig(source);
  Object.assign(config, next, overrides);
  Object.assign(config.brand, next.brand, overrides.brand || {});
  Object.assign(config.line, next.line, overrides.line || {});
  Object.assign(config.admin, next.admin, overrides.admin || {});
  Object.assign(config.notify, next.notify, overrides.notify || {});
  return config;
}

/** 起動時の設定チェック。致命的でないものは警告として返す。 */
export function configWarnings() {
  const w = [];
  if (!config.line.accessToken) w.push('LINE_CHANNEL_ACCESS_TOKEN 未設定 → ドライラン（LINEに実送信しません）');
  if (!config.line.channelSecret) w.push('LINE_CHANNEL_SECRET 未設定 → Webhookの署名検証ができないため受信を拒否します');
  if (!config.line.addFriendUrl) w.push('LINE_BASIC_ID / LINE_ADD_FRIEND_URL 未設定 → 友だち追加ボタンが出せません');
  if (!config.admin.pass) w.push('ADMIN_PASS 未設定 → 管理画面はロックされます');
  if (!config.admin.sessionSecret) w.push('SESSION_SECRET 未設定 → 管理画面はロックされます');
  if (!/^https:\/\//.test(config.baseUrl)) {
    w.push(`BASE_URL が ${config.baseUrl} です。LINEはhttps以外のリンクを受け付けないため、本番では公開URL(https)を設定してください`);
  }
  return w;
}
