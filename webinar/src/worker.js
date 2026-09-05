// 通知ワーカー。送信時刻の来た通知をLINEへ送る。
// Node では一定間隔のタイマーで、Cloudflare では Cron Trigger（1分ごと）で呼ばれる。

import { clock } from './clock.js';
import { config } from './config.js';
import { log } from './lib/log.js';
import {
  dueJobs, claimJob, markSent, markSkipped, markFailure, reclaimStuckJobs,
} from './domain/notifications.js';
import { generateSessionsFromRules } from './domain/sessions.js';
import { buildContext, buildMessage } from './line/messages.js';
import { canPushTo } from './line/webhook.js';
import { pushMessage, LineApiError } from './line/client.js';

/**
 * 送信待ちを1巡ぶん処理する。
 * @returns {Promise<{sent:number, skipped:number, failed:number}>}
 */
export async function runOnce(now = clock.now(), limit = config.maxSendsPerRun) {
  const stats = { sent: 0, skipped: 0, failed: 0 };

  await reclaimStuckJobs(now);
  const jobs = await dueJobs(now, limit);

  for (const job of jobs) {
    // 予約や開催枠の状況が変わっていたら送らない
    const reason = await skipReason(job, now);
    if (reason) {
      await markSkipped(job.id, reason, now);
      stats.skipped++;
      continue;
    }

    // 実行が重なっても二重送信しないよう、送信前に自分のものとして確保する
    if (!(await claimJob(job.id, now))) continue;

    try {
      const message = buildMessage(job.kind, buildContext(job), now);
      // 同じジョブの再送では同じキーを使う。LINE側で重複が排除される。
      await pushMessage(job.line_user_id, message, { kind: job.kind, retryKey: retryKeyFor(job) });
      await markSent(job.id, now);
      stats.sent++;
      log.info(`通知を送信: ${job.kind} → ${job.name} (${job.title})`);
    } catch (err) {
      const permanent = err instanceof LineApiError && err.permanent;
      const { retryAt } = await markFailure(job, err.message, now, { permanent });
      stats.failed++;
      log[permanent ? 'error' : 'warn'](
        `通知の送信に失敗: ${job.kind} → ${job.name}: ${err.message}`
        + (retryAt ? `（${Math.round((retryAt - now) / 1000)}秒後に再試行）` : '（再試行しません）'),
      );
    }
  }
  return stats;
}

async function skipReason(job, now) {
  if (job.reservation_status !== 'active') return '予約がキャンセルされたため';
  if (job.session_status === 'canceled') return '開催が中止されたため';
  if (!job.line_user_id) return 'LINE未連携のため';
  if (now > job.deadline_at) return '送信期限を過ぎたため';
  if (!(await canPushTo(job.line_user_id))) return 'ブロック（友だち解除）されているため';
  return null;
}

/** 再送で同じ値になり、別ジョブとは衝突しないUUID形式のキー */
function retryKeyFor(job) {
  let hex = '';
  for (const ch of `${job.reservation_id}:${job.kind}:${job.attempts}`) {
    hex += ch.charCodeAt(0).toString(16).padStart(2, '0');
  }
  const h = (hex + '0'.repeat(32)).slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** 定期実行の1回ぶん（開催枠の自動生成＋通知送信） */
export async function tickOnce(now = clock.now()) {
  const created = await generateSessionsFromRules(now);
  if (created > 0) log.info(`定期開催ルールから開催枠を${created}件追加しました`);
  const stats = await runOnce(now);
  if (stats.sent || stats.failed) {
    log.info(`通知ワーカー: 送信${stats.sent} / 失敗${stats.failed} / 見送り${stats.skipped}`);
  }
  return stats;
}

// ---- Node.js 常駐用のタイマー ----------------------------------------------

let timer = null;
let running = false;

export function startWorker(intervalMs = config.workerIntervalMs) {
  if (timer) return timer;

  const tick = async () => {
    if (running) return; // 前回の巡回が終わっていなければ見送る
    running = true;
    try {
      await tickOnce(clock.now());
    } catch (err) {
      log.error('通知ワーカーで例外:', err?.stack || err);
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  log.info(`通知ワーカーを開始しました（${Math.round(intervalMs / 1000)}秒間隔${config.dryRun ? '・ドライラン' : ''}）`);
  return timer;
}

export function stopWorker() {
  if (timer) { clearInterval(timer); timer = null; }
}
