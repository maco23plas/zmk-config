// 動作確認用のサンプルデータを投入する: npm run seed
import { initNodeRuntime } from './server.js';
import { get } from './db.js';
import { clock } from './clock.js';
import { createWebinar, replaceChatScript, parseChatScriptText } from './domain/webinars.js';
import { createSession, createRule, generateSessionsFromRules } from './domain/sessions.js';
import { HOUR, MINUTE, formatJst } from './lib/time.js';
import { log } from './lib/log.js';

initNodeRuntime();
const now = clock.now();

if ((await get('SELECT COUNT(*) c FROM webinars')).c > 0) {
  log.warn('すでにデータがあります。投入を中止しました。');
  process.exit(0);
}

const webinar = await createWebinar({
  title: '社会保険給付金サポート オンライン説明会',
  description: '退職後に受け取れる可能性のある給付金の制度と、申請の流れ、当社サポートの内容をご説明します。\n'
    + 'ご視聴中に質問を送っていただければ、担当者より公式LINEでご回答します。',
  // 動画は未設定。管理画面から youtube:動画ID などに差し替えてください。
  video_url: 'youtube:REPLACE_ME',
  duration_sec: 45 * 60,
  presenter: 'アンタイ 運営事務局',
  cta_label: '無料相談を申し込む',
  cta_url: 'https://lin.ee/tyGZJqhE',
  cta_at_sec: 30 * 60,
  late_join_sec: 0,
  archive_hours: 0,
  show_viewer_count: 0,
  viewer_base: 0,
  show_chat: 0,
}, now);

await replaceChatScript(webinar.id, parseChatScriptText(
  '*00:20 事務局 本日はご参加ありがとうございます。音声は聞こえていますか？\n'
  + '00:45 参加者A 聞こえています\n'
  + '*15:00 事務局 ご質問は右下のフォームからお送りください',
));

// 直近の確認用に「10分後開始」と「3時間5分後開始」の枠を用意する
const soon = await createSession({ webinarId: webinar.id, startAt: now + 10 * MINUTE, capacity: 0 }, now);
const later = await createSession({ webinarId: webinar.id, startAt: now + 3 * HOUR + 5 * MINUTE, capacity: 30 }, now);

await createRule({ webinarId: webinar.id, weekdays: '1,2,3,4,5', timeJst: '20:00', capacity: 30, horizonDays: 14 }, now);
const generated = await generateSessionsFromRules(now);

log.info('サンプルデータを投入しました:');
log.info(`  コンテンツ: ${webinar.title}`);
log.info(`  開催枠: ${formatJst(soon.start_at)} / ${formatJst(later.start_at)}`);
log.info(`  定期開催ルール(平日20:00)から ${generated} 件の枠を自動生成`);
log.info('  ※ 動画は "youtube:REPLACE_ME" のままです。管理画面から差し替えてください。');
