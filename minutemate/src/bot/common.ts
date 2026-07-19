import { chromium } from 'playwright';
import type { BrowserContext, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../config.js';
import { log, sleep } from '../util.js';
import { RECORDER_JS } from './recorder.js';

export interface JoinResult {
  ok: boolean;
  error?: string;
  recStartedAt?: number;
  endedAt?: number;
  participants: string[];
}

export interface ParticipantSnapshot {
  count: number;
  names: string[];
  speaking: string[];
}

export const PROFILE_DIR = () => path.join(cfg.dataDir, 'browser-profile');

export async function launchBot(headlessOverride?: boolean): Promise<BrowserContext> {
  const headless = headlessOverride ?? cfg.headless;
  // プロキシ環境 (HTTPS_PROXY) を Chromium にも反映する
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY;
  return chromium.launchPersistentContext(PROFILE_DIR(), {
    headless,
    executablePath: cfg.chromiumPath || undefined,
    ...(proxy ? { proxy: { server: proxy } } : {}),
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--mute-audio'],
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--lang=ja',
    ],
  });
}

/** 録音チャンク (base64) をファイルに書き出す受け口を張る */
export async function wireRecorder(context: BrowserContext, dir: string): Promise<() => void> {
  const file = path.join(dir, 'recording.webm');
  const stream = fs.createWriteStream(file, { flags: 'a' });
  await context.exposeFunction('__mmSink', (b64: string) => {
    stream.write(Buffer.from(b64, 'base64'));
  });
  await context.addInitScript(RECORDER_JS);
  return () => stream.end();
}

export async function screenshot(page: Page, meetingId: string, step: string) {
  try {
    const file = path.join(cfg.dataDir, 'debug', `${meetingId}-${step}.png`);
    await page.screenshot({ path: file, fullPage: false });
    log('bot', `スクリーンショット保存: ${file}`);
  } catch {
    /* ignore */
  }
}

/** よくある確認ポップアップを閉じる */
export async function dismissPopups(page: Page) {
  const labels = /^(Got it|OK|了解|閉じる|Dismiss|後で|Not now|今は実行しない|キャンセル)$/i;
  for (const btn of await page.getByRole('button', { name: labels }).all()) {
    try {
      if (await btn.isVisible()) await btn.click({ timeout: 1000 });
    } catch {
      /* ignore */
    }
  }
}

export interface CallHooks {
  isInCall: () => Promise<boolean>;
  snapshot: () => Promise<ParticipantSnapshot>;
  leave: () => Promise<void>;
}

/**
 * 通話中ループ: 5秒ごとに参加者を記録 (events.jsonl)。
 * 「自分だけが2分続いた」「最大時間超過」「会議が終了した」で退出する。
 */
export async function runCallLoop(page: Page, dir: string, hooks: CallHooks): Promise<string[]> {
  const eventsFile = path.join(dir, 'events.jsonl');
  const allNames = new Set<string>();
  const startedAt = Date.now();
  let lastMultiAt = Date.now();

  while (true) {
    await sleep(5000);
    let inCall = false;
    try {
      inCall = await hooks.isInCall();
    } catch {
      inCall = false;
    }
    if (!inCall) {
      log('bot', '会議が終了した (または退出させられた) ため録音を終了します');
      break;
    }
    try {
      const snap = await hooks.snapshot();
      snap.names.forEach((n) => allNames.add(n));
      fs.appendFileSync(
        eventsFile,
        JSON.stringify({ t: Date.now(), count: snap.count, names: snap.names, speaking: snap.speaking }) + '\n'
      );
      if (snap.count >= 2) lastMultiAt = Date.now();
      if (snap.count === 1 && Date.now() - lastMultiAt > 2 * 60 * 1000) {
        log('bot', '他の参加者が居なくなって2分経過。退出します');
        await hooks.leave().catch(() => {});
        break;
      }
    } catch {
      /* 参加者検出はベストエフォート */
    }
    if (Date.now() - startedAt > cfg.maxMeetingMin * 60 * 1000) {
      log('bot', `最大録音時間 (${cfg.maxMeetingMin}分) に達したため退出します`);
      await hooks.leave().catch(() => {});
      break;
    }
  }
  return [...allNames];
}

export async function stopRecorder(page: Page) {
  try {
    await page.evaluate('window.__mmStop && window.__mmStop()');
    await sleep(1500); // 最終チャンクのフラッシュ待ち
  } catch {
    /* ignore */
  }
}
