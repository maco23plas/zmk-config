/**
 * 状態 (会議DB + 議事録アーカイブ) を暗号化して1ファイルにまとめる/復元する。
 *
 * GitHub Actions 運用では実行のたびにランナーが破棄されるため、状態を
 * `minutemate-state` ブランチに保存して次回に引き継ぐ。ただしこのリポジトリが
 * 公開の場合、議事録を平文でコミットすると全世界に露出してしまう。
 * そこで STATE_KEY (Secrets) で AES-256-GCM 暗号化した blob だけをコミットする。
 *
 *   npm run state:save     … data/ → mm-state/state.enc (暗号化)
 *   npm run state:restore  … mm-state/state.enc → data/ (復号)
 *
 * STATE_KEY 未設定時は「公開リポジトリへの平文コミットを防ぐため」既定で停止する。
 * 非公開リポジトリで平文保存を許容する場合のみ STATE_ALLOW_PLAINTEXT=1 を設定する。
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { log } from './util.js';

const STATE_DIR = path.resolve(process.env.STATE_DIR || '../mm-state');
const ENC_FILE = path.join(STATE_DIR, 'state.enc');
const PLAIN_FILE = path.join(STATE_DIR, 'state.json');

const DB_FILE = path.join(cfg.dataDir, 'minutemate.db');
const BUSINESS_DIR = path.join(cfg.dataDir, 'businesses');

interface StatePack {
  db?: string; // base64 の SQLite ファイル
  files: Record<string, string>; // 相対パス(data/配下) -> テキスト内容
}

function keyFromEnv(): Buffer | null {
  const secret = process.env.STATE_KEY;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]); // iv(12) + tag(16) + ciphertext
}

function decrypt(blob: Buffer, key: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** businesses 配下の議事録/レポート(.md/.json)を集める。録音(webm)は含めない。 */
function collectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  if (!fs.existsSync(BUSINESS_DIR)) return files;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|json)$/.test(entry.name)) {
        files[path.relative(cfg.dataDir, full)] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(BUSINESS_DIR);
  return files;
}

export function saveState(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const key = keyFromEnv();

  // WAL の内容を本体 .db に反映してから読み出す
  let dbB64: string | undefined;
  if (fs.existsSync(DB_FILE)) {
    try {
      const d = new Database(DB_FILE);
      d.pragma('wal_checkpoint(TRUNCATE)');
      d.close();
    } catch {
      /* checkpoint できなくてもファイルはそのまま保存 */
    }
    dbB64 = fs.readFileSync(DB_FILE).toString('base64');
  }
  const pack: StatePack = { db: dbB64, files: collectFiles() };
  const json = Buffer.from(JSON.stringify(pack));

  if (key) {
    fs.writeFileSync(ENC_FILE, encrypt(json, key));
    if (fs.existsSync(PLAIN_FILE)) fs.rmSync(PLAIN_FILE);
    log('state', `暗号化して保存: ${ENC_FILE} (${Object.keys(pack.files).length} ファイル + DB)`);
  } else if (['1', 'true'].includes((process.env.STATE_ALLOW_PLAINTEXT || '').toLowerCase())) {
    fs.writeFileSync(PLAIN_FILE, json);
    log('state', `⚠️ 平文で保存: ${PLAIN_FILE} (STATE_ALLOW_PLAINTEXT=1)。公開リポジトリでは使わないこと`);
  } else {
    throw new Error(
      'STATE_KEY が未設定です。公開リポジトリへ議事録を平文コミットするのを防ぐため停止しました。\n' +
        'GitHub Secrets に STATE_KEY (任意の長いパスフレーズ) を登録してください。\n' +
        '非公開リポジトリで平文保存を許容する場合のみ STATE_ALLOW_PLAINTEXT=1 を設定します。'
    );
  }
}

export function restoreState(): void {
  const key = keyFromEnv();
  let json: Buffer | null = null;

  if (key && fs.existsSync(ENC_FILE)) {
    try {
      json = decrypt(fs.readFileSync(ENC_FILE), key);
    } catch (e) {
      throw new Error(
        `state.enc の復号に失敗しました。STATE_KEY が前回と一致していない可能性があります: ${(e as Error).message}`
      );
    }
  } else if (fs.existsSync(PLAIN_FILE)) {
    json = fs.readFileSync(PLAIN_FILE);
  }

  if (!json) {
    log('state', '復元する状態がありません (初回実行)');
    return;
  }
  const pack = JSON.parse(json.toString()) as StatePack;
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  if (pack.db) {
    // 古い WAL/SHM が残っていると復元した本体と食い違うので消す
    for (const suffix of ['-wal', '-shm']) {
      const p = DB_FILE + suffix;
      if (fs.existsSync(p)) fs.rmSync(p);
    }
    fs.writeFileSync(DB_FILE, Buffer.from(pack.db, 'base64'));
  }
  for (const [rel, content] of Object.entries(pack.files)) {
    const full = path.join(cfg.dataDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  log('state', `復元しました (${Object.keys(pack.files).length} ファイル + DB)`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'save') saveState();
    else if (cmd === 'restore') restoreState();
    else {
      console.error('usage: state.ts save|restore');
      process.exit(1);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
