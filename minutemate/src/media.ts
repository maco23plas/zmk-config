/** 録音ファイルの探索と、文字起こし前の前処理 (大きいファイルの圧縮) */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

let ffmpegCache: boolean | null = null;
export function hasFfmpeg(): boolean {
  if (ffmpegCache !== null) return ffmpegCache;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegCache = true;
  } catch {
    ffmpegCache = false;
  }
  return ffmpegCache;
}

// Groq の Whisper は 1 リクエスト最大 25MB。安全側で 24MB を上限にする。
const GROQ_LIMIT = 24 * 1024 * 1024;

/**
 * Groq へ送る前にファイルを整える。大きすぎる (動画・長時間) 場合は ffmpeg で
 * 16kHz モノラル opus に圧縮する。ffmpeg が無く上限超過なら分かりやすいエラーを投げる。
 * 返り値は実際に送信すべきファイルパス。
 */
export function preprocessForGroq(file: string, tmpDir: string): string {
  const size = fs.statSync(file).size;
  if (size <= GROQ_LIMIT) return file;

  if (!hasFfmpeg()) {
    throw new Error(
      `録音が大きすぎます (${(size / 1024 / 1024).toFixed(1)}MB > 24MB)。` +
        'ffmpeg をインストールするか、STT_PROVIDER=local (faster-whisper) をお使いください。'
    );
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  const out = path.join(tmpDir, 'stt-input.ogg');
  log('media', `録音が大きい (${(size / 1024 / 1024).toFixed(1)}MB) ため 16kHz mono opus に圧縮します`);
  execFileSync(
    'ffmpeg',
    ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '16k', out],
    { stdio: 'ignore' }
  );
  const outSize = fs.statSync(out).size;
  if (outSize > GROQ_LIMIT) {
    throw new Error(
      `圧縮後もファイルが大きすぎます (${(outSize / 1024 / 1024).toFixed(1)}MB)。` +
        '長時間の録音は STT_PROVIDER=local をお使いください。'
    );
  }
  return out;
}
