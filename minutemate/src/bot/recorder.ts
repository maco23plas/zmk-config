/**
 * ページに注入する録音スクリプト。
 * RTCPeerConnection をフックして相手側の音声トラックを全部 AudioContext でミックスし、
 * MediaRecorder (webm/opus) で 5 秒ごとのチャンクとして Node 側 (__mmSink) に送る。
 * 画面録画や仮想オーディオデバイスが不要なので、無料・軽量・ヘッドレスでも動く。
 */
export const RECORDER_JS = `
(() => {
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
      const src = ctx.createMediaStreamSource(new MediaStream([t]));
      src.connect(dest);
      maybeStart();
    } catch (e) {}
  }
  function maybeStart() {
    if (started || !window.__mmArmed || !dest) return;
    if (dest.stream.getAudioTracks().length === 0) return;
    started = true;
    rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
    rec.ondataavailable = async (e) => {
      if (!e.data || !e.data.size || !window.__mmSink) return;
      const buf = await e.data.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      window.__mmSink(btoa(bin));
    };
    rec.start(5000);
    window.__mmRecording = true;
  }
  window.__mmStart = () => {
    window.__mmArmed = true;
    ensure();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    maybeStart();
  };
  window.__mmStop = () => {
    try { if (rec && rec.state !== 'inactive') { rec.requestData(); rec.stop(); } } catch (e) {}
    window.__mmRecording = false;
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
})();
`;
