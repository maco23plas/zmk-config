/* =========================================================================
   会場（疑似ライブの視聴ページ）
   ─────────────────────────────────────────────────────────────────────────
   ・再生位置はサーバー時刻から決まる（位置 = 現在時刻 − 開始時刻）
   ・開始前は「開場（ロビー）」。名前で迎え、他の参加者の入室が見え、挨拶できる
   ・司会の進行は台本を時刻どおりに出す（遅延ゼロ）
   ・参加者数とコメントは実際の参加者のもの。定期同期1本でまとめて取得する
   ========================================================================= */
(function () {
  'use strict';

  var cfg = JSON.parse(document.getElementById('watchConfig').textContent);

  var el = {};
  ['playerShell', 'playerMount', 'overlayWait', 'overlayLobby', 'overlayStart', 'overlaySound',
    'overlayEnded', 'overlayError', 'countdown', 'lobbyCountdown', 'lobbyPeople', 'lobbyGreeting',
    'startCountdown', 'soundBtn', 'endedTitle', 'endedNote', 'endedCta', 'progressBar', 'progressText',
    'viewerText', 'clock', 'livePill', 'livePillText', 'liveDot', 'roomCount', 'roomPeople',
    'ctaPanel', 'ctaLink', 'ctaTitle', 'pollPanel', 'pollQuestion', 'pollOptions', 'pollTotal',
    'chatLog', 'chatEmpty', 'chatForm', 'chatInput', 'chatSend', 'chatStatus',
    'qBody', 'qSend', 'qStatus', 'toastArea'].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---- サーバー時刻との同期 ------------------------------------------------
  var skew = cfg.serverNow - Date.now();
  var now = function () { return Date.now() + skew; };
  var positionSec = function () { return (now() - cfg.startAt) / 1000; };
  var lobbyAt = cfg.startAt - (cfg.lobbyOpenMin || 0) * 60000;

  var player = null;
  var started = false;
  var ended = false;
  var soundOn = false;
  var ctaShown = false;
  var scriptShown = 0;
  var lastMessageId = (cfg.room && cfg.room.lastId) || 0;
  var lastJoinAt = cfg.serverNow;
  var syncing = false;
  var lastSync = 0;
  var phase = '';
  var welcomed = false;
  var pollRendered = null;

  // ---- 小物 ----------------------------------------------------------------

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hms(t) {
    var s = Math.max(0, Math.floor(t));
    return two(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
  }
  function ms(t) {
    var s = Math.max(0, Math.floor(t));
    return two(Math.floor(s / 60)) + ':' + two(s % 60);
  }
  function show(node, visible) { if (node) node.hidden = !visible; }

  function setPill(label, live) {
    el.livePillText.textContent = label;
    el.livePill.classList.toggle('is-idle', !live);
    show(el.liveDot, live);
  }

  /** 画面右上と会場欄に出す参加人数 */
  function setPeople(room) {
    if (!room || !room.showViewers || !room.viewers) {
      show(el.roomCount, false);
      if (el.roomPeople) el.roomPeople.textContent = '';
      if (el.lobbyPeople) el.lobbyPeople.textContent = '';
      if (el.viewerText) el.viewerText.textContent = '';
      return;
    }
    var text = room.viewers.toLocaleString('ja-JP') + '名が参加中';
    el.roomCount.textContent = '👤 ' + room.viewers.toLocaleString('ja-JP');
    show(el.roomCount, true);
    if (el.roomPeople) el.roomPeople.textContent = text;
    if (el.lobbyPeople) el.lobbyPeople.textContent = 'いま ' + text;
    if (el.viewerText) el.viewerText.textContent = text;
  }

  function toast(text, kind) {
    if (!el.toastArea) return;
    var node = document.createElement('div');
    node.className = 'toast' + (kind ? ' toast-' + kind : '');
    node.textContent = text;
    el.toastArea.appendChild(node);
    setTimeout(function () { node.classList.add('is-out'); }, 4200);
    setTimeout(function () { node.remove(); }, 4800);
    while (el.toastArea.children.length > 4) el.toastArea.firstChild.remove();
  }

  // ---- コメント欄 ----------------------------------------------------------

  function appendMessage(msg) {
    if (!el.chatLog) return;
    if (el.chatEmpty) { el.chatEmpty.remove(); el.chatEmpty = null; }
    var atBottom = el.chatLog.scrollHeight - el.chatLog.scrollTop - el.chatLog.clientHeight < 40;

    var p = document.createElement('p');
    p.className = 'chat-msg' + (msg.kind === 'host' ? ' is-host' : msg.kind === 'system' ? ' is-system' : '');
    if (msg.mine) p.className += ' is-mine';
    var b = document.createElement('b');
    b.textContent = msg.name;
    var s = document.createElement('span');
    s.textContent = msg.body;
    p.appendChild(b); p.appendChild(s);
    el.chatLog.appendChild(p);

    while (el.chatLog.children.length > 200) el.chatLog.firstChild.remove();
    if (atBottom) el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }

  function ingestMessages(list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.id && m.id <= lastMessageId - 0) { /* 既出 */ }
      appendMessage({ name: m.name, body: m.body, kind: m.kind });
      if (m.id > lastMessageId) lastMessageId = m.id;
    }
  }

  /** 司会の進行台本。時刻で決まるので、通信を待たずにその場で出す。 */
  function playScript(pos) {
    while (scriptShown < cfg.script.length && cfg.script[scriptShown].at <= pos) {
      var line = cfg.script[scriptShown++];
      appendMessage({ name: line.author, body: line.body, kind: line.kind || 'host' });
    }
  }

  // ---- 投票 ----------------------------------------------------------------

  function renderPoll(poll) {
    if (!poll) { show(el.pollPanel, false); pollRendered = null; return; }

    var signature = poll.id + ':' + poll.myChoice + ':' + poll.tally.join(',') + ':' + poll.closed;
    if (signature === pollRendered) return;
    var isNew = !pollRendered || pollRendered.indexOf(poll.id + ':') !== 0;
    pollRendered = signature;

    el.pollQuestion.textContent = poll.question;
    el.pollOptions.textContent = '';

    var answered = poll.myChoice !== null && poll.myChoice !== undefined;
    poll.options.forEach(function (label, index) {
      var count = poll.tally[index] || 0;
      var pct = poll.total > 0 ? Math.round((count / poll.total) * 100) : 0;

      var row = document.createElement(answered || poll.closed ? 'div' : 'button');
      row.className = 'poll-option' + (poll.myChoice === index ? ' is-mine' : '');
      if (row.tagName === 'BUTTON') {
        row.type = 'button';
        row.addEventListener('click', function () { sendVote(poll.id, index); });
      }
      var bar = document.createElement('span');
      bar.className = 'poll-bar';
      bar.style.width = (answered || poll.closed ? pct : 0) + '%';
      var text = document.createElement('span');
      text.className = 'poll-label';
      text.textContent = label;
      row.appendChild(bar); row.appendChild(text);
      if (answered || poll.closed) {
        var num = document.createElement('span');
        num.className = 'poll-pct';
        num.textContent = pct + '%';
        row.appendChild(num);
      }
      el.pollOptions.appendChild(row);
    });

    // まだ投票していない人にも「何名が答えているか」は見せる。
    // 内訳は伏せたまま、場が動いていることが伝わるようにする。
    el.pollTotal.textContent = poll.closed ? '締め切りました（' + poll.total + '名回答）'
      : answered ? poll.total + '名が回答しています'
        : poll.total > 0 ? 'すでに' + poll.total + '名が回答しています。あてはまるものをお選びください'
          : 'あてはまるものをお選びください';
    show(el.pollPanel, true);
    if (isNew) toast('アンケートが届きました', 'poll');
  }

  function sendVote(pollId, choice) {
    post('/vote', { pollId: pollId, choice: choice }).then(function (data) {
      if (data && data.ok) renderPoll(data.poll);
    });
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
    el.playerMount.appendChild(video);

    var programmatic = false;
    video.addEventListener('seeking', function () {
      if (cfg.seekable || programmatic) return;
      var want = positionSec();
      if (Math.abs(video.currentTime - want) > 3) {
        programmatic = true;
        video.currentTime = want;
        setTimeout(function () { programmatic = false; }, 60);
      }
    });
    video.addEventListener('error', function () { show(el.overlayError, true); });
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
      unmute: function () { video.muted = false; },
      play: function () { return video.play(); },
    };
  }

  function buildYouTube(media, startAtSec, onReady) {
    var div = document.createElement('div');
    div.id = 'ytFrame';
    el.playerMount.appendChild(div);
    var guard = document.createElement('div');
    guard.className = 'yt-guard';
    el.playerShell.appendChild(guard);

    var yt = null;
    function create() {
      yt = new window.YT.Player('ytFrame', {
        videoId: media.id,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1,
          rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3,
          start: Math.max(0, Math.floor(startAtSec)),
        },
        events: {
          onReady: onReady,
          onError: function () { show(el.overlayError, true); },
          onStateChange: function (e) { if (e.data === window.YT.PlayerState.ENDED) finish(); },
        },
      });
    }
    if (window.YT && window.YT.Player) create();
    else {
      window.onYouTubeIframeAPIReady = create;
      var tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    return {
      seekTo: function (sec) { if (yt && yt.seekTo) yt.seekTo(sec, true); },
      getTime: function () { return yt && yt.getCurrentTime ? yt.getCurrentTime() : 0; },
      ready: function () { return Boolean(yt && yt.getCurrentTime); },
      unmute: function () { if (yt && yt.unMute) { yt.unMute(); yt.setVolume(100); } },
      play: function () { if (yt && yt.playVideo) yt.playVideo(); return Promise.resolve(); },
    };
  }

  function startPlayback(media) {
    if (started || !media) return;
    started = true;
    show(el.overlayWait, false);
    show(el.overlayLobby, false);
    show(el.overlayStart, false);

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
      // まず音声ありで試し、ブラウザに拒否されたらミュートで再生してから音声を促す
      video.muted = false;
      video.play().then(function () { soundOn = true; }).catch(function () {
        video.muted = true;
        video.play().then(askForSound).catch(askForSound);
      });
    };
    if (video.readyState >= 1) begin();
    else video.addEventListener('loadedmetadata', begin, { once: true });
  }

  function askForSound() { if (!soundOn) show(el.overlaySound, true); }

  if (el.soundBtn) {
    el.soundBtn.addEventListener('click', function () {
      soundOn = true;
      show(el.overlaySound, false);
      if (player) { player.unmute(); player.seekTo(Math.max(0, positionSec())); player.play(); }
    });
  }

  function finish() {
    if (ended) return;
    ended = true;
    setPill('終了', false);
    show(el.overlaySound, false);
    show(el.overlayStart, false);
    show(el.overlayEnded, true);
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

  // ---- 通信 ----------------------------------------------------------------

  function post(path, body) {
    return fetch('/watch/' + encodeURIComponent(cfg.token) + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.ok ? r.json() : r.json().catch(function () { return null; }); })
      .catch(function () { return null; });
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

  /** 同期の間隔。会場が開いている間だけ短くする。 */
  function syncInterval() {
    if (ended) return 60000;
    var pos = positionSec();
    if (pos >= 0) return 6000;                 // 配信中
    if (now() >= lobbyAt) return 8000;         // 開場中
    return Math.min(60000, Math.max(15000, -pos * 100)); // 開場前は控えめに
  }

  function sync(force) {
    if (syncing) return;
    if (!force && now() - lastSync < syncInterval()) return;
    syncing = true;
    var t0 = Date.now();

    post('/state', {
      atSec: Math.round(positionSec()),
      afterId: lastMessageId,
      sinceJoin: lastJoinAt,
    }).then(function (data) {
      if (!data || !data.state) return;
      var t1 = Date.now();
      skew = data.serverNow + (t1 - t0) / 2 - t1;   // 往復時間の半分で補正
      lastSync = now();
      cfg.state = data.state;
      cfg.seekable = data.seekable;

      if (data.room) {
        setPeople(data.room);
        if (data.room.messages && data.room.messages.length) ingestMessages(data.room.messages);
        if (data.room.joins) {
          data.room.joins.forEach(function (j) {
            toast(j.name + 'が入室しました', 'join');
            if (j.at > lastJoinAt) lastJoinAt = j.at;
          });
        }
      }
      renderPoll(data.poll);

      if (data.media && !started) startPlayback(data.media);
      if (data.state === 'ended' || data.state === 'canceled') finish();
    }).finally(function () { syncing = false; });
  }

  // ---- コメント送信 --------------------------------------------------------

  if (el.chatForm) {
    el.chatForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = (el.chatInput.value || '').trim();
      if (!body) return;
      el.chatSend.disabled = true;
      el.chatStatus.textContent = '';
      post('/chat', { body: body }).then(function (data) {
        if (data && data.ok) {
          el.chatInput.value = '';
          appendMessage({ name: cfg.me, body: body, kind: 'guest', mine: true });
          if (data.id > lastMessageId) lastMessageId = data.id;
        } else {
          el.chatStatus.textContent = (data && data.message) || '送信できませんでした';
        }
      }).finally(function () { el.chatSend.disabled = false; });
    });
  }

  if (el.qSend) {
    el.qSend.addEventListener('click', function () {
      var body = (el.qBody.value || '').trim();
      if (!body) { el.qStatus.textContent = '内容を入力してください'; return; }
      el.qSend.disabled = true;
      el.qStatus.textContent = '送信中…';
      post('/question', { body: body, atSec: Math.round(positionSec()) }).then(function (data) {
        if (data && data.ok) {
          el.qBody.value = '';
          el.qStatus.textContent = '送信しました。担当者より公式LINEでご回答します。';
        } else {
          el.qStatus.textContent = '送信できませんでした。時間をおいてお試しください。';
        }
      }).finally(function () { el.qSend.disabled = false; });
    });
  }

  // ---- メインループ --------------------------------------------------------

  function enterPhase(name) {
    if (phase === name) return;
    phase = name;
    if (name === 'lobby') {
      show(el.overlayWait, false);
      show(el.overlayLobby, true);
      setPill('開場中', false);
      if (el.chatEmpty) el.chatEmpty.textContent = 'ご自由に挨拶をどうぞ。開始までお待ちください。';
      if (!welcomed) { welcomed = true; toast(cfg.welcome, 'welcome'); }
      sync(true);
    } else if (name === 'countdown') {
      show(el.overlayLobby, false);
      show(el.overlayStart, true);
    } else if (name === 'live') {
      show(el.overlayStart, false);
      setPill('配信中', true);
      if (!welcomed) { welcomed = true; toast(cfg.welcome, 'welcome'); }
    }
  }

  function tick() {
    var pos = positionSec();

    if (ended) { el.progressBar.style.width = '100%'; return; }

    // 台本は開始前（負の秒数）から流れる
    playScript(pos);

    if (pos < 0) {
      var untilStart = -pos;
      el.clock.textContent = '開始まで ' + hms(untilStart);

      if (now() < lobbyAt) {
        enterPhase('wait');
        show(el.overlayWait, true);
        setPill('開場前', false);
        el.countdown.textContent = hms((lobbyAt - now()) / 1000);
      } else if (untilStart <= 10) {
        enterPhase('countdown');
        el.startCountdown.textContent = String(Math.max(1, Math.ceil(untilStart)));
      } else {
        enterPhase('lobby');
        el.lobbyCountdown.textContent = ms(untilStart);
      }
      el.progressBar.style.width = '0%';
      sync(false);
      return;
    }

    if (pos >= cfg.durationSec) { finish(); return; }

    enterPhase('live');
    var pct = cfg.durationSec > 0 ? Math.min(100, (pos / cfg.durationSec) * 100) : 0;
    el.progressBar.style.width = pct + '%';
    el.clock.textContent = hms(pos) + ' / ' + hms(cfg.durationSec);

    if (!ctaShown && cfg.cta && pos >= (cfg.cta.atSec || 0)) {
      ctaShown = true;
      el.ctaTitle.textContent = cfg.cta.label;
      el.ctaLink.textContent = cfg.cta.label;
      el.ctaLink.href = cfg.cta.url;
      el.ctaLink.addEventListener('click', function () { sendEvent('cta_click', positionSec()); });
      show(el.ctaPanel, true);
      toast('ご案内が表示されました', 'cta');
    }

    if (!started) { sync(true); return; }

    // 再生位置のずれを補正する（タブが裏に回っていた・バッファリングで遅れた等）
    if (player && player.ready()) {
      var drift = player.getTime() - pos;
      if (Math.abs(drift) > 2.5) player.seekTo(pos);
    }
    sync(false);
  }

  // ---- 起動 ----------------------------------------------------------------

  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(true); });
  window.addEventListener('pagehide', function () { if (started && !ended) sendEvent('leave', positionSec()); });

  if (cfg.room && cfg.room.messages) ingestMessages(cfg.room.messages);
  setPeople(cfg.room);
  renderPoll(cfg.poll);

  if (cfg.state === 'ended' || cfg.state === 'canceled') {
    finish();
  } else {
    if (cfg.media) startPlayback(cfg.media);
    sendEvent('open', positionSec());
    tick();
    setInterval(tick, 500);
  }
})();
