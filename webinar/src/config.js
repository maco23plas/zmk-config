// 環境変数の読み込みと既定値。.env があれば読む（依存ライブラリなしの簡易パーサ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
loadDotEnv();

const env = process.env;
const bool = (v, dflt) => (v === undefined || v === '' ? dflt : /^(1|on|true|yes)$/i.test(v));
const num = (v, dflt) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : dflt);
const resolve = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

const basicId = (env.LINE_BASIC_ID || '').trim();

export const config = {
  port: num(env.PORT, 3000),
  baseUrl: (env.BASE_URL || `http://localhost:${num(env.PORT, 3000)}`).replace(/\/+$/, ''),

  line: {
    accessToken: (env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
    channelSecret: (env.LINE_CHANNEL_SECRET || '').trim(),
    basicId,
    // 友だち追加URL。未設定ならベーシックIDから組み立てる。
    addFriendUrl: (env.LINE_ADD_FRIEND_URL || '').trim()
      || (basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : ''),
  },

  admin: {
    user: env.ADMIN_USER || 'admin',
    pass: env.ADMIN_PASS || '',
    sessionSecret: env.SESSION_SECRET || '',
  },

  dbPath: resolve(env.DB_PATH || './data/webinar.db'),
  mediaDir: resolve(env.MEDIA_DIR || './media'),

  notify: {
    confirm: bool(env.NOTIFY_CONFIRM, true),
    remind_1d: bool(env.NOTIFY_REMIND_1D, true),
    // watch_link_3h（3時間前の視聴リンク送付）は本システムの中核要件のため常時有効。
    watch_link_3h: true,
    remind_10m: bool(env.NOTIFY_REMIND_10M, true),
    start: bool(env.NOTIFY_START, false),
    followup: bool(env.NOTIFY_FOLLOWUP, false),
  },

  workerIntervalMs: num(env.WORKER_INTERVAL_MS, 20000),

  // アクセストークン未設定ならドライラン（送信せずログのみ）。ローカル検証用。
  get dryRun() { return !this.line.accessToken; },
};

/** 起動時の設定チェック。致命的でないものは警告として返す。 */
export function configWarnings() {
  const w = [];
  if (!config.line.accessToken) w.push('LINE_CHANNEL_ACCESS_TOKEN 未設定 → ドライラン（LINEに実送信しません）');
  if (!config.line.channelSecret) w.push('LINE_CHANNEL_SECRET 未設定 → Webhookの署名検証ができないため受信を拒否します');
  if (!config.line.addFriendUrl) w.push('LINE_BASIC_ID / LINE_ADD_FRIEND_URL 未設定 → 友だち追加ボタンが出せません');
  if (!config.admin.pass) w.push('ADMIN_PASS 未設定 → 管理画面はロックされます');
  if (!config.admin.sessionSecret) w.push('SESSION_SECRET 未設定 → 管理画面はロックされます');
  if (config.baseUrl.startsWith('http://localhost')) w.push(`BASE_URL が ${config.baseUrl} です。本番では公開URLを設定してください`);
  return w;
}
