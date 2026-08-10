// Electron メインプロセス: ローカルにダッシュボードを立てて、その画面をアプリ窓に表示する。
const { app, BrowserWindow, shell, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { pathToFileURL } = require('url');

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

let joinApi = null; // dist/desktop-join.js (createLiveMeeting / finishLiveMeeting)
let mainWindow = null;

// サーバーが起動する前に、データ保存先とポートを環境変数で渡す
function configureEnv() {
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.WEB_PORT = String(PORT);
  process.env.PUBLIC_URL = BASE;
  // Web ダッシュボードはローカル専用。パスワードは不要にする。
  delete process.env.WEB_PASSWORD;
}

async function startServer() {
  // dist/desktop.js は ESM。CommonJS のメインからは動的 import で読み込む。
  const entry = pathToFileURL(path.join(__dirname, '..', 'dist', 'desktop.js')).href;
  await import(entry);
}

function waitForServer(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const req = http.get(`${BASE}/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('サーバーが起動しませんでした'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'MinuteMate',
    backgroundColor: '#f5f5f7',
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadURL(`${BASE}/`);
  // 外部リンク（キー取得ページ等）は既定ブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow = win;
  return win;
}

// 「AI秘書」として名前を入れて参加ボタンを押す注入スクリプト (見えているので手動でも押せる)
const AUTO_JOIN_JS = `(function(){
  var BOT='AI秘書';
  function vis(el){ return el && el.offsetParent !== null; }
  function fillName(){
    var sel=['#input-for-name','input[placeholder*="Name" i]','input[placeholder*="名前"]','input[aria-label*="name" i]','input[aria-label*="名前"]','input[type="text"]'];
    for(var i=0;i<sel.length;i++){ var el=document.querySelector(sel[i]); if(vis(el)){ if(el.value!==BOT){ el.focus(); el.value=BOT; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } return true; } }
    return false;
  }
  function clickJoin(){
    var btns=[].slice.call(document.querySelectorAll('button, [role=button], span, div'));
    var re=/^(参加|参加する|今すぐ参加|参加をリクエスト|Join|Join now|Ask to join|Join Audio by Computer|コンピューター\\s*オーディオ)/i;
    for(var i=0;i<btns.length;i++){ var b=btns[i]; var t=(b.innerText||b.textContent||'').trim(); if(t && re.test(t) && vis(b)){ b.click(); console.log('[AIhisho] clicked:', t); return true; } }
    return false;
  }
  var n=0, iv=setInterval(function(){ n++; try{ fillName(); clickJoin(); }catch(e){} if(n>40) clearInterval(iv); }, 1500);
  console.log('[AIhisho] auto-join armed');
})();`;

/** 会議 URL を内蔵ブラウザで「AI秘書」ボットとして開き、通話音声を録音する。閉じると議事録化。 */
function openMeetingWindow(url, title) {
  const live = joinApi.createLiveMeeting(url, title);
  const stream = fs.createWriteStream(live.recordingPath, { flags: 'a' });
  const logPath = path.join(live.dir, 'join-log.txt');
  const logLine = (s) => { try { fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${s}\n`); } catch (e) {} };
  logLine(`会議を開きます: ${url}`);
  let bytes = 0;

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: 'AI秘書（録音中）— ' + (title || ''),
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'rec-preload.cjs'),
      contextIsolation: false, // 録音フックをページと同じ世界で動かすため
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // このウィンドウからの音声チャンク/状態だけを受け取る
  const onAudio = (e, b64) => {
    if (e.sender !== win.webContents) return;
    try { const buf = Buffer.from(b64, 'base64'); stream.write(buf); bytes += buf.length; } catch (err) {}
  };
  const onStatus = (e, msg) => { if (e.sender === win.webContents) logLine('recorder: ' + msg); };
  ipcMain.on('mm-audio', onAudio);
  ipcMain.on('mm-status', onStatus);

  // メディア権限は自動許可（本人が開いた会議のため）
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  try { win.webContents.session.setPermissionCheckHandler(() => true); } catch (e) {}
  // 会議ページの console を診断ログに残す（テストで原因を追えるように）
  win.webContents.on('console-message', (_e, _lvl, message) => {
    if (/AIhisho|__mm|recorder|error|Error/i.test(message)) logLine('page: ' + message);
  });
  win.webContents.on('did-finish-load', () => {
    logLine('ページ読み込み完了、AI秘書として参加を試みます');
    win.webContents.executeJavaScript(AUTO_JOIN_JS).catch((e) => logLine('auto-join注入失敗: ' + e.message));
  });

  win.loadURL(live.loadUrl || url);

  let finishing = false;
  const finish = async () => {
    if (finishing) return;
    finishing = true;
    ipcMain.removeListener('mm-audio', onAudio);
    ipcMain.removeListener('mm-status', onStatus);
    try { stream.end(); } catch (e) {}
    logLine(`録音を終了しました（${(bytes / 1024).toFixed(0)} KB）`);
    try {
      await joinApi.finishLiveMeeting(live.id);
    } catch (e) { logLine('議事録生成エラー: ' + e.message); }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`${BASE}/m/${live.id}`);
  };

  // 閉じる直前に録音を止めて最後のチャンクを書き出す
  win.on('close', (ev) => {
    if (finishing) return;
    ev.preventDefault();
    win.webContents.executeJavaScript('window.__mmStop && window.__mmStop()').catch(() => {});
    setTimeout(() => {
      finish().then(() => { if (!win.isDestroyed()) win.destroy(); });
    }, 2000);
  });
}

app.whenReady().then(async () => {
  configureEnv();
  try {
    await startServer();
    await waitForServer();
  } catch (e) {
    const { dialog } = require('electron');
    dialog.showErrorBox('起動に失敗しました', String(e && e.message ? e.message : e));
    app.quit();
    return;
  }
  // 会議参加用のヘルパを読み込む (ESM を動的 import)
  try {
    joinApi = await import(pathToFileURL(path.join(__dirname, '..', 'dist', 'desktop-join.js')).href);
  } catch (e) {
    joinApi = null;
  }
  // ダッシュボードから「会議に入る」が押されたら会議ウィンドウを開く
  ipcMain.on('mm-join', (_e, arg) => {
    const url = arg && arg.url;
    if (!url || !joinApi) return;
    try {
      openMeetingWindow(url, arg.title);
    } catch (err) {
      const { dialog } = require('electron');
      dialog.showErrorBox('会議を開けませんでした', String(err && err.message ? err.message : err));
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
