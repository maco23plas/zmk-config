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

/** 会議 URL を内蔵ブラウザで開き、通話音声を録音する。閉じると議事録化が走る。 */
function openMeetingWindow(url, title) {
  const live = joinApi.createLiveMeeting(url, title);
  const stream = fs.createWriteStream(live.recordingPath, { flags: 'a' });

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: '会議（録音中）— ' + (title || ''),
    backgroundColor: '#111',
    webPreferences: {
      preload: path.join(__dirname, 'rec-preload.cjs'),
      contextIsolation: false, // 録音フックをページと同じ世界で動かすため
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // このウィンドウからの音声チャンクだけを受け取る
  const onAudio = (e, b64) => {
    if (e.sender === win.webContents) {
      try { stream.write(Buffer.from(b64, 'base64')); } catch (err) {}
    }
  };
  ipcMain.on('mm-audio', onAudio);

  // マイク/スピーカーの権限は自動許可（本人が開いた会議なので）
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  win.loadURL(url);

  let finishing = false;
  const finish = async () => {
    if (finishing) return;
    finishing = true;
    ipcMain.removeListener('mm-audio', onAudio);
    try { stream.end(); } catch (e) {}
    try {
      await joinApi.finishLiveMeeting(live.id);
    } catch (e) {}
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(`${BASE}/m/${live.id}`);
  };

  // 閉じる直前に録音を止めて最後のチャンクを書き出す
  win.on('close', (ev) => {
    if (finishing) return;
    ev.preventDefault();
    win.webContents.executeJavaScript('window.__mmStop && window.__mmStop()').catch(() => {});
    setTimeout(() => {
      finish().then(() => { if (!win.isDestroyed()) win.destroy(); });
    }, 1800);
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
