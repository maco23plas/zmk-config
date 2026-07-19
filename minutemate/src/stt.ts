import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { mimeForExt, preprocessForGroq } from './media.js';
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
  if (cfg.sttProvider === 'groq') return transcribeGroq(file);
  return transcribeLocal(file);
}

async function transcribeGroq(file: string): Promise<Transcript> {
  if (!cfg.groqApiKey) throw new Error('STT_PROVIDER=groq には GROQ_API_KEY が必要です');
  // 動画や長時間録音は 25MB 制限に合わせて前処理 (ffmpeg で圧縮)
  const sttFile = preprocessForGroq(file, path.join(path.dirname(file), 'tmp'));
  const ext = path.extname(sttFile).slice(1) || 'webm';
  const buf = fs.readFileSync(sttFile);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeForExt(ext) }), `recording.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.groqApiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq STT ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    language?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    text?: string;
  };
  const segments = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));
  if (segments.length === 0 && data.text) {
    segments.push({ start: 0, end: 0, text: data.text.trim() });
  }
  return { language: data.language, segments };
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
