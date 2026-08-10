import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { mimeForExt, prepareGroqAudio } from './media.js';
import { groqKey, sttProvider } from './settings.js';
import { log } from './util.js';

export interface Seg {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface Transcript {
  language?: string;
  segments: Seg[];
}

/** 録音ファイル (webm/opus) を文字起こしする。groq = 無料枠 API / local = faster-whisper */
export async function transcribe(file: string): Promise<Transcript> {
  if (sttProvider() === 'groq') return transcribeGroq(file);
  return transcribeLocal(file);
}

/** 1 チャンク (25MB 以内) を Groq Whisper に投げる */
async function groqTranscribeChunk(file: string): Promise<Transcript> {
  const ext = path.extname(file).slice(1) || 'ogg';
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeForExt(ext) }), `chunk.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    language?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    text?: string;
  };
  const segments = (data.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  if (segments.length === 0 && data.text) segments.push({ start: 0, end: 0, text: data.text.trim() });
  return { language: data.language, segments };
}

async function transcribeGroq(file: string): Promise<Transcript> {
  if (!groqKey()) throw new Error('文字起こしの GROQ_API_KEY が未設定です (設定画面で入力してください)');
  // 長時間・動画・大きいファイルは 15 分ごとに分割 (2〜3時間でも通る)
  const chunks = prepareGroqAudio(file, path.join(path.dirname(file), 'tmp'));
  const merged: Seg[] = [];
  let language: string | undefined;
  for (let i = 0; i < chunks.length; i++) {
    const { path: chunkPath, offsetSec } = chunks[i];
    if (chunks.length > 1) log('stt', `文字起こし ${i + 1}/${chunks.length} …`);
    const t = await groqTranscribeChunk(chunkPath);
    language = language ?? t.language;
    for (const s of t.segments) {
      merged.push({ start: s.start + offsetSec, end: s.end + offsetSec, text: s.text });
    }
  }
  return { language, segments: merged };
}

async function transcribeLocal(file: string): Promise<Transcript> {
  const out = file + '.stt.json';
  const script = path.resolve('scripts/transcribe.py');
  log('stt', `faster-whisper (${cfg.whisperModel}) で文字起こし中… (CPU では実時間の 0.5〜2 倍かかります)`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn('python3', [script, file, out], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, WHISPER_MODEL: cfg.whisperModel },
    });
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`transcribe.py exited with ${code}`))
    );
    p.on('error', reject);
  });
  return JSON.parse(fs.readFileSync(out, 'utf8')) as Transcript;
}

interface SpeakerTick {
  t: number; // epoch ms
  speaking: string[];
}

/**
 * Bot が会議中に記録した「誰が話しているか」のサンプリング (events.jsonl) を
 * 文字起こしセグメントに重ねて話者名を付ける。
 */
export function attributeSpeakers(segments: Seg[], eventsFile: string, recStartedAt: number): Seg[] {
  if (!fs.existsSync(eventsFile) || !recStartedAt) return segments;
  const ticks: SpeakerTick[] = fs
    .readFileSync(eventsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as SpeakerTick & { speaking?: string[] };
      } catch {
        return null;
      }
    })
    .filter((x): x is SpeakerTick => !!x && Array.isArray(x.speaking));
  if (ticks.length === 0) return segments;

  return segments.map((seg) => {
    const from = recStartedAt + seg.start * 1000;
    const to = recStartedAt + seg.end * 1000;
    const votes = new Map<string, number>();
    for (const tick of ticks) {
      if (tick.t < from - 1500 || tick.t > to + 1500) continue;
      for (const name of tick.speaking) votes.set(name, (votes.get(name) ?? 0) + 1);
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? { ...seg, speaker: best[0] } : seg;
  });
}

export function transcriptToText(segments: Seg[], withTime = true): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };
  return segments
    .map((s) => {
      const time = withTime ? `[${fmt(s.start)}] ` : '';
      const who = s.speaker ? `${s.speaker}: ` : '';
      return `${time}${who}${s.text}`;
    })
    .join('\n');
}
