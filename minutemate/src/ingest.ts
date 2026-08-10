/**
 * 録音ファイルを取り込んで議事録化する (会議に入らず、手持ちの録音から議事録を作る入口)。
 *
 *   npm run ingest -- <ファイル> [--title タイトル] [--business 事業名] [--date YYYY-MM-DD]
 *
 * Web ダッシュボードのアップロードフォームからも同じ ingestFile() が呼ばれる。
 * 対応: 音声/動画 (webm/mp3/m4a/wav/mp4/mov/ogg/flac ...)。大きいファイルは自動圧縮。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ensureDirs } from './config.js';
import { db } from './db.js';
import { findBusiness } from './businesses.js';
import { RECORDING_EXTS } from './media.js';
import { runPipeline } from './pipeline.js';
import { log } from './util.js';

export interface IngestOptions {
  title?: string;
  business?: string | null;
  startAt?: string; // ISO 文字列
}

/**
 * 録音ファイルを会議として登録する (パイプラインはまだ回さない)。
 * Web アップロードでは「登録して即リダイレクト → 裏でパイプライン」にするために分けてある。
 * @param move true なら元ファイルを移動、false ならコピー (一時ファイルは移動)
 * @returns meeting id
 */
export function registerUpload(filePath: string, opts: IngestOptions = {}, move = false): string {
  ensureDirs();
  if (!fs.existsSync(filePath)) throw new Error(`ファイルが見つかりません: ${filePath}`);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!RECORDING_EXTS.includes(ext)) {
    throw new Error(`未対応の拡張子です: .${ext}（対応: ${RECORDING_EXTS.join(', ')}）`);
  }

  const id = crypto.randomUUID();
  const dir = path.join(cfg.dataDir, 'meetings', id);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `recording.${ext}`);
  if (move) fs.renameSync(filePath, dest);
  else fs.copyFileSync(filePath, dest);

  const title = opts.title?.trim() || path.basename(filePath).replace(/\.[^.]+$/, '');
  const business = opts.business ? findBusiness(opts.business)?.name ?? null : null;
  const startAt = opts.startAt || fileDateOrNow(filePath);

  db.prepare(
    `INSERT INTO meetings (id, title, start_at, url, provider, business, status, dir)
     VALUES (?, ?, ?, NULL, 'upload', ?, 'ended', ?)`
  ).run(id, title, startAt, business, dir);

  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ meetingId: id, title, startAt, source: 'upload', recStartedAt: null }, null, 2)
  );
  log('ingest', `取り込み登録: ${title} (${ext}, 事業=${business ?? '自動分類'})`);
  return id;
}

/** 録音ファイルを取り込んで、そのまま議事録化まで実行する (CLI 用)。 */
export async function ingestFile(
  filePath: string,
  opts: IngestOptions = {},
  move = false
): Promise<string> {
  const id = registerUpload(filePath, opts, move);
  await runPipeline(id);
  return id;
}

function fileDateOrNow(filePath: string): string {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.log('usage: npm run ingest -- <ファイル> [--title タイトル] [--business 事業名] [--date YYYY-MM-DD]');
    process.exit(1);
  }
  const date = arg('date');
  ingestFile(file, {
    title: arg('title'),
    business: arg('business') ?? null,
    startAt: date ? new Date(date).toISOString() : undefined,
  })
    .then((id) => {
      log('ingest', `完了: ${cfg.publicUrl}/m/${id}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
}
