/** Web ダッシュボード: 会議一覧 / 議事録ビュー / 事業ビュー / タスク管理 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getBusinesses } from './businesses.js';
import { cfg } from './config.js';
import { db, getMeeting, openTasks } from './db.js';
import type { MeetingRow, TaskRow } from './db.js';
import { mdToHtml } from './deliver.js';
import { escapeHtml, log } from './util.js';

const STATUS_JA: Record<string, string> = {
  scheduled: '⏳ 予定',
  joining: '🚪 入室中',
  recording: '🔴 録音中',
  ended: '⏹ 終了',
  processing: '⚙️ 処理中',
  delivered: '✅ 配信済み',
  failed: '❌ 失敗',
  skipped: '➖ スキップ',
};

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - MinuteMate</title>
<style>
body{font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;max-width:960px;margin:0 auto;padding:20px;line-height:1.7;color:#1a202c}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;font-size:14px}
.card{border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin:12px 0}
.muted{color:#64748b;font-size:13px}
nav{margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #e2e8f0}
nav a{margin-right:16px;font-weight:600}
h1{font-size:24px}h2{font-size:19px;margin-top:28px}
button{cursor:pointer;border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:2px 10px;font-size:12px}
.done{text-decoration:line-through;color:#94a3b8}
audio{width:100%;margin:8px 0}
.md h1{font-size:22px}.md h2{font-size:18px}.md h3{font-size:16px}
</style></head><body>
<nav><a href="/">🏠 ホーム</a>${getBusinesses()
    .map((b) => `<a href="/b/${encodeURIComponent(b.name)}">📁 ${escapeHtml(b.name)}</a>`)
    .join('')}<a href="/b/_inbox">📥 未分類</a></nav>
${body}
</body></html>`;
}

export function startWeb(): void {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  if (cfg.webPassword) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization || '';
      const [, b64] = auth.split(' ');
      const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':')[1] : '';
      if (pass === cfg.webPassword) return next();
      res.set('WWW-Authenticate', 'Basic realm="MinuteMate"').status(401).send('認証が必要です');
    });
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (_req, res) => {
    const upcoming = db
      .prepare(
        "SELECT * FROM meetings WHERE status IN ('scheduled','joining','recording','processing') ORDER BY start_at LIMIT 20"
      )
      .all() as MeetingRow[];
    const recent = db
      .prepare("SELECT * FROM meetings WHERE status IN ('delivered','failed') ORDER BY start_at DESC LIMIT 15")
      .all() as MeetingRow[];
    const bizCards = getBusinesses()
      .map((b) => {
        const open = openTasks(b.name).length;
        const last = db
          .prepare("SELECT * FROM meetings WHERE business = ? AND status='delivered' ORDER BY start_at DESC LIMIT 1")
          .get(b.name) as MeetingRow | undefined;
        return `<div class="card"><b><a href="/b/${encodeURIComponent(b.name)}">📁 ${escapeHtml(b.name)}</a></b>
        <div class="muted">${escapeHtml(b.description)}</div>
        <div>未完了タスク: ${open} 件${last ? ` / 直近会議: ${escapeHtml(last.title)} (${fmtDate(last.start_at)})` : ''}</div></div>`;
      })
      .join('');
    const table = (rows: MeetingRow[]) =>
      rows.length
        ? `<table><tr><th>日時</th><th>会議</th><th>事業</th><th>状態</th></tr>${rows
            .map(
              (m) =>
                `<tr><td>${fmtDate(m.start_at)}</td><td><a href="/m/${m.id}">${escapeHtml(m.title)}</a></td>
                 <td>${escapeHtml(m.business ?? '-')}</td><td>${STATUS_JA[m.status] ?? m.status}</td></tr>`
            )
            .join('')}</table>`
        : '<p class="muted">なし</p>';
    res.send(
      layout(
        'ホーム',
        `<h1>🤖 MinuteMate — 会議秘書</h1>
         <h2>事業</h2>${bizCards || '<p class="muted">businesses.yaml に事業を登録してください</p>'}
         <h2>これからの会議</h2>${table(upcoming)}
         <h2>最近の会議</h2>${table(recent)}`
      )
    );
  });

  app.get('/m/:id', (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) return res.status(404).send('not found');
    const minutesPath = m.dir ? path.join(m.dir, 'minutes.md') : '';
    const minutes = minutesPath && fs.existsSync(minutesPath) ? fs.readFileSync(minutesPath, 'utf8') : '';
    const hasAudio = m.dir && fs.existsSync(path.join(m.dir, 'recording.webm'));
    const tasks = db.prepare('SELECT * FROM tasks WHERE meeting_id = ?').all(m.id) as TaskRow[];
    res.send(
      layout(
        m.title,
        `<h1>${escapeHtml(m.title)}</h1>
        <p class="muted">${fmtDate(m.start_at)} / ${STATUS_JA[m.status] ?? m.status} / 事業: ${escapeHtml(m.business ?? '未分類')}
        ${m.share_url ? ` / <a href="${escapeHtml(m.share_url)}" target="_blank">🔗 共有リンク (Drive)</a>` : ''}</p>
        ${m.join_error ? `<div class="card">⚠️ ${escapeHtml(m.join_error)}</div>` : ''}
        ${hasAudio ? `<audio controls src="/m/${m.id}/audio"></audio>` : ''}
        ${tasks.length ? `<h2>この会議のタスク</h2>${taskList(tasks)}` : ''}
        <div class="md">${minutes ? mdToHtml(minutes) : '<p class="muted">議事録はまだありません</p>'}</div>
        <form method="post" action="/m/${m.id}/reprocess" style="margin-top:24px">
          <button>⚙️ 議事録を再生成する</button></form>`
      )
    );
  });

  app.get('/m/:id/audio', (req, res) => {
    const m = getMeeting(req.params.id);
    const p = m?.dir ? path.join(m.dir, 'recording.webm') : '';
    if (!p || !fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });

  app.post('/m/:id/reprocess', async (req, res) => {
    const m = getMeeting(req.params.id);
    if (m) {
      db.prepare("UPDATE meetings SET status = 'ended' WHERE id = ?").run(m.id);
      const { runPipeline } = await import('./pipeline.js');
      runPipeline(m.id).catch((e) => log('web', 'reprocess failed:', e.message));
    }
    res.redirect(`/m/${req.params.id}`);
  });

  app.get('/b/:name', (req, res) => {
    const name = req.params.name;
    const isInbox = name === '_inbox';
    const meetings = (
      isInbox
        ? db.prepare("SELECT * FROM meetings WHERE business IS NULL AND status = 'delivered' ORDER BY start_at DESC")
        : db.prepare('SELECT * FROM meetings WHERE business = ? ORDER BY start_at DESC')
    ).all(...(isInbox ? [] : [name])) as MeetingRow[];
    const tasks = isInbox
      ? []
      : (db.prepare("SELECT * FROM tasks WHERE business = ? ORDER BY status = 'done', created_at DESC").all(name) as TaskRow[]);
    const reportDir = path.join(cfg.dataDir, 'businesses', name, 'reports');
    const reports = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).sort().reverse().slice(0, 8) : [];
    const latestReport =
      reports.length > 0 ? fs.readFileSync(path.join(reportDir, reports[0]), 'utf8') : '';
    res.send(
      layout(
        name,
        `<h1>📁 ${escapeHtml(isInbox ? '未分類インボックス' : name)}</h1>
        ${
          tasks.length
            ? `<h2>タスク (${tasks.filter((t) => t.status === 'open').length} 件未完了)</h2>${taskList(tasks)}`
            : ''
        }
        <h2>会議 (${meetings.length}件)</h2>
        <table><tr><th>日時</th><th>会議</th><th>状態</th></tr>${meetings
          .map(
            (m) =>
              `<tr><td>${fmtDate(m.start_at)}</td><td><a href="/m/${m.id}">${escapeHtml(m.title)}</a></td><td>${STATUS_JA[m.status] ?? m.status}</td></tr>`
          )
          .join('')}</table>
        ${latestReport ? `<h2>最新の週次進捗レポート</h2><div class="card md">${mdToHtml(latestReport)}</div>` : ''}`
      )
    );
  });

  app.post('/t/:id/toggle', (req, res) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id) as TaskRow | undefined;
    if (t) {
      db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
        t.status === 'open' ? 'done' : 'open',
        t.id
      );
    }
    res.redirect(req.headers.referer || '/');
  });

  app.listen(cfg.webPort, () => log('web', `ダッシュボード起動: ${cfg.publicUrl}`));
}

function taskList(tasks: TaskRow[]): string {
  return `<table>${tasks
    .map(
      (t) => `<tr class="${t.status === 'done' ? 'done' : ''}">
      <td>${escapeHtml(t.title)}</td>
      <td class="muted">${escapeHtml(t.assignee ?? '未定')} / ${escapeHtml(t.due ?? '期限未定')}${t.carried >= 2 ? ` / ⚠️${t.carried}週停滞` : ''}</td>
      <td><form method="post" action="/t/${t.id}/toggle"><button>${t.status === 'open' ? '完了にする' : '戻す'}</button></form></td>
      </tr>`
    )
    .join('')}</table>`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: cfg.tz,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
