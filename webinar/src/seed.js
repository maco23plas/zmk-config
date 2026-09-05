// 動作確認用のサンプルデータを投入する: npm run seed
import { initNodeRuntime } from './server.js';
import { get } from './db.js';
import { clock } from './clock.js';
import { createWebinar, replaceChatScript, parseChatScriptText } from './domain/webinars.js';
import { replacePolls, parsePollsText } from './domain/room.js';
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
  title: 'ジュエリーのお仕事 オンライン説明会',
  description: 'ジュエリー販売の仕組みと、はじめ方をご説明します。\n'
    + '未経験の方に向けた内容です。ご質問は公式LINEで承ります。',
  // 動画は未設定。管理画面から youtube:動画ID などに差し替えてください。
  video_url: 'youtube:REPLACE_ME',
  duration_sec: 45 * 60,
  presenter: '運営事務局',
  cta_label: 'お申し込みはこちら',
  // ★お申し込みページのURLに差し替えてください
  cta_url: 'https://example.com/apply',
  cta_at_sec: 35 * 60,
  late_join_sec: 0,
  archive_hours: 0,
  lobby_open_min: 15,
  min_viewers_shown: 3,
  show_viewer_count: 1,
  show_chat: 1,
  viewer_base: 0,
  closing_message: '本日はご参加ありがとうございました。ご質問は公式LINEで承ります。',
}, now);

await replaceChatScript(webinar.id, parseChatScriptText(
  '-10:00 事務局 まもなく開場します。音声が出るかご確認ください\n'
  + '-05:00 事務局 本日はお集まりいただきありがとうございます\n'
  + '-01:00 事務局 まもなく開始します\n'
  + '00:30 事務局 本日は、ジュエリー販売の仕組みとはじめ方をご説明します\n'
  + '35:00 事務局 ご質問は公式LINEにお送りください。担当者がご回答します\n'
  + '44:00 事務局 本日はご参加ありがとうございました',
));

await replacePolls(webinar.id, parsePollsText(
  '10:00 | いま、いちばん気になっているのはどれですか？ | かかる費用 | 必要な時間 | 販売のしかた | まずは全体像',
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
log.info('  ※ 差し替えが必要です（管理画面 → コンテンツ）:');
log.info('       動画       youtube:REPLACE_ME');
log.info('       申し込み先 https://example.com/apply');
