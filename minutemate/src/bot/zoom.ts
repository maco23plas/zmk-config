import path from 'node:path';
import { cfg } from '../config.js';
import type { MeetingRow } from '../db.js';
import { log, sleep } from '../util.js';
import {
  JoinResult,
  dismissPopups,
  launchBot,
  runCallLoop,
  screenshot,
  stopRecorder,
  wireRecorder,
} from './common.js';

const LEAVE_SEL = 'button[aria-label*="Leave" i], [aria-label*="退出"]';

/** Zoom の招待 URL を Web クライアント URL に変換する */
export function toWebClientUrl(url: string): string {
  const m = url.match(/https?:\/\/([\w.-]*zoom\.us)\/j\/(\d+)(?:\?[^#]*)?/i);
  if (!m) return url;
  const pwd = url.match(/[?&]pwd=([^&#]+)/)?.[1];
  return `https://${m[1]}/wc/join/${m[2]}${pwd ? `?pwd=${pwd}` : ''}`;
}

/**
 * Zoom Web クライアントにゲストとして参加して録音する。
 * ホストの「許可」が必要な設定の場合は待機室で待つ。
 */
export async function joinZoom(meeting: MeetingRow, dir: string): Promise<JoinResult> {
  const context = await launchBot();
  const closeStream = await wireRecorder(context, dir);
  const page = await context.newPage();
  try {
    const wcUrl = toWebClientUrl(meeting.url!);
    log('bot', `Zoom Web クライアントに接続: ${wcUrl}`);
    await page.goto(wcUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(3000);
    await dismissPopups(page);

    // Cookie バナー
    try {
      await page
        .getByRole('button', { name: /Accept|同意|Agree/i })
        .first()
        .click({ timeout: 3000 });
    } catch {
      /* none */
    }

    // 名前 (+ パスコード) を入力して参加
    try {
      const nameInput = page.locator('#input-for-name, input[placeholder*="Name" i], input[aria-label*="名前"]').first();
      await nameInput.waitFor({ state: 'visible', timeout: 20_000 });
      await nameInput.fill(cfg.botName);
      const pwdInput = page.locator('#input-for-pwd, input[placeholder*="Passcode" i]').first();
      if (await pwdInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        const pwd = meeting.url!.match(/[?&]pwd=([^&#]+)/)?.[1];
        if (pwd) await pwdInput.fill(pwd);
      }
      await page.getByRole('button', { name: /^(Join|参加)$/i }).first().click({ timeout: 10_000 });
    } catch (e) {
      await screenshot(page, meeting.id, 'zoom-prejoin');
      return { ok: false, error: `Zoom 参加画面の操作に失敗: ${(e as Error).message}`, participants: [] };
    }

    // 入室待ち (待機室があれば承認まで待つ) → 退出ボタンが見えたら入室完了
    try {
      await page
        .locator(LEAVE_SEL)
        .first()
        .waitFor({ state: 'visible', timeout: cfg.admitTimeoutMin * 60_000 });
    } catch {
      await screenshot(page, meeting.id, 'zoom-not-admitted');
      return { ok: false, error: `${cfg.admitTimeoutMin}分待っても入室が許可されませんでした`, participants: [] };
    }

    // コンピューターオーディオで参加 (これをしないと音声が流れてこない)
    try {
      await page
        .getByRole('button', { name: /Join Audio by Computer|コンピューター\s*オーディオ|コンピュータ音声/i })
        .first()
        .click({ timeout: 15_000 });
    } catch {
      log('bot', 'オーディオ参加ボタンが見つからず (自動参加済みの可能性あり)');
    }

    log('bot', '入室しました。録音を開始します');
    await page.evaluate('window.__mmStart && window.__mmStart()');
    const recStartedAt = Date.now();

    const participants = await runCallLoop(page, dir, {
      isInCall: async () => (await page.locator(LEAVE_SEL).count()) > 0,
      snapshot: async () => {
        const count = await page
          .evaluate(() => {
            const badge = document.querySelector('.footer-button__number-counter, [class*="participants-count"]');
            const n = badge ? parseInt(badge.textContent || '', 10) : NaN;
            return Number.isFinite(n) ? n : 0;
          })
          .catch(() => 0);
        return { count, names: [], speaking: [] };
      },
      leave: async () => {
        await page.locator(LEAVE_SEL).first().click({ timeout: 5000 });
        await page
          .getByRole('button', { name: /Leave Meeting|ミーティングを退出/i })
          .first()
          .click({ timeout: 5000 })
          .catch(() => {});
      },
    });

    await stopRecorder(page);
    return { ok: true, recStartedAt, endedAt: Date.now(), participants };
  } catch (e) {
    await screenshot(page, meeting.id, 'zoom-error');
    return { ok: false, error: (e as Error).message, participants: [] };
  } finally {
    closeStream();
    await context.close().catch(() => {});
  }
}
