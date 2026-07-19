// Electron メインプロセス: ローカルにダッシュボードを立てて、その画面をアプリ窓に表示する。
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

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
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(`${BASE}/`);
  // 外部リンク（キー取得ページ等）は既定ブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
