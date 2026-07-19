/**
 * 会議終了後の全自動パイプライン:
 * 文字起こし → 事業分類 → 議事録/タスク/NA 生成 → 事業フォルダへ整理 → Drive 共有 → 配信
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getBusinesses } from './businesses.js';
import { cfg } from './config.js';
import { db, getMeeting, openTasks, setMeetingStatus, updateMeeting, attendeesOf } from './db.js';
import type { MeetingRow } from './db.js';
import { deliverMeeting, uploadMeetingToDrive } from './deliver.js';
import { chatJSON, chatText } from './llm.js';
import { attributeSpeakers, transcribe, transcriptToText } from './stt.js';
import type { Seg } from './stt.js';
import { log, slug, truncate, ymd } from './util.js';

const MinutesSchema = z.object({
  summary_md: z.string(),
  decisions: z.array(z.object({ text: z.string(), time: z.string().nullish() })).default([]),
  discussions: z
    .array(z.object({ topic: z.string(), summary: z.string(), conclusion: z.string().nullish() }))
    .default([]),
  pending: z.array(z.object({ text: z.string(), reason: z.string().nullish() })).default([]),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        assignee: z.string().nullish(),
        due: z.string().nullish(),
        note: z.string().nullish(),
      })
    )
    .default([]),
  next_agenda: z.array(z.object({ topic: z.string(), why: z.string().nullish() })).default([]),
  task_updates: z
    .array(
      z.object({
        task_id: z.string(),
        status: z.enum(['done', 'open', 'cancelled']),
        evidence: z.string().nullish(),
      })
    )
    .default([]),
});
export type Minutes = z.infer<typeof MinutesSchema>;

const MAX_TRANSCRIPT_CHARS = 48_000;
const CHUNK_CHARS = 36_000;

export async function runPipeline(meetingId: string): Promise<void> {
  const m = getMeeting(meetingId);
  if (!m || !m.dir) return;
  if (m.status === 'delivered' || m.status === 'processing') {
    log('pipeline', `スキップ (status=${m.status}): ${m.title}`);
    return;
  }
  setMeetingStatus(m.id, 'processing');
  log('pipeline', `後処理開始: ${m.title}`);
  try {
    // 1. 文字起こし
    const recording = path.join(m.dir, 'recording.webm');
    if (!fs.existsSync(recording)) throw new Error('録音ファイルが見つかりません');
    const transcriptPath = path.join(m.dir, 'transcript.json');
    let transcript = fs.existsSync(transcriptPath)
      ? (JSON.parse(fs.readFileSync(transcriptPath, 'utf8')) as { segments: Seg[] })
      : null;
    if (!transcript || transcript.segments.length === 0) {
      transcript = await transcribe(recording);
      fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));
    }
    const meta = readMeta(m.dir);
    const segments = attributeSpeakers(
      transcript.segments,
      path.join(m.dir, 'events.jsonl'),
      meta?.recStartedAt ?? 0
    );
    if (segments.length === 0) throw new Error('文字起こし結果が空でした');
    fs.writeFileSync(path.join(m.dir, 'transcript.md'), transcriptToText(segments));
    log('pipeline', `文字起こし完了: ${segments.length} セグメント`);

    // 2. 事業分類
    let business = m.business;
    if (!business) {
      business = await classifyBusiness(m, segments);
      if (business) updateMeeting(m.id, { business });
      log('pipeline', `事業分類: ${business ?? '未分類'}`);
    }

    // 3. 議事録 + タスク + NA 生成
    const minutes = await generateMinutes(m, business, segments);
    fs.writeFileSync(path.join(m.dir, 'minutes.json'), JSON.stringify(minutes, null, 2));
    const minutesMd = renderMinutesMd(m, business, minutes);
    fs.writeFileSync(path.join(m.dir, 'minutes.md'), minutesMd);

    // 4. タスク台帳へ反映
    applyTasks(m, business, minutes);

    // 5. 事業フォルダへ移動
    const destDir = moveToBusinessFolder(m, business);

    // 6. Google Drive へアップロードして共有リンク発行 (設定時のみ)
    try {
      const shareUrl = await uploadMeetingToDrive(destDir, `${ymd(new Date(m.start_at), cfg.tz)} ${m.title}`);
      if (shareUrl) updateMeeting(m.id, { share_url: shareUrl });
    } catch (e) {
      log('pipeline', 'Drive アップロードに失敗 (継続):', (e as Error).message);
    }

    // 7. メール / Slack 配信
    await deliverMeeting(m.id);
    setMeetingStatus(m.id, 'delivered');
    log('pipeline', `完了: ${m.title}`);
  } catch (e) {
    setMeetingStatus(m.id, 'failed', (e as Error).message);
    log('pipeline', `失敗: ${m.title} —`, (e as Error).message);
  }
}

function readMeta(dir: string): { recStartedAt?: number } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function classifyBusiness(m: MeetingRow, segments: Seg[]): Promise<string | null> {
  const businesses = getBusinesses();
  if (businesses.length === 0) return null;
  const attendees = attendeesOf(m);

  // メールドメイン・キーワードで機械的に当たれば LLM を呼ばない (無料枠の節約)
  for (const b of businesses) {
    const emailHit = b.emails.some((e) =>
      attendees.some((a) => a.email && (a.email === e || a.email.endsWith(e.replace(/^@?/, '@'))))
    );
    const kwHit = b.keywords.some((k) => m.title.includes(k));
    if (emailHit || kwHit) return b.name;
  }

  const Schema = z.object({
    business: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    reason: z.string().nullish(),
  });
  const head = transcriptToText(segments, false).slice(0, 3000);
  const result = await chatJSON(
    'あなたは会議を事業(プロジェクト)に分類するアシスタントです。確信が持てない場合は business を null にしてください。出力は JSON のみ。',
    [
      '## 事業一覧',
      ...businesses.map((b) => `- ${b.name}: ${b.description} (キーワード: ${b.keywords.join(', ') || 'なし'})`),
      '',
      `## 会議タイトル\n${m.title}`,
      `## 参加者\n${attendees.map((a) => a.name || a.email).join(', ') || '不明'}`,
      `## 会議冒頭の内容\n${head}`,
      '',
      '## 出力形式 (JSON)',
      '{"business": "事業名 or null", "confidence": 0.0〜1.0, "reason": "判定理由"}',
    ].join('\n'),
    Schema
  );
  const valid = businesses.find((b) => b.name === result.business);
  return valid && result.confidence >= 0.5 ? valid.name : null;
}

async function generateMinutes(m: MeetingRow, business: string | null, segments: Seg[]): Promise<Minutes> {
  let text = transcriptToText(segments);

  // 長時間会議は要点抽出 (map) → 統合 (reduce) の2段にしてコンテキストに収める
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    log('pipeline', `書き起こしが長い (${text.length}字) ため分割要約します`);
    const digests: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_CHARS) {
      const chunk = text.slice(i, i + CHUNK_CHARS);
      digests.push(
        await chatText(
          'あなたは会議書き起こしの要点抽出アシスタントです。発言に忠実に、創作せず抽出してください。',
          `以下の会議書き起こし(一部)から「論点と結論」「決定事項」「タスク(担当/期限)」「保留事項」「重要な数字」を漏れなく箇条書きで抽出してください。\n\n${chunk}`,
          4096
        )
      );
    }
    text = `(以下は長時間会議のパート別要点抽出です)\n\n${digests
      .map((d, i) => `## パート${i + 1}\n${d}`)
      .join('\n\n')}`;
  }

  const prevTasks = business ? openTasks(business) : [];
  const attendees = attendeesOf(m);

  const system = [
    'あなたは日本語の優秀な経営秘書です。会議の書き起こしから正確で実用的な議事録を作成します。',
    'ルール:',
    '- 書き起こしに存在しない事実を創作しない',
    '- 「決定事項」と「タスク(宿題)」を厳密に区別する',
    '- タスクは発言から特定できる場合のみ担当者(assignee)・期限(due, YYYY-MM-DD)を入れる',
    '- 既存の未完了タスクへの言及があれば task_updates で報告する (完了報告→done)',
    '- next_agenda は「次回話すべきこと」。今回の保留事項・未完了タスク・持ち越しを踏まえて提案する',
    '- 出力は指定の JSON のみ',
  ].join('\n');

  const user = [
    `## 会議情報`,
    `タイトル: ${m.title}`,
    `日時: ${m.start_at}`,
    `事業: ${business ?? '未分類'}`,
    `参加者: ${attendees.map((a) => a.name || a.email).join(', ') || '(不明)'}`,
    '',
    prevTasks.length > 0
      ? `## この事業の既存未完了タスク (言及があれば task_updates で状態を報告)\n${prevTasks
          .map((t) => `- [id:${t.id}] ${t.title} (担当: ${t.assignee ?? '未定'}, 期限: ${t.due ?? '未定'})`)
          .join('\n')}\n`
      : '',
    `## 書き起こし`,
    truncate(text, MAX_TRANSCRIPT_CHARS),
    '',
    '## 出力形式 (JSON)',
    JSON.stringify({
      summary_md: '会議全体の要約 (Markdown, 300字程度)',
      decisions: [{ text: '決定した内容', time: '12:34 (書き起こしのタイムスタンプ, 任意)' }],
      discussions: [{ topic: '論点', summary: '議論内容', conclusion: '結論 (出ていれば)' }],
      pending: [{ text: '保留になったこと', reason: '保留理由' }],
      tasks: [{ title: 'タスク', assignee: '担当者名', due: 'YYYY-MM-DD', note: '補足' }],
      next_agenda: [{ topic: '次回話すべきこと', why: '理由' }],
      task_updates: [{ task_id: '既存タスクのid', status: 'done | open | cancelled', evidence: '根拠発言' }],
    }),
  ].join('\n');

  return chatJSON(system, user, MinutesSchema);
}

export function renderMinutesMd(m: MeetingRow, business: string | null, minutes: Minutes): string {
  const lines: string[] = [];
  lines.push(`# 議事録: ${m.title}`);
  lines.push('');
  lines.push(`- 日時: ${new Date(m.start_at).toLocaleString('ja-JP', { timeZone: cfg.tz })}`);
  lines.push(`- 事業: ${business ?? '未分類'}`);
  const att = attendeesOf(m)
    .map((a) => a.name || a.email)
    .filter(Boolean);
  if (att.length) lines.push(`- 参加者: ${att.join(', ')}`);
  lines.push('');
  lines.push('## 概要');
  lines.push(minutes.summary_md);
  if (minutes.decisions.length) {
    lines.push('', '## 決定事項');
    minutes.decisions.forEach((d) => lines.push(`- ${d.text}${d.time ? ` (${d.time})` : ''}`));
  }
  if (minutes.discussions.length) {
    lines.push('', '## 論点と議論');
    minutes.discussions.forEach((d) => {
      lines.push(`### ${d.topic}`);
      lines.push(d.summary);
      if (d.conclusion) lines.push(`**結論**: ${d.conclusion}`);
      lines.push('');
    });
  }
  if (minutes.pending.length) {
    lines.push('', '## 保留事項');
    minutes.pending.forEach((p) => lines.push(`- ${p.text}${p.reason ? `（${p.reason}）` : ''}`));
  }
  if (minutes.tasks.length) {
    lines.push('', '## タスク');
    minutes.tasks.forEach((t) =>
      lines.push(`- [ ] ${t.title}（担当: ${t.assignee ?? '未定'} / 期限: ${t.due ?? '未定'}）`)
    );
  }
  if (minutes.next_agenda.length) {
    lines.push('', '## 次回アジェンダ案 (NA)');
    minutes.next_agenda.forEach((n) => lines.push(`- ${n.topic}${n.why ? `（${n.why}）` : ''}`));
  }
  return lines.join('\n');
}

function applyTasks(m: MeetingRow, business: string | null, minutes: Minutes) {
  const insert = db.prepare(
    `INSERT INTO tasks (id, business, meeting_id, title, assignee, due, note) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of minutes.tasks) {
    insert.run(crypto.randomUUID(), business, m.id, t.title, t.assignee ?? null, t.due ?? null, t.note ?? null);
  }
  const update = db.prepare(
    `UPDATE tasks SET status = ?, note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ?`
  );
  for (const u of minutes.task_updates) {
    update.run(u.status, u.evidence ?? null, u.task_id);
  }
  if (minutes.tasks.length || minutes.task_updates.length) {
    log('pipeline', `タスク: 新規 ${minutes.tasks.length} 件 / 更新 ${minutes.task_updates.length} 件`);
  }
}

function moveToBusinessFolder(m: MeetingRow, business: string | null): string {
  const folder = business ?? '_inbox';
  const name = `${ymd(new Date(m.start_at), cfg.tz)}-${slug(m.title)}-${m.id.slice(0, 6)}`;
  const dest = path.join(cfg.dataDir, 'businesses', folder, name);
  if (m.dir === dest) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(m.dir!, dest);
    updateMeeting(m.id, { dir: dest });
    return dest;
  } catch (e) {
    log('pipeline', 'フォルダ移動に失敗 (元の場所のまま継続):', (e as Error).message);
    return m.dir!;
  }
}
