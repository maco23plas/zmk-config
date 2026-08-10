/** 録音ファイルの探索と、文字起こし前の前処理 (大きいファイルの圧縮) */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { log } from './util.js';

// 録音として受け付ける拡張子 (アップロード + Bot の webm)
export const RECORDING_EXTS = [
  'webm', 'mp3', 'm4a', 'wav', 'mp4', 'ogg', 'opus', 'mpeg', 'mpga', 'aac', 'flac', 'mov', 'mkv',
];

const MIME: Record<string, string> = {
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase().replace(/^\./, '')] || 'application/octet-stream';
}

/** dir 内の recording.* を1つ返す (Bot は recording.webm、アップロードは元拡張子) */
export function findRecording(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^recording\.([a-z0-9]+)$/i);
    if (m && RECORDING_EXTS.includes(m[1].toLowerCase())) return path.join(dir, f);
  }
  return null;
}

let ffmpegBinCache: string | null | undefined;
/** 使う ffmpeg のパスを返す。同梱の ffmpeg-static を最優先し、無ければシステムの ffmpeg。 */
export function ffmpegBin(): string | null {
  if (ffmpegBinCache !== undefined) return ffmpegBinCache;
  // 同梱バイナリ (パッケージ済みアプリでは asar の外に展開されている)
  let p = (ffmpegStatic as unknown as string | null) || '';
  if (p) p = p.replace('app.asar', 'app.asar.unpacked');
  if (p && fs.existsSync(p)) {
    try {
      fs.chmodSync(p, 0o755);
    } catch {
      /* 権限変更できなくても実行できることがある */
    }
    ffmpegBinCache = p;
    return p;
  }
  // フォールバック: システムにインストールされた ffmpeg
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegBinCache = 'ffmpeg';
  } catch {
    ffmpegBinCache = null;
  }
  return ffmpegBinCache;
}

export function hasFfmpeg(): boolean {
  return ffmpegBin() !== null;
}

// Groq の Whisper は 1 リクエスト最大 25MB。安全側で 24MB を上限にする。
const GROQ_LIMIT = 24 * 1024 * 1024;
// 分割する場合の 1 チャンクの長さ (秒)。15分 ≈ 16kHz mono opus で約 2〜3MB。
export const SEGMENT_SEC = 900;
const GROQ_AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.flac', '.webm', '.mpga'];

export interface GroqChunk {
  path: string;
  offsetSec: number;
}

/**
 * Groq へ送る音声を用意する。長時間・動画・大きいファイルは ffmpeg で
 * 16kHz モノラル opus に変換しつつ 15 分ごとに分割し、各チャンクと開始オフセットを返す。
 * これにより 2〜3 時間の録画でも 25MB 制限を超えず文字起こしできる。
 */
export function prepareGroqAudio(file: string, tmpDir: string): GroqChunk[] {
  const size = fs.statSync(file).size;
  const ext = path.extname(file).toLowerCase();

  // すでに小さく、Groq がそのまま受け付ける音声形式ならそのまま 1 チャンク
  if (size <= GROQ_LIMIT && GROQ_AUDIO_EXTS.includes(ext)) {
    return [{ path: file, offsetSec: 0 }];
  }

  const ff = ffmpegBin();
  if (!ff) {
    if (size <= GROQ_LIMIT) return [{ path: file, offsetSec: 0 }];
    throw new Error(
      `録音が大きすぎます (${(size / 1024 / 1024).toFixed(1)}MB) が、音声を変換できませんでした。`
    );
  }

  fs.mkdirSync(tmpDir, { recursive: true });
  // 掃除 (前回の分割ファイルが残っていると混ざる)
  for (const f of fs.readdirSync(tmpDir)) {
    if (/^seg_\d+\.ogg$/.test(f)) fs.rmSync(path.join(tmpDir, f));
  }
  const pattern = path.join(tmpDir, 'seg_%03d.ogg');
  log('media', `音声を 16kHz mono opus に変換し、${SEGMENT_SEC / 60}分ごとに分割します`);
  execFileSync(
    ff,
    [
      '-y', '-i', file,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '16k',
      '-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-reset_timestamps', '1',
      pattern,
    ],
    { stdio: 'ignore' }
  );
  const segs = fs
    .readdirSync(tmpDir)
    .filter((f) => /^seg_\d+\.ogg$/.test(f))
    .sort();
  if (segs.length === 0) throw new Error('音声の抽出に失敗しました (ファイルが壊れている可能性)');
  if (segs.length > 1) log('media', `${segs.length} チャンクに分割しました`);
  return segs.map((f, i) => ({ path: path.join(tmpDir, f), offsetSec: i * SEGMENT_SEC }));
}
