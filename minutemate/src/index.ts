/**
 * メインプロセス: これを起動しておくだけで全部が自動で回る。
 *  - 2分おき: カレンダー同期 (会議検知 + Bot 自動招待)
 *  - 30秒おき: 開始が近い会議に Bot を子プロセスで自動入室させる
 *  - 5分おき: 次回会議の事前ブリーフ配信
 *  - 週次 cron: 事業ごとの進捗レポート配信
 *  - 常時: Web ダッシュボード
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cron from 'node-cron';
import { cfg, ensureDirs } from './config.js';
import { db, setMeetingStatus } from './db.js';
import type { MeetingRow } from './db.js';
import { hasGoogleAuth } from './google.js';
import { runPipeline } from './pipeline.js';
import { sendDueBriefs, weeklyReports } from './secretary.js';
import { log } from './util.js';
import { dueMeetings, syncCalendars } from './watcher.js';
import { startWeb } from './web.js';

const running = new Set<string>();
const isTs = import.meta.url.endsWith('.ts');

function spawnBot(meetingId: string) {
  if (running.has(meetingId)) return;
  running.add(meetingId);
  const args = isTs
    ? ['--import', 'tsx', 'src/bot/run.ts', '--meeting', meetingId]
    : [fileURLToPath(new URL('./bot/run.js', import.meta.url)), '--meeting', meetingId];
  log('main', `Bot プロセス起動: meeting=${meetingId}`);
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => {
    running.delete(meetingId);
    log('main', `Bot プロセス終了 (code=${code}): meeting=${meetingId}`);
    // 子プロセスが議事録生成前に落ちた場合の保険: 録音があれば後処理を親側で実行
    const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as MeetingRow | undefined;
    if (!m) return;
    if (['joining', 'recording', 'ended', 'processing'].includes(m.status)) {
      const rec = m.dir ? path.join(m.dir, 'recording.webm') : '';
      if (rec && fs.existsSync(rec) && fs.statSync(rec).size > 10_000) {
        if (m.status !== 'ended') setMeetingStatus(m.id, 'ended');
        runPipeline(m.id).catch((e) => log('main', 'pipeline error:', e.message));
      } else if (m.status !== 'ended') {
        setMeetingStatus(m.id, 'failed', 'Bot プロセスが異常終了しました');
      }
    }
  });
}

async function tickJoin() {
  for (const m of dueMeetings()) {
    setMeetingStatus(m.id, 'joining');
    spawnBot(m.id);
  }
}

function recoverOnBoot() {
  const stuck = db
    .prepare("SELECT * FROM meetings WHERE status IN ('joining','recording','ended','processing')")
    .all() as MeetingRow[];
  for (const m of stuck) {
    const rec = m.dir ? path.join(m.dir, 'recording.webm') : '';
    if (rec && fs.existsSync(rec) && fs.statSync(rec).size > 10_000) {
      log('main', `前回中断分を再処理: ${m.title}`);
      setMeetingStatus(m.id, 'ended');
      runPipeline(m.id).catch((e) => log('main', 'pipeline error:', e.message));
    } else {
      setMeetingStatus(m.id, 'failed', 'プロセス再起動により中断されました');
    }
  }
}

async function main() {
  ensureDirs();
  log('main', 'MinuteMate 起動');
  if (!hasGoogleAuth()) {
    log('main', '⚠️ Google 未認証です。`npm run auth` を実行するとカレンダー検知・メール・Drive が有効になります。');
    log('main', '   (認証なしでも `npm run bot -- --url <会議URL>` での手動参加は使えます)');
  }

  startWeb();
  recoverOnBoot();

  if (hasGoogleAuth()) {
    await syncCalendars().catch((e) => log('main', 'calendar sync error:', e.message));
    cron.schedule('*/2 * * * *', () =>
      syncCalendars().catch((e) => log('main', 'calendar sync error:', e.message))
    );
    cron.schedule('*/5 * * * *', () =>
      sendDueBriefs().catch((e) => log('main', 'brief error:', e.message))
    );
  }
  setInterval(() => tickJoin().catch((e) => log('main', 'join error:', e.message)), 30_000);
  cron.schedule(
    cfg.weeklyReportCron,
    () => weeklyReports().catch((e) => log('main', 'report error:', e.message)),
    { timezone: cfg.tz }
  );
  log('main', `監視中: カレンダー同期 2分毎 / 入室チェック 30秒毎 / ブリーフ 5分毎 / 週次レポート "${cfg.weeklyReportCron}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
