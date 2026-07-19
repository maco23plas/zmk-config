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

/** Zoom の招待 URL を Web クライアント URL に変換する (/j/ /w/ /wc/join/ に対応) */
export function toWebClientUrl(url: string): string {
  const m = url.match(/https?:\/\/([\w.-]*zoom\.us)\/(?:j|w|wc\/join)\/(\d+)(?:\?[^#]*)?/i);
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

    // 「アプリを起動」画面に飛ばされたら「ブラウザから参加」を辿る
    try {
      await page
        .getByRole('link', { name: /Join from Your Browser|ブラウザから参加|ブラウザから参加する/i })
        .first()
        .click({ timeout: 3000 });
      await sleep(1500);
    } catch {
      /* 直接 /wc/join に来ていれば不要 */
    }

    // 名前入力: ゲスト参加時のみ表示される。Zoom にログイン済みなら省略されることがあるので
    // 「無ければスキップ」にして、サインイン必須の会議でも失敗しないようにする。
    try {
      const nameInput = page
        .locator('#input-for-name, input[placeholder*="Name" i], input[aria-label*="名前" i]')
        .first();
      if (await nameInput.isVisible({ timeout: 8000 }).catch(() => false)) {
        await nameInput.fill(cfg.botName);
      } else {
        log('bot', '名前入力欄なし (Zoom ログイン済みの可能性)');
      }
    } catch {
      /* 省略可 */
    }

    // パスコード (URL に pwd があれば埋める)
    try {
      const pwdInput = page
        .locator('#input-for-pwd, input[placeholder*="Passcode" i], input[placeholder*="パスコード" i]')
        .first();
      if (await pwdInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        const pwd = meeting.url!.match(/[?&]pwd=([^&#]+)/)?.[1];
        if (pwd) await pwdInput.fill(decodeURIComponent(pwd));
      }
    } catch {
      /* パスコード不要 */
    }

    // 参加ボタン (押せなくても既に参加処理に入っていることがあるので続行)
    try {
      await page.getByRole('button', { name: /^(Join|参加|参加する)$/i }).first().click({ timeout: 10_000 });
    } catch {
      log('bot', 'Zoom 参加ボタンが見当たらず (自動遷移済みの可能性) — 入室待ちに進みます');
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

    // ホストが録画している場合などの同意ダイアログが出たら同意して続行
    try {
      await page
        .getByRole('button', { name: /I Consent|Consent|同意して続行|同意します|同意|Continue|続行/i })
        .first()
        .click({ timeout: 3000 });
    } catch {
      /* 同意ダイアログなし */
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
