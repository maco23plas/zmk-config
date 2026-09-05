import { page } from './layout.js';
import { h, jsonScript, nl2br } from '../lib/html.js';
import { config } from '../config.js';
import { formatJst, formatJstTime, formatDuration } from '../lib/time.js';
import { PlaybackState, STATE_LABEL } from '../domain/playback.js';
import { displayNameFor } from '../domain/room.js';

/**
 * 視聴ページ ＝「会場」。
 *
 * 動画を見せる画面ではなく、決まった時刻に人が集まる場として作っている。
 *   ・開場（開始前）… 名前で迎え、他の参加者の入室が見え、挨拶を交わせる
 *   ・配信中        … 司会の進行、参加者のコメント、投票
 *   ・終了          … 締めの挨拶と、公式LINEでの質問受付へ
 *
 * 人数・入室・コメントはすべて実際の参加者の行動で、作り物ではない。
 * 開催枠が時刻で決まっているので、本当に同じ時間に居合わせる。
 */
export function watchPage({ reservation, state, media, script, room, poll, serverNow }) {
  const myName = displayNameFor(reservation.name);
  const chatEnabled = Boolean(reservation.show_chat) && reservation.chat_mode === 'on';
  const chatVisible = Boolean(reservation.show_chat) && reservation.chat_mode !== 'off';

  const cfg = {
    token: reservation.watch_token,
    startAt: reservation.start_at,
    durationSec: reservation.duration_sec,
    lobbyOpenMin: reservation.lobby_open_min,
    serverNow,
    state: state.state,
    seekable: state.seekable,
    media,
    poster: reservation.poster_url || '',
    me: myName,
    welcome: reservation.welcome_message || `${myName}、ご参加ありがとうございます。`,
    closing: reservation.closing_message || '本日はご参加いただきありがとうございました。',
    lineUrl: config.line.addFriendUrl || '',
    cta: reservation.cta_url
      ? { label: reservation.cta_label || '詳しく見る', url: reservation.cta_url, atSec: reservation.cta_at_sec }
      : null,
    script: script || [],
    room: room || { viewers: 0, showViewers: false, messages: [], lastId: 0 },
    poll: poll || null,
    chatEnabled,
    chatVisible,
  };

  const header = h`
    <header class="watch-head">
      <div class="wrap-wide">
        <h1 class="watch-title">${reservation.title}</h1>
        <span class="live-pill is-idle" id="livePill">
          <span class="live-dot" id="liveDot" hidden></span><span id="livePillText">${STATE_LABEL[state.state]}</span>
        </span>
        <span class="room-count" id="roomCount" hidden></span>
        <span class="watch-clock" id="clock"></span>
      </div>
    </header>`;

  const body = h`
    <div class="stage">
      <div class="stage-main">
        <div class="player-shell" id="playerShell">
          <div id="playerMount"></div>

          <!-- 開場前 -->
          <div class="overlay" id="overlayWait" hidden>
            <div>
              <p class="countdown-label">開場まで</p>
              <div class="countdown" id="countdown">--:--:--</div>
              <p>${formatJst(reservation.start_at)} 開始<br>
                開始${reservation.lobby_open_min}分前から会場に入れます。</p>
            </div>
          </div>

          <!-- 開場中（ロビー） -->
          <div class="overlay overlay-lobby" id="overlayLobby" hidden>
            <div>
              <p class="lobby-badge">● 開場しました</p>
              <h2 id="lobbyGreeting">${myName}、ようこそ</h2>
              <p class="lobby-note">${formatJstTime(reservation.start_at)} になると自動ではじまります。<br>
                このままお待ちください。</p>
              <div class="countdown countdown-sm" id="lobbyCountdown">--:--</div>
              <p class="lobby-people" id="lobbyPeople"></p>
            </div>
          </div>

          <!-- 開始直前の 3・2・1 -->
          <div class="overlay overlay-start" id="overlayStart" hidden>
            <div>
              <p class="lobby-badge">まもなく開始します</p>
              <div class="countdown countdown-big" id="startCountdown">3</div>
            </div>
          </div>

          <div class="overlay" id="overlaySound" hidden>
            <div>
              <h2>まもなく映像が始まります</h2>
              <p>スマートフォンの仕様により、音声はオフの状態で開始します。<br>
                下のボタンから音声をオンにしてください。</p>
              <button class="sound-btn" id="soundBtn" type="button">🔊 音声をオンにする</button>
            </div>
          </div>

          <div class="overlay" id="overlayEnded" hidden>
            <div>
              <h2 id="endedTitle">本日の説明会は終了しました</h2>
              <p id="endedNote">${reservation.closing_message || 'ご参加いただきありがとうございました。'}</p>
              <div id="endedCta"></div>
              ${config.line.addFriendUrl ? h`
                <p style="margin-top:14px">
                  <a class="sound-btn" href="${config.line.addFriendUrl}">公式LINEで質問する</a>
                </p>` : ''}
            </div>
          </div>

          <div class="overlay" id="overlayError" hidden>
            <div>
              <h2>映像を読み込めませんでした</h2>
              <p>通信環境をご確認のうえ、ページを再読み込みしてください。</p>
              <button class="sound-btn" type="button" onclick="location.reload()">再読み込み</button>
            </div>
          </div>
        </div>

        <div class="progress"><div class="progress-bar" id="progressBar"></div></div>
        <div class="progress-note">
          <span id="progressText">${formatJst(reservation.start_at)} 開始</span>
          <span id="viewerText"></span>
        </div>

        <!-- 投票 -->
        <div class="panel poll-panel" id="pollPanel" hidden>
          <h3 id="pollQuestion"></h3>
          <div id="pollOptions"></div>
          <p class="poll-total" id="pollTotal"></p>
        </div>

        <!-- 申し込みボタン -->
        <div class="panel cta-wrap" id="ctaPanel" hidden>
          <div class="cta-card">
            <h3 id="ctaTitle">ご案内</h3>
            <p>説明会をご覧いただいた方へのご案内です。</p>
            <a class="btn btn-block" id="ctaLink" href="#" target="_blank" rel="noopener">詳しく見る</a>
          </div>
        </div>

        <div class="panel">
          <h3>${reservation.title}</h3>
          ${reservation.description ? h`<p>${nl2br(reservation.description)}</p>` : ''}
          <dl class="dl" style="margin-top:12px">
            <dt>開催日時</dt><dd>${formatJst(reservation.start_at)}</dd>
            <dt>所要時間</dt><dd>約${formatDuration(reservation.duration_sec)}</dd>
            ${reservation.presenter ? h`<dt>登壇</dt><dd>${reservation.presenter}</dd>` : ''}
            <dt>お名前</dt><dd>${reservation.name} 様</dd>
          </dl>
        </div>
      </div>

      <!-- 会場サイド -->
      <aside class="stage-side">
        ${chatVisible ? h`
          <div class="panel room-panel">
            <div class="room-head">
              <h3>コメント</h3>
              <span class="room-people" id="roomPeople"></span>
            </div>
            <div class="chat-log" id="chatLog">
              <p class="chat-empty" id="chatEmpty">開場までしばらくお待ちください</p>
            </div>
            ${chatEnabled ? h`
              <form class="chat-form" id="chatForm">
                <input type="text" id="chatInput" maxlength="140" autocomplete="off"
                       placeholder="${myName}としてコメント">
                <button type="submit" id="chatSend" aria-label="送信">送信</button>
              </form>
              <p class="chat-status" id="chatStatus"></p>`
            : h`<p class="chat-readonly">この回のコメント投稿は受け付けていません。</p>`}
          </div>` : ''}

        <div class="panel q-form">
          <h3>質問を送る</h3>
          <p style="font-size:.85rem;margin-bottom:9px">
            その場で聞きづらいことは、こちらからどうぞ。担当者が公式LINEでご回答します。
          </p>
          <textarea id="qBody" maxlength="1000" placeholder="例）自分が対象になるか知りたいです"></textarea>
          <button class="btn btn-primary btn-sm btn-block" id="qSend" type="button" style="margin-top:9px">送信する</button>
          <p class="q-status" id="qStatus"></p>
        </div>

        <div class="panel">
          <h3>ご視聴について</h3>
          <p style="font-size:.86rem">
            ・アプリのインストールやログインは不要です<br>
            ・巻き戻し・早送りはできません<br>
            ・通信が途切れた場合は、ページを再読み込みすると現在の位置から再開します
          </p>
        </div>
      </aside>

      <div class="toast-area" id="toastArea" aria-live="polite"></div>

      <p class="watch-note">
        この配信は、ご予約いただいた開始時刻に合わせて自動再生される録画配信です。<br>
        コメント欄と参加者数は、同じ回にご参加中の方の実際のものです。
      </p>
    </div>

    <script id="watchConfig" type="application/json">${jsonScript(cfg)}</script>
    <script src="/static/watch.js?v=2" defer></script>`;

  return page({
    title: `${reservation.title} | 視聴ページ`,
    bodyClass: 'watch',
    noindex: true,
    header,
    footer: false,
    body,
  });
}

