/**
 * シングルショット実行モード (GitHub Actions などの「常時マシンなし」運用向け)。
 * 15〜30分おきの cron で呼ばれる前提で、1回の実行で以下を行い終了する:
 *   1. カレンダー同期 (会議検知)
 *   2. 前回中断分の後処理リカバリ
 *   3. 事前ブリーフの配信
 *   4. まもなく始まる会議があれば開始まで待機 → 入室・録音・議事録・配信まで完了
 *
 * ブラウザ (Chromium) は会議に参加するときだけインストール/使用するので、
 * 会議のない時間帯のチェック実行は 1 分弱で終わり、無料枠を節約できる。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { cfg, ensureDirs } from './config.js';
import { db, setMeetingStatus } from './db.js';
import type { MeetingRow } from './db.js';
import { hasGoogleAuth } from './google.js';
import { joinMeetingById } from './bot/join.js';
import { runPipeline } from './pipeline.js';
import { sendDueBriefs } from './secretary.js';
import { log, sleep } from './util.js';
import { syncCalendars } from './watcher.js';

const WINDOW_MIN = Number(process.env.ONCE_WINDOW_MIN || 20);
const MAX_JOINS_PER_RUN = Number(process.env.ONCE_MAX_JOINS || 3);

function nextMeetingWithin(windowMin: number): MeetingRow | undefined {
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM meetings WHERE status = 'scheduled' ORDER BY start_at")
    .all() as MeetingRow[];
  return rows.find((m) => {
    const start = new Date(m.start_at).getTime();
    const end = m.end_at ? new Date(m.end_at).getTime() : start + 60 * 60 * 1000;
    return start - now <= windowMin * 60 * 1000 && now < end;
  });
}

/** ブラウザが未インストールなら会議参加の直前にインストールする (CI ランナー用) */
function ensureBrowser() {
  try {
    if (cfg.chromiumPath && fs.existsSync(cfg.chromiumPath)) return;
    const exe = chromium.executablePath();
    if (exe && fs.existsSync(exe)) return;
  } catch {
    /* fallthrough */
  }
  log('once', 'Chromium をインストールします…');
  execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
}

async function recoverPending() {
  const stuck = db
    .prepare("SELECT * FROM meetings WHERE status IN ('joining','recording','ended','processing')")
    .all() as MeetingRow[];
  for (const m of stuck) {
    const rec = m.dir ? path.join(m.dir, 'recording.webm') : '';
    if (rec && fs.existsSync(rec) && fs.statSync(rec).size > 10_000) {
      log('once', `前回中断分を再処理: ${m.title}`);
      setMeetingStatus(m.id, 'ended');
      await runPipeline(m.id).catch((e) => log('once', 'pipeline error:', (e as Error).message));
    } else {
      setMeetingStatus(m.id, 'failed', '前回の実行が中断されました');
    }
  }
}

async function main() {
  ensureDirs();
  log('once', `シングルショット実行 (参加ウィンドウ: ${WINDOW_MIN}分)`);

  if (hasGoogleAuth()) {
    await syncCalendars().catch((e) => log('once', 'calendar sync error:', (e as Error).message));
    await sendDueBriefs().catch((e) => log('once', 'brief error:', (e as Error).message));
  } else {
    log('once', '⚠️ Google 未認証のためカレンダー検知はスキップ (GOOGLE_TOKEN_JSON を設定してください)');
  }

  await recoverPending();

  let joins = 0;
  while (joins < MAX_JOINS_PER_RUN) {
    const next = nextMeetingWithin(WINDOW_MIN);
    if (!next) break;
    const waitMs = new Date(next.start_at).getTime() - Date.now() - 90_000;
    if (waitMs > 0) {
      log('once', `「${next.title}」の開始まで ${Math.round(waitMs / 60_000)} 分待機します`);
      await sleep(waitMs);
    }
    ensureBrowser();
    try {
      const outcome = await joinMeetingById(next.id);
      log('once', `会議完了 (${outcome}): ${next.title}`);
    } catch (e) {
      setMeetingStatus(next.id, 'failed', (e as Error).message);
      log('once', `会議処理エラー: ${next.title} —`, (e as Error).message);
    }
    joins++;
  }

  log('once', `完了 (このランでの参加: ${joins} 件)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
