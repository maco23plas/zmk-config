/** Web ダッシュボード: 会議一覧 / 議事録ビュー / 事業ビュー / タスク管理 / 録音アップロード */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { getBusinesses } from './businesses.js';
import { cfg } from './config.js';
import { db, getMeeting, openTasks } from './db.js';
import type { MeetingRow, TaskRow } from './db.js';
import { mdToHtml } from './deliver.js';
import { registerUpload } from './ingest.js';
import { findRecording } from './media.js';
import { runPipeline } from './pipeline.js';
import { getSettings, groqKey, geminiKey, hasRequiredKeys, mailTo, setSettings } from './settings.js';
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

const STATUS_PILL: Record<string, [string, string]> = {
  delivered: ['green', '完了'],
  processing: ['amber', '処理中'],
  ended: ['amber', '処理中'],
  recording: ['amber', '録音中'],
  joining: ['amber', '入室中'],
  scheduled: ['gray', '予定'],
  failed: ['gray', '失敗'],
  skipped: ['gray', 'スキップ'],
};

function statusPill(status: string): string {
  const [cls, label] = STATUS_PILL[status] ?? ['gray', status];
  return `<span class="pill ${cls}">${label}</span>`;
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} - MinuteMate</title>
<style>
:root{--bg:#f5f5f7;--card:#fff;--card-2:#fbfbfd;--ink:#1d1d1f;--muted:#6e6e73;--faint:#8a8a8e;--hair:rgba(0,0,0,.08);--hair2:rgba(0,0,0,.12);--blue:#0066cc;--blue-bg:rgba(0,102,204,.08);--green:#1d7a4d;--green-bg:rgba(29,122,77,.1);--amber:#95600a;--amber-bg:rgba(149,96,10,.12);--red:#c1362f;--radius:14px}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--card:#1c1c1e;--card-2:#242426;--ink:#f5f5f7;--muted:#98989d;--faint:#8a8a8e;--hair:rgba(255,255,255,.1);--hair2:rgba(255,255,255,.16);--blue:#0a84ff;--blue-bg:rgba(10,132,255,.14);--green:#30d158;--green-bg:rgba(48,209,88,.14);--amber:#ffb340;--amber-bg:rgba(255,179,64,.14);--red:#ff6961}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Hiragino Kaku Gothic ProN','Hiragino Sans','Noto Sans JP',sans-serif;max-width:760px;margin:0 auto;padding:0 20px 72px;line-height:1.6;color:var(--ink);background:var(--bg);letter-spacing:.003em;-webkit-font-smoothing:antialiased}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
header.top{display:flex;align-items:center;gap:10px;padding:22px 0 16px;position:sticky;top:0;background:linear-gradient(var(--bg),var(--bg) 70%,transparent);z-index:5}
.wordmark{font-weight:700;font-size:17px;letter-spacing:-.02em;color:var(--ink);display:flex;align-items:center;gap:8px}
.wordmark .dot{width:22px;height:22px;border-radius:6px;background:linear-gradient(145deg,#0a84ff,#0066cc);display:inline-block}
nav{display:flex;gap:4px;margin-left:auto;font-size:13.5px;flex-wrap:wrap}
nav a{font-weight:560;color:var(--muted);padding:5px 10px;border-radius:8px}
nav a:hover{text-decoration:none;background:var(--card);color:var(--ink)}
nav a.active{background:var(--card);color:var(--ink)}
h1{font-size:27px;font-weight:700;letter-spacing:-.022em;margin:8px 0 4px;text-wrap:balance}
h2{font-size:15px;font-weight:640;letter-spacing:-.01em;color:var(--faint);margin:34px 0 10px;text-transform:none}
.card{background:var(--card);border:.5px solid var(--hair);border-radius:var(--radius);padding:18px 20px;margin:12px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.muted{color:var(--muted);font-size:13px}
.list{background:var(--card);border:.5px solid var(--hair);border-radius:var(--radius);overflow:hidden}
.row{display:flex;align-items:center;gap:12px;padding:13px 16px;font-size:14.5px}
.row+.row{border-top:.5px solid var(--hair)}
.row a.title{font-weight:560;color:var(--ink)}
.row .when{color:var(--faint);font-size:12.5px;font-variant-numeric:tabular-nums;min-width:74px}
.row .spacer{margin-left:auto}
.pill{font-size:11.5px;font-weight:640;padding:2px 9px;border-radius:999px;white-space:nowrap}
.pill.blue{background:var(--blue-bg);color:var(--blue)}
.pill.green{background:var(--green-bg);color:var(--green)}
.pill.amber{background:var(--amber-bg);color:var(--amber)}
.pill.gray{background:var(--card-2);color:var(--muted);border:.5px solid var(--hair)}
.empty{color:var(--faint);font-size:14px;padding:26px 4px;text-align:center}
button{cursor:pointer;border:.5px solid var(--hair2);background:var(--card);color:var(--ink);border-radius:9px;padding:6px 13px;font-size:13px;font-weight:560}
button:hover{background:var(--card-2)}
button.primary,button[type=submit]{background:var(--blue);color:#fff;border:0;padding:10px 20px;font-size:14.5px;font-weight:600}
button.primary:hover,button[type=submit]:hover{filter:brightness(1.06)}
.done{text-decoration:line-through;color:var(--faint)}
audio{width:100%;margin:12px 0}
.md h1{font-size:22px}.md h2{font-size:17px;color:var(--ink);text-transform:none;margin-top:22px}.md h3{font-size:15px}
.md ul{padding-left:20px}.md li{margin:4px 0}
/* dropzone */
.drop{border:1.5px dashed var(--hair2);border-radius:var(--radius);background:var(--card);padding:30px 20px;text-align:center;transition:border-color .15s,background .15s;cursor:pointer}
.drop.over{border-color:var(--blue);background:var(--blue-bg)}
.drop .ic{width:46px;height:46px;margin:0 auto 10px;border-radius:12px;background:var(--blue-bg);display:grid;place-items:center;color:var(--blue);font-size:22px}
.drop .big{font-weight:620;font-size:16px}
.drop .sub{color:var(--faint);font-size:12.5px;margin-top:4px}
.drop .fname{color:var(--blue);font-weight:600;margin-top:8px;font-size:13.5px}
.uprow{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:14px}
.uprow input,.uprow select{font-size:14px;padding:9px 11px;border:.5px solid var(--hair2);border-radius:9px;background:var(--card);color:var(--ink)}
.uprow input{flex:1;min-width:160px}
form.settings{display:flex;flex-direction:column;gap:18px;max-width:520px;margin-top:8px}
form.settings label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:14px}
form.settings a{font-size:12px;font-weight:500}
form.settings input{font-size:15px;padding:11px 13px;border:.5px solid var(--hair2);border-radius:10px;background:var(--card);color:var(--ink)}
form.settings input:focus,.uprow input:focus{outline:2px solid var(--blue);outline-offset:0;border-color:transparent}
</style></head><body>
<header class="top"><span class="wordmark"><span class="dot"></span>MinuteMate</span>
<nav><a href="/">ホーム</a>${getBusinesses()
    .map((b) => `<a href="/b/${encodeURIComponent(b.name)}">${escapeHtml(b.name)}</a>`)
    .join('')}<a href="/b/_inbox">未分類</a><a href="/settings">設定</a></nav></header>
${body}
</body></html>`;
}

export function startWeb(): void {
  const app = express();
  app.use(express.urlencoded({ extended: false }));

  // 録音アップロード用 (一時保存 → registerUpload が会議フォルダへ移動)
  const uploadTmp = path.join(cfg.dataDir, 'tmp', 'uploads');
  fs.mkdirSync(uploadTmp, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadTmp,
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.webm').toLowerCase();
        cb(null, `up-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
      },
    }),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB まで
  });

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

  // 初回ゲート: API キーが未設定なら設定画面へ誘導する
  app.use((req, res, next) => {
    const exempt = req.path === '/settings' || req.path === '/health' || req.path.endsWith('/audio');
    if (!exempt && !hasRequiredKeys()) return res.redirect('/settings?first=1');
    next();
  });

  app.get('/settings', (req, res) => {
    const s = getSettings();
    const first = req.query.first === '1';
    const mask = (set: boolean) => (set ? 'value="" placeholder="設定済み（変更する時だけ入力）"' : 'value="" placeholder="ここに貼り付け"');
    res.send(
      layout(
        '設定',
        `<h1>設定</h1>
        ${first ? `<div class="card" style="background:var(--warn,#fffbeb)">はじめに、議事録づくりに使う無料APIキーを2つ入れてください。どちらも登録するだけで無料です。</div>` : ''}
        <form method="post" action="/settings" class="settings">
          <label>Gemini APIキー <span class="muted">— 議事録づくり用</span>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">取得ページを開く ↗</a>
            <input type="password" name="geminiApiKey" ${mask(!!geminiKey())} autocomplete="off"></label>
          <label>Groq APIキー <span class="muted">— 文字起こし用</span>
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener">取得ページを開く ↗</a>
            <input type="password" name="groqApiKey" ${mask(!!groqKey())} autocomplete="off"></label>
          <label>議事録メールの送り先 <span class="muted">（任意・カンマ区切り）</span>
            <input type="text" name="mailTo" value="${escapeHtml((mailTo()).join(', '))}" placeholder="you@example.com"></label>
          <button type="submit">保存する</button>
        </form>`
      )
    );
  });

  app.post('/settings', (req, res) => {
    const b = req.body as Record<string, string>;
    setSettings({
      geminiApiKey: b.geminiApiKey,
      groqApiKey: b.groqApiKey,
      mailTo: b.mailTo,
    });
    log('web', '設定を保存しました');
    res.redirect(hasRequiredKeys() ? '/' : '/settings?first=1');
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
    const meetingRows = (rows: MeetingRow[], emptyMsg: string) =>
      rows.length
        ? `<div class="list">${rows
            .map(
              (m) => `<div class="row">
              <span class="when">${fmtDate(m.start_at)}</span>
              <a class="title" href="/m/${m.id}">${escapeHtml(m.title)}</a>
              <span class="spacer"></span>
              ${m.business ? `<span class="pill blue">${escapeHtml(m.business)}</span>` : ''}
              ${statusPill(m.status)}
            </div>`
            )
            .join('')}</div>`
        : `<div class="empty">${escapeHtml(emptyMsg)}</div>`;
    const bizOptions = getBusinesses()
      .map((b) => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`)
      .join('');
    const bizCards = getBusinesses()
      .map((b) => {
        const open = openTasks(b.name).length;
        const last = db
          .prepare("SELECT * FROM meetings WHERE business = ? AND status='delivered' ORDER BY start_at DESC LIMIT 1")
          .get(b.name) as MeetingRow | undefined;
        return `<a class="card" style="display:block;margin:0" href="/b/${encodeURIComponent(b.name)}">
          <div style="font-weight:640;font-size:15px">${escapeHtml(b.name)}</div>
          <div class="muted" style="margin:2px 0 8px">${escapeHtml(b.description)}</div>
          <div style="font-size:12.5px;color:var(--faint)">未完了タスク ${open} 件${last ? ` · 直近 ${fmtDate(last.start_at)}` : ''}</div>
        </a>`;
      })
      .join('');
    const dropzone = `<form method="post" action="/upload" enctype="multipart/form-data">
      <label class="drop" id="dz">
        <input type="file" name="file" accept="audio/*,video/*" required hidden id="fileInput">
        <div class="ic">🎙️</div>
        <div class="big">録音をここにドラッグ＆ドロップ</div>
        <div class="sub">またはクリックして選択 · mp3 / m4a / wav / mp4 / mov / webm など</div>
        <div class="fname" id="fname"></div>
      </label>
      <div class="uprow">
        <input type="text" name="title" placeholder="タイトル（任意）">
        <select name="business"><option value="">事業：自動で判定</option>${bizOptions}</select>
        <button type="submit" class="primary">議事録を作る</button>
      </div>
    </form>
    <script>(function(){var dz=document.getElementById('dz'),fi=document.getElementById('fileInput'),fn=document.getElementById('fname');
    function show(){if(fi.files&&fi.files[0])fn.textContent='選択中: '+fi.files[0].name;}
    fi.addEventListener('change',show);
    ['dragenter','dragover'].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.add('over');});});
    dz.addEventListener('dragleave',function(){dz.classList.remove('over');});
    dz.addEventListener('drop',function(ev){ev.preventDefault();dz.classList.remove('over');if(ev.dataTransfer.files.length){fi.files=ev.dataTransfer.files;show();}});})();</script>`;
    res.send(
      layout(
        'ホーム',
        `<h1>新しい議事録をつくる</h1>
         <p class="muted" style="margin:0 0 14px">録音を入れるだけ。文字起こし → 議事録 → タスク → 事業分けまで自動。</p>
         ${dropzone}
         ${bizCards ? `<h2>事業</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${bizCards}</div>` : ''}
         <h2>これからの会議</h2>${meetingRows(upcoming, '予定された会議はありません。')}
         <h2>最近の会議</h2>${meetingRows(recent, 'まだありません。録音をドロップして最初の議事録をつくりましょう。')}`
      )
    );
  });

  app.post('/upload', upload.single('file'), (req, res) => {
    const file = (req as express.Request & { file?: { path: string } }).file;
    if (!file) return res.status(400).send('ファイルがありません');
    try {
      const body = req.body as { title?: string; business?: string };
      const id = registerUpload(file.path, { title: body.title, business: body.business || null }, true);
      // パイプラインは裏で実行し、会議ページ (処理中表示) へ即リダイレクト
      runPipeline(id).catch((e) => log('web', 'upload pipeline error:', (e as Error).message));
      res.redirect(`/m/${id}`);
    } catch (e) {
      fs.rm(file.path, () => {});
      res.status(400).send(`取り込みに失敗しました: ${escapeHtml((e as Error).message)}`);
    }
  });

  app.get('/m/:id', (req, res) => {
    const m = getMeeting(req.params.id);
    if (!m) return res.status(404).send('not found');
    const minutesPath = m.dir ? path.join(m.dir, 'minutes.md') : '';
    const minutes = minutesPath && fs.existsSync(minutesPath) ? fs.readFileSync(minutesPath, 'utf8') : '';
    const hasAudio = m.dir ? !!findRecording(m.dir) : false;
    const tasks = db.prepare('SELECT * FROM tasks WHERE meeting_id = ?').all(m.id) as TaskRow[];
    // 処理中 (アップロード直後など) は自動更新して、完成した議事録が出たら止める
    const busy = ['ended', 'processing', 'joining', 'recording'].includes(m.status);
    const processingBanner = busy
      ? `<div class="card" style="background:#fffbeb">⚙️ 文字起こし・議事録を生成中です… (このページは自動更新されます)</div>
         <script>setTimeout(function(){location.reload()}, 8000)</script>`
      : '';
    res.send(
      layout(
        m.title,
        `<h1>${escapeHtml(m.title)}</h1>
        <p class="muted">${fmtDate(m.start_at)} / ${STATUS_JA[m.status] ?? m.status} / 事業: ${escapeHtml(m.business ?? '未分類')}
        ${m.share_url ? ` / <a href="${escapeHtml(m.share_url)}" target="_blank">🔗 共有リンク (Drive)</a>` : ''}</p>
        ${processingBanner}
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
    const p = m?.dir ? findRecording(m.dir) : null;
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