/** 視聴できない状態（キャンセル・締切・終了）向けの案内ページ */
export function watchBlockedPage(reservation, state, now) {
  const messages = {
    [PlaybackState.CANCELED]: ['この回は中止になりました', '振替の日程は公式LINEでご案内します。'],
    [PlaybackState.LATE_CLOSED]: ['入場受付を終了しました', '次回の開催日程からご予約ください。'],
    [PlaybackState.ENDED]: ['この回は終了しました', reservation.closing_message || 'ご参加ありがとうございました。'],
  };
  const [title, note] = messages[state.state] || ['ご視聴いただけません', ''];

  return page({
    title: `${title} | オンライン説明会`,
    noindex: true,
    body: h`
      <main><div class="wrap">
        <div class="card">
          <h1>${title}</h1>
          <p class="muted">${note}</p>
          <dl class="dl">
            <dt>説明会</dt><dd>${reservation.title}</dd>
            <dt>開催日時</dt><dd>${formatJst(reservation.start_at)}</dd>
          </dl>
          <p style="margin-top:18px">
            <a class="btn btn-primary" href="/">次回の日程を見る</a>
            ${config.line.addFriendUrl ? h`
              <a class="btn btn-line" href="${config.line.addFriendUrl}">公式LINEで質問する</a>` : ''}
          </p>
        </div>
      </div></main>`,
  });
}

/** 予約が見つからない場合 */
export function watchNotFoundPage() {
  return page({
    title: '視聴ページが見つかりません',
    noindex: true,
    body: h`
      <main><div class="wrap">
        <div class="card">
          <h1>視聴ページが見つかりません</h1>
          <p class="muted">
            リンクが正しいかご確認ください。公式LINEに届いたメッセージのボタンから開くと確実です。
          </p>
          <p><a class="btn btn-ghost" href="/">開催日程を見る</a></p>
        </div>
      </div></main>`,
  });
}
