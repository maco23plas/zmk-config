// ダッシュボード画面用のプリロード。ページから安全に「会議に入る」を呼べるようにする。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mm', {
  isDesktop: true,
  joinMeeting: (url, title) => ipcRenderer.send('mm-join', { url, title }),
});
