/* =========================================================================
   疑似ライブ視聴プレイヤー
   再生位置はサーバー時刻から決まる（位置 = 現在時刻 - 開始時刻）。
   巻き戻し・早送りはできず、誰が開いても同じ場面が流れる。
   ========================================================================= */
(function () {
  'use strict';

  var cfg = JSON.parse(document.getElementById('watchConfig').textContent);

  var el = {
    shell: document.getElementById('playerShell'),
    mount: document.getElementById('playerMount'),
    wait: document.getElementById('overlayWait'),
    waitLabel: document.getElementById('waitLabel'),
    waitNote: document.getElementById('waitNote'),
    countdown: document.getElementById('countdown'),
    sound: document.getElementById('overlaySound'),
    soundBtn: document.getElementById('soundBtn'),
    ended: document.getElementById('overlayEnded'),
    endedTitle: document.getElementById('endedTitle'),
    endedNote: document.getElementById('endedNote'),
    endedCta: document.getElementById('endedCta'),
    error: document.getElementById('overlayError'),
    bar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    viewerText: document.getElementById('viewerText'),
    clock: document.getElementById('clock'),
    pill: document.getElementById('livePill'),
    pillText: document.getElementById('livePillText'),
    dot: document.getElementById('liveDot'),
    ctaPanel: document.getElementById('ctaPanel'),
    ctaLink: document.getElementById('ctaLink'),
    ctaTitle: document.getElementById('ctaTitle'),
    chatLog: document.getElementById('chatLog'),
    chatEmpty: document.getElementById('chatEmpty'),
    qBody: document.getElementById('qBody'),
    qSend: document.getElementById('qSend'),
    qStatus: document.getElementById('qStatus'),
  };

  // ---- サーバー時刻との同期 ------------------------------------------------
  // 端末の時計はずれていることがあるので、サーバー時刻との差分を持って補正する。
  var skew = cfg.serverNow - Date.now();
  var now = function () { return Date.now() + skew; };
  var positionSec = function () { return (now() - cfg.startAt) / 1000; };

  var player = null;       // { seekTo, getTime, mute, unmute, isMuted, play }
  var started = false;
  var ended = false;
  var chatShown = 0;
  var ctaShown = false;
  var soundOn = false;
  var lastSync = 0;
  var fetchingState = false;

  // ---- 画面の更新 ----------------------------------------------------------

  function two(n) { return (n < 10 ? '0' : '') + n; }

  function hms(totalSec) {
    var s = Math.max(0, Math.floor(totalSec));
    return two(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
  }

  function show(node, visible) { if (node) node.hidden = !visible; }

  function setPill(label, live) {
    el.pillText.textContent = label;
    el.pill.classList.toggle('is-idle', !live);
    show(el.dot, live);
  }

  function updateProgress(pos) {
    var pct = cfg.durationSec > 0 ? Math.min(100, Math.max(0, (pos / cfg.durationSec) * 100)) : 0;
    el.bar.style.width = pct + '%';
    el.clock.textContent = hms(pos) + ' / ' + hms(cfg.durationSec);
  }

  // ---- プレイヤー ----------------------------------------------------------

  function buildHtml5(media) {
    var video = document.createElement('video');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    if (cfg.poster) video.poster = cfg.poster;
    video.src = media.src;
    video.controls = false;
    video.disablePictureInPicture = true;
    el.mount.appendChild(video);

    var programmatic = false;
    // 早送り・巻き戻しの禁止。ユーザー操作によるシークは元の位置へ戻す。
    video.addEventListener('seeking', function () {
      if (cfg.seekable || programmatic) return;
      var want = positionSec();
      if (Math.abs(video.currentTime - want) > 3) {
        programmatic = true;
        video.currentTime = want;
        setTimeout(function () { programmatic = false; }, 60);
      }
    });
    video.addEventListener('error', function () { show(el.error, true); });
    video.addEventListener('ended', function () { finish(); });

    return {
      node: video,
      seekTo: function (sec) {
        programmatic = true;
        try { video.currentTime = sec; } catch { /* メタデータ読み込み前は無視 */ }
        setTimeout(function () { programmatic = false; }, 60);
      },
      getTime: function () { return video.currentTime; },
      ready: function () { return video.readyState >= 2; },
      mute: function () { video.muted = true; },
      unmute: function () { video.muted = false; },
      isMuted: function () { return video.muted; },
      play: function () { return video.play(); },
    };
  }

  function buildYouTube(media, startAtSec, onReady) {
    var frameId = 'ytFrame';
    var div = document.createElement('div');
    div.id = frameId;
    el.mount.appendChild(div);
    // YouTubeのロゴやタイトルからの離脱を防ぐため、クリックを受け止める透明レイヤーを重ねる
    var guard = document.createElement('div');
    guard.className = 'yt-guard';
    el.shell.appendChild(guard);

    var yt = null;
    function create() {
      yt = new window.YT.Player(frameId, {
        videoId: media.id,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1,
          rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3,
          start: Math.max(0, Math.floor(startAtSec)),
        },
        events: {
          onReady: function () { onReady(); },
          onError: function () { show(el.error, true); },
          onStateChange: function (e) {
            if (e.data === window.YT.PlayerState.ENDED) finish();
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      create();
    } else {
      window.onYouTubeIframeAPIReady = create;
      var tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    return {
      seekTo: function (sec) { if (yt && yt.seekTo) yt.seekTo(sec, true); },
      getTime: function () { return yt && yt.getCurrentTime ? yt.getCurrentTime() : 0; },
      ready: function () { return Boolean(yt && yt.getCurrentTime); },
      mute: function () { if (yt && yt.mute) yt.mute(); },
      unmute: function () { if (yt && yt.unMute) { yt.unMute(); yt.setVolume(100); } },
      isMuted: function () { return yt && yt.isMuted ? yt.isMuted() : true; },
      play: function () { if (yt && yt.playVideo) yt.playVideo(); return Promise.resolve(); },
    };
  }

  // ---- 再生の開始 ----------------------------------------------------------

  function startPlayback(media) {
    if (started || !media) return;
    started = true;
    show(el.wait, false);

    var pos = Math.max(0, positionSec());

    if (media.type === 'youtube') {
      player = buildYouTube(media, pos, function () {
        player.seekTo(Math.max(0, positionSec()));
        player.play();
        askForSound();
      });
      return;
    }

    player = buildHtml5(media);
    var video = player.node;

    var begin = function () {
      player.seekTo(Math.max(0, positionSec()));
      // まず音声ありで試し、ブラウザに拒否されたらミュートで再生してから音声を促す。
      video.muted = false;
      video.play().then(function () {
        soundOn = true;
      }).catch(function () {
        video.muted = true;
        video.play().then(askForSound).catch(function () { askForSound(); });
      });
    };

    if (video.readyState >= 1) begin();
    else video.addEventListener('loadedmetadata', begin, { once: true });
  }

  function askForSound() {
    if (soundOn) return;
    show(el.sound, true);
  }

  el.soundBtn.addEventListener('click', function () {
    soundOn = true;
    show(el.sound, false);
    if (player) {
      player.unmute();
      player.seekTo(Math.max(0, positionSec()));
      player.play();
    }
  });

  function finish() {
    if (ended) return;
    ended = true;
    setPill('終了', false);
    show(el.sound, false);
    show(el.ended, true);
    if (cfg.cta && el.endedCta && !el.endedCta.dataset.filled) {
      el.endedCta.dataset.filled = '1';
      var a = document.createElement('a');
      a.className = 'sound-btn';
      a.href = cfg.cta.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = cfg.cta.label;
      a.addEventListener('click', function () { sendEvent('cta_click', positionSec()); });
      el.endedCta.appendChild(a);
    }
    sendEvent('leave', cfg.durationSec);
  }

  // ---- 演出（CTA・コメント・視聴者数） --------------------------------------

  function updateCta(pos) {
    if (ctaShown || !cfg.cta) return;
    if (pos < (cfg.cta.atSec || 0)) return;
    ctaShown = true;
    el.ctaTitle.textContent = cfg.cta.label;
    el.ctaLink.textContent = cfg.cta.label;
    el.ctaLink.href = cfg.cta.url;
    el.ctaLink.addEventListener('click', function () { sendEvent('cta_click', positionSec()); });
    show(el.ctaPanel, true);
  }

  function updateChat(pos) {
    if (!el.chatLog || !cfg.chat.length) return;
    while (chatShown < cfg.chat.length && cfg.chat[chatShown].at <= pos) {
      var m = cfg.chat[chatShown++];
      if (el.chatEmpty) { el.chatEmpty.remove(); el.chatEmpty = null; }
      var p = document.createElement('p');
      p.className = 'chat-msg' + (m.kind === 'host' ? ' is-host' : '');
      var b = document.createElement('b');
      b.textContent = m.author;
      var s = document.createElement('span');
      s.textContent = m.body;
      p.appendChild(b); p.appendChild(s);
      el.chatLog.appendChild(p);
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    }
  }

  function updateViewers(count) {
    if (!cfg.viewer.enabled || !count) { el.viewerText.textContent = ''; return; }
    el.viewerText.textContent = count.toLocaleString('ja-JP') + '名が視聴中';
  }

  // ---- サーバーとの同期 ----------------------------------------------------

  function syncWithServer(force) {
    if (fetchingState) return;
    if (!force && now() - lastSync < 30000) return;
    fetchingState = true;
    var t0 = Date.now();

    fetch('/watch/' + encodeURIComponent(cfg.token) + '/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ atSec: Math.round(positionSec()) }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        // 往復時間の半分を足してサーバー時刻を推定し直す
        var t1 = Date.now();
        skew = data.serverNow + (t1 - t0) / 2 - t1;
        lastSync = now();
        cfg.state = data.state;
        cfg.seekable = data.seekable;
        updateViewers(data.viewerCount);
        if (data.media && !started) startPlayback(data.media);
        if (data.state === 'ended' || data.state === 'canceled') finish();
      })
      .catch(function () { /* 一時的な通信エラーは次回の同期で回復する */ })
      .finally(function () { fetchingState = false; });
  }

  function sendEvent(kind, atSec) {
    var payload = JSON.stringify({ kind: kind, atSec: Math.round(atSec || 0) });
    var url = '/watch/' + encodeURIComponent(cfg.token) + '/event';
    if (kind === 'leave' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      return;
    }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
      .catch(function () {});
  }

  // ---- メインループ --------------------------------------------------------

  function tick() {
    var pos = positionSec();

    if (ended) { updateProgress(cfg.durationSec); return; }

    if (pos < 0) {
      // 開始前：カウントダウン
      setPill('開始前', false);
      show(el.wait, true);
      el.countdown.textContent = hms(-pos);
      el.waitLabel.textContent = -pos < 600 ? 'まもなく開始します' : '開始まで';
      updateProgress(0);
      // 開始10秒前になったらサーバーに動画URLを取りに行く
      if (pos > -10) syncWithServer(!started);
      return;
    }

    if (pos >= cfg.durationSec) { finish(); return; }

    setPill('配信中', true);
    updateProgress(pos);
    updateCta(pos);
    updateChat(pos);

    if (!started) {
      // 開始時刻を過ぎているのに動画がまだ無い（開始前に開いた／再読込直後）
      syncWithServer(true);
      return;
    }

    // 再生位置のずれを補正する（タブが裏に回っていた・バッファリングで遅れた等）
    if (player && player.ready()) {
      var drift = player.getTime() - pos;
      if (Math.abs(drift) > 2.5) player.seekTo(pos);
    }

    syncWithServer(false);
  }

  // ---- 質問フォーム --------------------------------------------------------

  if (el.qSend) {
    el.qSend.addEventListener('click', function () {
      var body = (el.qBody.value || '').trim();
      if (!body) { el.qStatus.textContent = '内容を入力してください'; return; }
      el.qSend.disabled = true;
      el.qStatus.textContent = '送信中…';
      fetch('/watch/' + encodeURIComponent(cfg.token) + '/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body, atSec: Math.round(positionSec()) }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error('failed');
          el.qBody.value = '';
          el.qStatus.textContent = '送信しました。担当者よりご回答します。';
        })
        .catch(function () { el.qStatus.textContent = '送信できませんでした。時間をおいてお試しください。'; })
        .finally(function () { el.qSend.disabled = false; });
    });
  }

  // ---- 起動 ----------------------------------------------------------------

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncWithServer(true);
  });
  window.addEventListener('pagehide', function () {
    if (started && !ended) sendEvent('leave', positionSec());
  });

  el.progressText.textContent = cfg.state === 'archive' ? '見逃し配信' : el.progressText.textContent;
  updateViewers(cfg.viewer.current);

  if (cfg.state === 'ended' || cfg.state === 'canceled') {
    finish();
  } else {
    if (cfg.media) { startPlayback(cfg.media); sendEvent('open', positionSec()); }
    else { sendEvent('open', positionSec()); }
    tick();
    setInterval(tick, 500);
    setInterval(function () { if (started && !ended) sendEvent('heartbeat', positionSec()); }, 30000);
  }
})();
