// 会議ウィンドウに注入されるプリロード (contextIsolation:false = ページと同じ世界で動く)。
// RTCPeerConnection をフックして相手の音声をミックス録音し、チャンクをメインプロセスへ送る。
const { ipcRenderer } = require('electron');

// 録音チャンクの送り先 (メインプロセスがファイルに書く)
window.__mmSink = function (b64) {
  ipcRenderer.send('mm-audio', b64);
};

(function () {
  if (window.__mmInstalled) return;
  window.__mmInstalled = true;
  const tracks = new Set();
  let ctx = null, dest = null, rec = null, started = false;

  function ensure() {
    if (!ctx) {
      ctx = new AudioContext();
      dest = ctx.createMediaStreamDestination();
    }
  }
  function addTrack(t) {
    try {
      if (!t || t.kind !== 'audio' || tracks.has(t)) return;
      tracks.add(t);
      ensure();
      ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      maybeStart();
    } catch (e) {}
  }
  function maybeStart() {
    if (started || !window.__mmArmed || !dest) return;
    if (dest.stream.getAudioTracks().length === 0) return;
    started = true;
    rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
    rec.ondataavailable = async (e) => {
      if (!e.data || !e.data.size) return;
      const buf = await e.data.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      window.__mmSink(btoa(bin));
    };
    rec.start(5000);
    ipcRenderer.send('mm-recording-started');
  }
  window.__mmStart = function () {
    window.__mmArmed = true;
    ensure();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    maybeStart();
  };
  window.__mmStop = function () {
    try { if (rec && rec.state !== 'inactive') { rec.requestData(); rec.stop(); } } catch (e) {}
  };

  const OrigPC = window.RTCPeerConnection;
  if (OrigPC) {
    const Wrapped = function (...args) {
      const pc = new OrigPC(...args);
      pc.addEventListener('track', (e) => addTrack(e.track));
      return pc;
    };
    Wrapped.prototype = OrigPC.prototype;
    try { Object.setPrototypeOf(Wrapped, OrigPC); } catch (e) {}
    window.RTCPeerConnection = Wrapped;
  }

  // 参加ボタンを押して音声が流れ出したら自動で録音が始まるよう、armしておく
  function arm() { try { window.__mmStart(); } catch (e) {} }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(arm, 1500);
  else window.addEventListener('DOMContentLoaded', () => setTimeout(arm, 1500));
})();
