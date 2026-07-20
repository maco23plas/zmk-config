/**
 * デスクトップアプリで「会議に入る」ときの会議レコード生成と、
 * 録音終了後の議事録パイプライン起動。Electron のメインプロセスから呼ばれる。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ensureDirs } from './config.js';
import { db, getMeeting, setMeetingStatus } from './db.js';
import { runPipeline } from './pipeline.js';
import { log } from './util.js';

export interface LiveMeeting {
  id: string;
  dir: string;
  recordingPath: string;
  loadUrl: string; // ブラウザで開くURL (Zoom は Web クライアントに変換)
}

/** Zoom の招待 URL をアプリ内ブラウザで開ける Web クライアント URL に変換 */
function toLoadUrl(url: string): string {
  const m = url.match(/https?:\/\/([\w.-]*zoom\.us)\/(?:j|w|wc\/join)\/(\d+)(?:\?[^#]*)?/i);
  if (!m) return url;
  const pwd = url.match(/[?&]pwd=([^&#]+)/)?.[1];
  return `https://${m[1]}/wc/join/${m[2]}${pwd ? `?pwd=${pwd}` : ''}`;
}

/** 会議ウィンドウを開く直前に呼ぶ。録音先を用意して会議レコードを作る。 */
export function createLiveMeeting(url: string, title?: string): LiveMeeting {
  ensureDirs();
  const id = crypto.randomUUID();
  const dir = path.join(cfg.dataDir, 'meetings', id);
  fs.mkdirSync(dir, { recursive: true });
  const provider = /zoom\.us/i.test(url) ? 'zoom' : /meet\.google\.com/i.test(url) ? 'meet' : 'other';
  db.prepare(
    `INSERT INTO meetings (id, title, start_at, url, provider, business, status, dir)
     VALUES (?, ?, ?, ?, ?, NULL, 'recording', ?)`
  ).run(id, title || '会議', new Date().toISOString(), url, provider, dir);
  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify({ meetingId: id, title: title || '会議', url, source: 'live', recStartedAt: Date.now() }, null, 2)
  );
  log('join', `会議ウィンドウを開始: ${title || url}`);
  return { id, dir, recordingPath: path.join(dir, 'recording.webm'), loadUrl: toLoadUrl(url) };
}

/** 会議ウィンドウを閉じたら呼ぶ。録音があれば議事録パイプラインを回す。 */
export async function finishLiveMeeting(id: string): Promise<void> {
  const m = getMeeting(id);
  if (!m || !m.dir) return;
  const rec = path.join(m.dir, 'recording.webm');
  const hasAudio = fs.existsSync(rec) && fs.statSync(rec).size > 10_000;
  if (!hasAudio) {
    setMeetingStatus(id, 'failed', '録音が取得できませんでした（マイク/音声が流れていない可能性）');
    log('join', `録音なしで終了: ${m.title}`);
    return;
  }
  setMeetingStatus(id, 'ended');
  log('join', `録音完了、議事録を生成します: ${m.title}`);
  await runPipeline(id).catch((e) => log('join', 'pipeline error:', (e as Error).message));
}
