/**
 * 秘書機能:
 *  - 事前ブリーフ: 次回会議の前に「前回の決定・宿題の状況・今回のアジェンダ案」を配信
 *  - 週次進捗レポート: 事業ごとに会議履歴とタスクの動きから進捗をまとめて配信
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findBusiness, getBusinesses } from './businesses.js';
import { cfg } from './config.js';
import { db, openTasks } from './db.js';
import type { MeetingRow, TaskRow } from './db.js';
import { postSlack, sendMail } from './deliver.js';
import { chatText } from './llm.js';
import { log, ymd } from './util.js';

/** 開始 BRIEF_LEAD_MIN 分前が近づいた会議に事前ブリーフを送る (5分おきに呼ばれる) */
export async function sendDueBriefs(): Promise<void> {
  const now = Date.now();
  const lead = cfg.briefLeadMin * 60 * 1000;
  const rows = db
    .prepare(
      "SELECT * FROM meetings WHERE status = 'scheduled' AND business IS NOT NULL AND brief_sent = 0"
    )
    .all() as MeetingRow[];
  for (const m of rows) {
    const start = new Date(m.start_at).getTime();
    if (start - now > lead || start - now < 0) continue;
    try {
      const brief = await buildBrief(m);
      if (brief) {
        await sendMail(cfg.mailTo, `【事前ブリーフ】${m.title}`, brief);
        const biz = findBusiness(m.business);
        await postSlack(`🗓️ *まもなく: ${m.title}*\n${brief.slice(0, 1500)}`, biz?.slack_webhook || undefined).catch(
          () => {}
        );
      }
      db.prepare('UPDATE meetings SET brief_sent = 1 WHERE id = ?').run(m.id);
      log('secretary', `事前ブリーフ送信: ${m.title}`);
    } catch (e) {
      log('secretary', `事前ブリーフ失敗 (${m.title}):`, (e as Error).message);
    }
  }
}

async function buildBrief(m: MeetingRow): Promise<string | null> {
  const prev = db
    .prepare(
      "SELECT * FROM meetings WHERE business = ? AND status = 'delivered' AND start_at < ? ORDER BY start_at DESC LIMIT 1"
    )
    .get(m.business, m.start_at) as MeetingRow | undefined;
  const tasks = openTasks(m.business!);
  if (!prev && tasks.length === 0) return null;

  let prevMinutes = '';
  if (prev?.dir) {
    const p = path.join(prev.dir, 'minutes.md');
    if (fs.existsSync(p)) prevMinutes = fs.readFileSync(p, 'utf8');
  }
  return chatText(
    'あなたは有能な経営秘書です。次の会議に向けた事前ブリーフを簡潔な Markdown で作成してください。A4半分程度、箇条書き中心。創作はしないこと。',
    [
      `## 次回会議`,
      `タイトル: ${m.title} / 日時: ${m.start_at} / 事業: ${m.business}`,
      '',
      prev ? `## 前回の議事録\n${prevMinutes.slice(0, 12_000)}` : '## 前回の議事録\n(なし)',
      '',
      `## 現在の未完了タスク`,
      tasks.length
        ? tasks
            .map(
              (t) =>
                `- ${t.title} (担当: ${t.assignee ?? '未定'} / 期限: ${t.due ?? '未定'}${
                  t.carried > 0 ? ` / ${t.carried}週持ち越し中` : ''
                })`
            )
            .join('\n')
        : '(なし)',
      '',
      '## 出力構成',
      '### 前回の決定事項 / ### 宿題の状況 (期限超過・持ち越しは強調) / ### 今回のアジェンダ案',
    ].join('\n')
  );
}

/** 全事業の週次レポートを回す (cron から呼ばれる) */
export async function weeklyReports(): Promise<void> {
  for (const b of getBusinesses()) {
    if (!b.weekly_report) continue;
    try {
      await weeklyReport(b.name);
    } catch (e) {
      log('secretary', `週次レポート失敗 (${b.name}):`, (e as Error).message);
    }
  }
}

export async function weeklyReport(business: string): Promise<string | null> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const meetings = db
    .prepare(
      "SELECT * FROM meetings WHERE business = ? AND status = 'delivered' AND start_at >= ? ORDER BY start_at"
    )
    .all(business, cutoff) as MeetingRow[];
  const open = openTasks(business);
  const done7 = db
    .prepare("SELECT * FROM tasks WHERE business = ? AND status = 'done' AND updated_at >= ?")
    .all(business, cutoff) as TaskRow[];
  const new7 = db
    .prepare('SELECT COUNT(*) AS c FROM tasks WHERE business = ? AND created_at >= ?')
    .get(business, cutoff) as { c: number };
  if (meetings.length === 0 && open.length === 0 && done7.length === 0) {
    log('secretary', `週次レポート: ${business} は今週動きなしのためスキップ`);
    return null;
  }

  const minutesBlocks = meetings
    .map((m) => {
      const p = m.dir ? path.join(m.dir, 'minutes.md') : '';
      const md = p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      return `### ${new Date(m.start_at).toLocaleDateString('ja-JP', { timeZone: cfg.tz })} ${m.title}\n${md.slice(0, 8000)}`;
    })
    .join('\n\n');

  const stale = open.filter((t) => t.carried >= 2);
  const md = await chatText(
    'あなたは有能な経営秘書です。事業の週次進捗レポートを Markdown で作成してください。見出し構成: # {事業名} 週次進捗 / ## 今週の動き / ## 決定事項 / ## 進捗 / ## リスク・懸念 / ## 来週やること。議事録にある事実だけを使い、創作しないこと。',
    [
      `事業名: ${business}`,
      `期間: ${ymd(new Date(Date.now() - 7 * 86400_000), cfg.tz)} 〜 ${ymd(new Date(), cfg.tz)}`,
      '',
      `## 今週の会議 (${meetings.length}件) の議事録`,
      minutesBlocks || '(会議なし)',
      '',
      `## タスク統計`,
      `- 新規: ${new7.c} 件 / 完了: ${done7.length} 件 / 未完了: ${open.length} 件`,
      done7.length ? `完了したタスク:\n${done7.map((t) => `- ${t.title}`).join('\n')}` : '',
      stale.length
        ? `⚠ 2週以上持ち越されている停滞タスク (リスクとして必ず言及):\n${stale
            .map((t) => `- ${t.title} (担当: ${t.assignee ?? '未定'}, ${t.carried}週持ち越し)`)
            .join('\n')}`
        : '',
    ].join('\n')
  );

  const dir = path.join(cfg.dataDir, 'businesses', business, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${ymd(new Date(), cfg.tz)}.md`);
  fs.writeFileSync(file, md);
  db.prepare(
    'INSERT INTO reports (id, business, period_start, period_end, path) VALUES (?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), business, cutoff, new Date().toISOString(), file);

  // 持ち越しカウントを進める (来週のレポートで「停滞」を検出するため)
  db.prepare(
    "UPDATE tasks SET carried = carried + 1 WHERE business = ? AND status = 'open' AND created_at < ?"
  ).run(business, cutoff);

  const biz = findBusiness(business);
  await sendMail(cfg.mailTo, `【週次進捗】${business}`, md).catch(() => {});
  await postSlack(md.slice(0, 3500), biz?.slack_webhook || undefined).catch(() => {});
  log('secretary', `週次レポート配信: ${business} → ${file}`);
  return file;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain && process.argv[2] === 'report') {
  weeklyReports()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
