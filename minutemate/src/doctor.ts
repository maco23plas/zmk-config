/**
 * プリフライト診断: VPS/Docker に載せた後、実際の会議で試す前に
 * 「ちゃんと動く状態か」を一括チェックする。
 *
 *   npm run doctor
 *
 * ※ 常駐プロセス (npm start / docker) を止めてから実行すること
 *   (ブラウザプロファイルを同時に開けないため)。
 */
import { execSync } from 'node:child_process';
import type { BrowserContext } from 'playwright';
import { cfg } from './config.js';
import { launchBot } from './bot/common.js';
import { calendarApi, hasGoogleAuth } from './google.js';
import { chatText } from './llm.js';
import { hasFfmpeg } from './media.js';

type Status = 'ok' | 'warn' | 'fail';
interface Result {
  status: Status;
  detail: string;
  critical?: boolean;
}

const ICON: Record<Status, string> = { ok: '✅', warn: '⚠️ ', fail: '❌' };

async function checkLlmKey(): Promise<Result> {
  const map: Record<string, string> = {
    gemini: cfg.geminiApiKey,
    groq: cfg.groqApiKey,
    anthropic: cfg.anthropicApiKey,
    ollama: 'n/a',
  };
  const v = map[cfg.llmProvider];
  if (cfg.llmProvider === 'ollama') return { status: 'ok', detail: `LLM=ollama (${cfg.ollamaUrl})` };
  return v
    ? { status: 'ok', detail: `LLM=${cfg.llmProvider} キーあり` }
    : { status: 'fail', detail: `LLM=${cfg.llmProvider} だが API キー未設定`, critical: true };
}

async function checkLlmPing(): Promise<Result> {
  try {
    const out = await chatText('あなたは接続テストです。', 'OK とだけ返してください。', 16);
    return { status: 'ok', detail: `応答: "${out.slice(0, 20).replace(/\n/g, ' ')}"` };
  } catch (e) {
    return { status: 'fail', detail: `LLM 呼び出し失敗: ${(e as Error).message.slice(0, 80)}`, critical: true };
  }
}

async function checkStt(): Promise<Result> {
  if (cfg.sttProvider === 'groq') {
    return cfg.groqApiKey
      ? { status: 'ok', detail: 'STT=groq キーあり' }
      : { status: 'fail', detail: 'STT=groq だが GROQ_API_KEY 未設定', critical: true };
  }
  try {
    execSync('python3 -c "import faster_whisper"', { stdio: 'ignore' });
    return { status: 'ok', detail: 'STT=local (faster-whisper 利用可)' };
  } catch {
    return { status: 'fail', detail: 'STT=local だが faster-whisper 未インストール (pip install faster-whisper)', critical: true };
  }
}

async function checkFfmpeg(): Promise<Result> {
  return hasFfmpeg()
    ? { status: 'ok', detail: 'ffmpeg あり (大きい録音を圧縮可能)' }
    : { status: 'warn', detail: 'ffmpeg なし (25MB 超の録音は圧縮できない。VPS では apt install ffmpeg 推奨)' };
}

async function checkGoogle(): Promise<Result> {
  if (!hasGoogleAuth()) {
    return { status: 'warn', detail: 'Google 未接続 (録音アップロード運用なら不要。カレンダー自動入室には必要)' };
  }
  try {
    const res = await calendarApi().calendarList.list({ maxResults: 1 });
    const n = res.data.items?.length ?? 0;
    return { status: 'ok', detail: `Google 接続OK (カレンダー ${n >= 1 ? '取得成功' : '0件'})` };
  } catch (e) {
    return { status: 'fail', detail: `Google トークンが無効: ${(e as Error).message.slice(0, 80)}` };
  }
}

async function checkMail(): Promise<Result> {
  return cfg.mailTo.length
    ? { status: 'ok', detail: `配信先メール: ${cfg.mailTo.join(', ')}` }
    : { status: 'warn', detail: 'MAIL_TO 未設定 (議事録メールは送られない)' };
}

async function checkBrowserAndNetwork(): Promise<Result[]> {
  const results: Result[] = [];
  let ctx: BrowserContext | null = null;
  try {
    ctx = await launchBot(true); // 常に headless で検査
    results.push({ status: 'ok', detail: 'Chromium 起動OK' });
  } catch (e) {
    results.push({ status: 'fail', detail: `Chromium 起動失敗: ${(e as Error).message.slice(0, 100)}`, critical: true });
    return results;
  }
  try {
    const page = await ctx.newPage();
    for (const [label, url] of [
      ['Zoom 到達性', 'https://zoom.us/'],
      ['Meet 到達性', 'https://meet.google.com/'],
    ] as const) {
      try {
        const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        results.push({ status: 'ok', detail: `${label}: HTTP ${r?.status() ?? '?'}` });
      } catch (e) {
        results.push({ status: 'fail', detail: `${label}: 到達不可 (${(e as Error).message.split('\n')[0].slice(0, 50)})` });
      }
    }
    // Zoom ログイン状態 (プロファイルに Zoom cookie があるか)
    try {
      await page.goto('https://zoom.us/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
      const signInVisible = await page
        .getByRole('link', { name: /Sign In|サインイン/i })
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      results.push(
        signInVisible
          ? { status: 'warn', detail: 'Zoom 未ログイン (サインイン必須の会議に入れない。npm run bot:login zoom で解消)' }
          : { status: 'ok', detail: 'Zoom ログイン済みの可能性 (サインインリンクなし)' }
      );
    } catch {
      results.push({ status: 'warn', detail: 'Zoom ログイン状態を判定できず (到達不可のため)' });
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return results;
}

async function main() {
  console.log('\n=== MinuteMate プリフライト診断 ===\n');
  const rows: Array<[string, Result]> = [];
  rows.push(['LLM キー', await checkLlmKey()]);
  rows.push(['LLM 応答', await checkLlmPing()]);
  rows.push(['文字起こし(STT)', await checkStt()]);
  rows.push(['ffmpeg', await checkFfmpeg()]);
  rows.push(['Google 接続', await checkGoogle()]);
  rows.push(['配信メール', await checkMail()]);
  for (const r of await checkBrowserAndNetwork()) rows.push(['ブラウザ/ネットワーク', r]);

  let fails = 0;
  for (const [name, r] of rows) {
    if (r.status === 'fail') fails++;
    console.log(`${ICON[r.status]} ${name.padEnd(20, '　')} ${r.detail}`);
  }
  const critical = rows.filter(([, r]) => r.status === 'fail' && r.critical).length;
  console.log('');
  if (critical > 0) {
    console.log(`❌ 致命的な問題が ${critical} 件あります。上記を解消してください。\n`);
    process.exit(1);
  } else if (fails > 0) {
    console.log(`⚠️  ${fails} 件の問題がありますが、録音アップロード運用は可能かもしれません。\n`);
    process.exit(0);
  } else {
    console.log('🎉 すべて良好。会議への自動入室を試せます。\n');
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
