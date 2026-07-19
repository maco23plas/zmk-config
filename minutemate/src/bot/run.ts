/**
 * ボットの実行エントリ (会議 1 件 = 1 プロセス)。
 *   npm run bot:login                     … Bot 用 Google アカウントでログイン (初回のみ)
 *   npm run bot -- --meeting <id>         … DB 上の会議に参加 (スケジューラが呼ぶ)
 *   npm run bot -- --url <会議URL> [--title T] [--business B]  … 手動でその場参加
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg, ensureDirs } from '../config.js';
import { db, getMeeting, setMeetingStatus, updateMeeting } from '../db.js';
import { log } from '../util.js';
import { launchBot } from './common.js';
import { joinMeet } from './meet.js';
import { joinZoom } from './zoom.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loginFlow() {
  console.log('\nブラウザが開きます。Bot 用の Google アカウント (BOT_EMAIL) でログインしてください。');
  console.log('Zoom アカウントも使う場合は zoom.us にもログインしておくと安定します。');
  console.log('終わったらブラウザを閉じてください。\n');
  const context = await launchBot(false);
  const page = await context.newPage();
  await page.goto('https://accounts.google.com/');
  await new Promise<void>((resolve) => context.on('close', () => resolve()));
  console.log('プロファイルを保存しました。');
}

async function joinAndProcess(meetingId: string, runPipelineAfter: boolean) {
  const meeting = getMeeting(meetingId);
  if (!meeting || !meeting.url) {
    console.error(`会議が見つかりません: ${meetingId}`);
    process.exit(1);
  }
  const dir = meeting.dir || path.join(cfg.dataDir, 'meetings', meeting.id);
  fs.mkdirSync(dir, { recursive: true });
  updateMeeting(meeting.id, { dir, status: 'joining' });

  const joiner = meeting.provider === 'zoom' ? joinZoom : joinMeet;
  setMeetingStatus(meeting.id, 'recording');
  const result = await joiner(meeting, dir);

  const recording = path.join(dir, 'recording.webm');
  const hasAudio = fs.existsSync(recording) && fs.statSync(recording).size > 10_000;

  fs.writeFileSync(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        meetingId: meeting.id,
        title: meeting.title,
        startAt: meeting.start_at,
        recStartedAt: result.recStartedAt ?? null,
        endedAt: result.endedAt ?? null,
        participants: result.participants,
        error: result.error ?? null,
      },
      null,
      2
    )
  );

  if (!result.ok && !hasAudio) {
    setMeetingStatus(meeting.id, 'failed', result.error);
    log('bot', `参加失敗: ${meeting.title} — ${result.error}`);
    // 失敗してもオーナーに知らせる (メール設定があれば)
    try {
      const { notifyFailure } = await import('../deliver.js');
      await notifyFailure(meeting, result.error ?? '不明なエラー');
    } catch {
      /* ignore */
    }
    process.exit(2);
  }

  setMeetingStatus(meeting.id, 'ended');
  log('bot', `録音完了: ${meeting.title} (${hasAudio ? fs.statSync(recording).size : 0} bytes)`);

  if (runPipelineAfter) {
    const { runPipeline } = await import('../pipeline.js');
    await runPipeline(meeting.id);
  }
}

async function main() {
  ensureDirs();
  if (process.argv[2] === 'login') {
    await loginFlow();
    return;
  }
  const meetingId = arg('meeting');
  const url = arg('url');
  if (meetingId) {
    await joinAndProcess(meetingId, true);
    return;
  }
  if (url) {
    const id = crypto.randomUUID();
    const provider = /zoom\.us/i.test(url) ? 'zoom' : 'meet';
    db.prepare(
      `INSERT INTO meetings (id, title, start_at, url, provider, business, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
    ).run(id, arg('title') || 'アドホック会議', new Date().toISOString(), url, provider, arg('business') ?? null);
    await joinAndProcess(id, true);
    return;
  }
  console.log('usage: npm run bot -- --url <会議URL> [--title タイトル] [--business 事業名]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
