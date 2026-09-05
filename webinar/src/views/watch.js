import { page } from './layout.js';
import { h, jsonScript, nl2br } from '../lib/html.js';
import { config } from '../config.js';
import { formatJst, formatDuration } from '../lib/time.js';
import { PlaybackState, STATE_LABEL } from '../domain/playback.js';

/**
 * 視聴ページ。
 * 画面の状態遷移（待機→配信中→終了）はクライアント側で時計を見ながら行う。
 * サーバーは「いま再生してよいか」と「動画の在処」だけを握り、
 * 開始前に動画URLを渡さないことで先出し視聴を防ぐ。
 */
export function watchPage({ reservation, state, media, chat, serverNow, viewerCount }) {
  const cfg = {
    token: reservation.watch_token,
    title: reservation.title,
    startAt: reservation.start_at,
    durationSec: reservation.duration_sec,
    serverNow,
    state: state.state,
    seekable: state.seekable,
    lateJoinSec: reservation.late_join_sec,
    media,   // 配信中/見逃し配信のときだけ入る
    poster: reservation.poster_url || '',
    cta: reservation.cta_url
      ? { label: reservation.cta_label || '詳しく見る', url: reservation.cta_url, atSec: reservation.cta_at_sec }
      : null,
    chat: chat || [],
    viewer: { enabled: Boolean(reservation.show_viewer_count), base: reservation.viewer_base || 0, current: viewerCount || 0 },
  };

  const header = h`
    <header class="watch-head">
      <div class="wrap-wide">
        <h1 class="watch-title">${reservation.title}</h1>
        <span class="live-pill is-idle" id="livePill">
          <span class="live-dot" id="liveDot" hidden></span><span id="livePillText">${STATE_LABEL[state.state]}</span>
        </span>
        <span class="watch-clock" id="clock"></span>
      </div>
    </header>`;

  const body = h`
    <div class="stage">
      <div class="player-shell" id="playerShell">
        <div id="playerMount"></div>

        <div class="overlay" id="overlayWait" hidden>
          <div>
            <p class="countdown-label" id="waitLabel">開始まで</p>
            <div class="countdown" id="countdown">--:--:--</div>
            <p id="waitNote">${formatJst(reservation.start_at)} に自動で始まります。<br>
              このページを開いたままお待ちください。</p>
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
            <p id="endedNote">ご参加ありがとうございました。</p>
            <div id="endedCta"></div>
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

      <div class="stage-grid">
        <div>
          <div class="panel" id="ctaPanel" hidden>
            <div class="cta-card" style="margin:-17px;padding:17px;border-radius:14px">
              <h3 id="ctaTitle">ご案内</h3>
              <p>説明会をご覧いただいた方へのご案内です。</p>
              <a class="btn btn-block" id="ctaLink" href="#" target="_blank" rel="noopener">詳しく見る</a>
            </div>
          </div>

          <div class="panel" style="margin-top:${reservation.cta_url ? '18px' : '0'}">
            <h3>${reservation.title}</h3>
            ${reservation.description ? h`<p>${nl2br(reservation.description)}</p>` : ''}
            <dl class="dl" style="margin-top:12px">
              <dt>開催日時</dt><dd>${formatJst(reservation.start_at)}</dd>
              <dt>所要時間</dt><dd>約${formatDuration(reservation.duration_sec)}</dd>
              ${reservation.presenter ? h`<dt>登壇</dt><dd>${reservation.presenter}</dd>` : ''}
              <dt>お名前</dt><dd>${reservation.name} 様</dd>
            </dl>
          </div>

          <div class="panel q-form" style="margin-top:18px">
            <h3>質問を送る</h3>
            <p style="font-size:.85rem;margin-bottom:9px">
              視聴中に浮かんだ疑問をお送りください。担当者が公式LINEでご回答します。
            </p>
            <textarea id="qBody" maxlength="1000" placeholder="例）自分が対象になるか知りたいです"></textarea>
            <button class="btn btn-primary btn-sm btn-block" id="qSend" type="button" style="margin-top:9px">送信する</button>
            <p class="q-status" id="qStatus"></p>
          </div>
        </div>

        ${reservation.show_chat ? h`
          <div class="panel chat">
            <h3>コメント</h3>
            <div class="chat-log" id="chatLog">
              <p class="chat-empty" id="chatEmpty">開始までしばらくお待ちください</p>
            </div>
          </div>` : h`
          <div class="panel">
            <h3>視聴について</h3>
            <p style="font-size:.86rem">
              ・アプリのインストールやログインは不要です<br>
              ・巻き戻し・早送りはできません<br>
              ・通信が途切れた場合は、ページを再読み込みすると現在の位置から再開します
            </p>
            ${config.line.addFriendUrl ? h`
              <a class="btn btn-ghost btn-sm btn-block" style="margin-top:12px"
                 href="${config.line.addFriendUrl}">公式LINEを開く</a>` : ''}
          </div>`}
      </div>

      <p class="watch-note">
        この配信は、ご予約いただいた開始時刻に合わせて自動再生される録画配信です。<br>
        映像が乱れる場合は、ページを再読み込みしてください。
      </p>
    </div>

    <script id="watchConfig" type="application/json">${jsonScript(cfg)}</script>
    <script src="/static/watch.js?v=1" defer></script>`;

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
    [PlaybackState.ENDED]: ['この回は終了しました', 'ご参加ありがとうございました。'],
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
          <p style="margin-top:18px"><a class="btn btn-primary" href="/">次回の日程を見る</a></p>
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
