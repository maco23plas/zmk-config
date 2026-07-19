/**
 * ボットの実行エントリ (会議 1 件 = 1 プロセス)。
 *   npm run bot:login                     … Bot 用 Google アカウントでログイン (初回のみ)
 *   npm run bot -- --meeting <id>         … DB 上の会議に参加 (スケジューラが呼ぶ)
 *   npm run bot -- --url <会議URL> [--title T] [--business B]  … 手動でその場参加
 */
import crypto from 'node:crypto';
import { cfg, ensureDirs } from '../config.js';
import { db } from '../db.js';
import { launchBot } from './common.js';
import { joinMeetingById } from './join.js';

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

async function main() {
  ensureDirs();
  if (process.argv[2] === 'login') {
    await loginFlow();
    return;
  }
  const meetingId = arg('meeting');
  const url = arg('url');
  if (meetingId) {
    const outcome = await joinMeetingById(meetingId);
    process.exit(outcome === 'failed' ? 2 : 0);
  }
  if (url) {
    const id = crypto.randomUUID();
    const provider = /zoom\.us/i.test(url) ? 'zoom' : 'meet';
    db.prepare(
      `INSERT INTO meetings (id, title, start_at, url, provider, business, status)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
    ).run(id, arg('title') || 'アドホック会議', new Date().toISOString(), url, provider, arg('business') ?? null);
    const outcome = await joinMeetingById(id);
    process.exit(outcome === 'failed' ? 2 : 0);
  }
  console.log('usage: npm run bot -- --url <会議URL> [--title タイトル] [--business 事業名]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
