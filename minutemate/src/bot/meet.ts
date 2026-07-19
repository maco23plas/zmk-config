import type { Page } from 'playwright';
import path from 'node:path';
import { cfg } from '../config.js';
import type { MeetingRow } from '../db.js';
import { log, sleep } from '../util.js';
import {
  JoinResult,
  ParticipantSnapshot,
  dismissPopups,
  launchBot,
  runCallLoop,
  screenshot,
  stopRecorder,
  wireRecorder,
} from './common.js';

const JOIN_BTN = /Join now|Ask to join|今すぐ参加|参加をリクエスト/i;
const LEAVE_SEL = '[aria-label*="Leave call" i], [aria-label*="通話から退出"]';
const MIC_OFF = '[aria-label*="Turn off microphone" i], [aria-label*="マイクをオフ"]';
const CAM_OFF = '[aria-label*="Turn off camera" i], [aria-label*="カメラをオフ"]';

/**
 * Google Meet に参加して録音する。
 * BOT_EMAIL のアカウントで `npm run bot:login` 済みなら、招待されている会議には
 * ノック (参加リクエスト) なしで入れる。未ログインならゲストとして名前を入力し
 * 主催者の承認を待つ。
 */
export async function joinMeet(meeting: MeetingRow, dir: string): Promise<JoinResult> {
  const context = await launchBot();
  const closeStream = await wireRecorder(context, dir);
  const page = await context.newPage();
  try {
    log('bot', `Meet に接続: ${meeting.url}`);
    await page.goto(meeting.url!, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(3000);
    await dismissPopups(page);

    // マイク・カメラをオフ (プレビュー画面)
    for (const sel of [MIC_OFF, CAM_OFF]) {
      try {
        await page.locator(sel).first().click({ timeout: 3000 });
      } catch {
        /* すでにオフ or UI 差異 */
      }
    }

    // ゲスト参加なら名前を入力
    try {
      const nameInput = page
        .locator('input[placeholder*="name" i], input[aria-label*="名前"], input[aria-label*="Your name" i]')
        .first();
      if (await nameInput.isVisible({ timeout: 2000 })) {
        await nameInput.fill(cfg.botName);
      }
    } catch {
      /* ログイン済みなら名前入力は無い */
    }

    // 参加ボタン
    const joinBtn = page.getByRole('button', { name: JOIN_BTN }).first();
    await joinBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await joinBtn.click();
    log('bot', '参加をリクエストしました。入室待ち…');

    // 入室完了 (退出ボタンが出る) を待つ
    try {
      await page
        .locator(LEAVE_SEL)
        .first()
        .waitFor({ state: 'visible', timeout: cfg.admitTimeoutMin * 60_000 });
    } catch {
      await screenshot(page, meeting.id, 'not-admitted');
      return { ok: false, error: `${cfg.admitTimeoutMin}分待っても入室が許可されませんでした`, participants: [] };
    }
    log('bot', '入室しました。録音を開始します');

    await page.evaluate('window.__mmStart && window.__mmStart()');
    const recStartedAt = Date.now();

    await announceInChat(page);

    const participants = await runCallLoop(page, dir, {
      isInCall: async () => (await page.locator(LEAVE_SEL).count()) > 0,
      snapshot: () => snapshotParticipants(page),
      leave: async () => {
        await page.locator(LEAVE_SEL).first().click({ timeout: 5000 });
      },
    });

    await stopRecorder(page);
    return { ok: true, recStartedAt, endedAt: Date.now(), participants };
  } catch (e) {
    await screenshot(page, meeting.id, 'error');
    return { ok: false, error: (e as Error).message, participants: [] };
  } finally {
    closeStream();
    await context.close().catch(() => {});
  }
}

async function announceInChat(page: Page) {
  if (!cfg.chatAnnounce) return;
  try {
    await page
      .locator('[aria-label*="chat" i], [aria-label*="チャット"]')
      .first()
      .click({ timeout: 5000 });
    const input = page
      .locator('textarea[aria-label*="message" i], textarea[placeholder*="メッセージ"], textarea')
      .first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(cfg.chatAnnounce);
    await input.press('Enter');
    await sleep(500);
    // チャットパネルを閉じる (タイル検出の邪魔になるため)
    await page.keyboard.press('Escape').catch(() => {});
  } catch {
    log('bot', 'チャットでの録音告知に失敗 (継続します)');
  }
}

/**
 * 参加者タイルから人数・名前・発話中の人を取得する。
 * Meet の DOM は変わりやすいのでベストエフォート。取れなくても録音は継続する。
 */
async function snapshotParticipants(page: Page): Promise<ParticipantSnapshot> {
  return page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[data-participant-id]'));
    const names = new Set<string>();
    const speaking = new Set<string>();
    for (const t of tiles) {
      const el = t as HTMLElement;
      const name =
        (el.getAttribute('aria-label') || '').trim() ||
        (el.querySelector('[data-self-name]')?.getAttribute('data-self-name') || '').trim();
      if (name) names.add(name);
      const sp = el.querySelector(
        '[aria-label*="is speaking" i], [aria-label*="話しています"], [class*="speaking" i]'
      );
      if (sp && name) speaking.add(name);
    }
    return { count: tiles.length, names: [...names], speaking: [...speaking] };
  }) as Promise<ParticipantSnapshot>;
}
