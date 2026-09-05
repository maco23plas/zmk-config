import { page, errorPage } from './layout.js';
import { h, nl2br } from '../lib/html.js';
import { config } from '../config.js';
import { formatJst, formatDuration, formatRelative, isSameJstDay, googleCalendarUrl } from '../lib/time.js';
import { seatsLeft } from '../domain/sessions.js';
import { playbackState, PlaybackState } from '../domain/playback.js';

export { errorPage };

/** LINEのトークに文面を入れた状態で開くURL（友だち追加＋コード送信が1タップで済む） */
export function lineOaMessageUrl(code) {
  if (!config.line.basicId) return '';
  return `https://line.me/R/oaMessage/${encodeURIComponent(config.line.basicId)}/?${encodeURIComponent(`予約コード ${code}`)}`;
}

function slotBadge(session, now) {
  const st = playbackState({
    startAt: session.start_at, durationSec: session.duration_sec,
    lateJoinSec: session.late_join_sec, archiveHours: session.archive_hours,
    lobbyOpenMin: session.lobby_open_min, status: session.status,
  }, now);
  if (st.state === PlaybackState.LIVE) return h`<span class="badge badge-live">● 配信中</span>`;
  if (st.state === PlaybackState.LOBBY) return h`<span class="badge badge-soon">まもなく開始</span>`;
  if (isSameJstDay(session.start_at, now)) return h`<span class="badge badge-soon">本日</span>`;
  return '';
}

function seatsText(session) {
  const left = seatsLeft(session);
  return left === null ? '' : `残り${left}席`;
}

// ---- 開催日程一覧 ----------------------------------------------------------

export function indexPage(sessions, now) {
  const groups = new Map();
  for (const s of sessions) {
    if (!groups.has(s.webinar_id)) groups.set(s.webinar_id, []);
    groups.get(s.webinar_id).push(s);
  }

  const body = h`
    <main><div class="wrap">
      ${groups.size === 0 ? h`
        <div class="card">
          <h1>現在ご予約いただける日程がありません</h1>
          <p class="muted">次回の開催が決まりましたら、公式LINEでお知らせします。</p>
          ${config.line.addFriendUrl ? h`
            <a class="btn btn-line" href="${config.line.addFriendUrl}">公式LINEでお知らせを受け取る</a>` : ''}
        </div>` : ''}

      ${[...groups.values()].map((list) => {
        const w = list[0];
        return h`
          <div class="card">
            <h1>${w.title}</h1>
            ${w.description ? h`<p>${nl2br(w.description)}</p>` : ''}
            <dl class="dl">
              <dt>所要時間</dt><dd>約${formatDuration(w.duration_sec)}</dd>
              ${w.presenter ? h`<dt>登壇</dt><dd>${w.presenter}</dd>` : ''}
              <dt>参加方法</dt><dd>オンライン（アプリ不要）</dd>
            </dl>
            <div class="alert alert-info" style="margin-top:16px">
              <b>Zoomのインストールは不要です。</b><br>
              ご予約後、開始3時間前に公式LINEへ視聴リンクをお送りします。
              リンクを開くだけで、時間になると自動で始まります。
            </div>
          </div>

          <h2>開催日程を選ぶ</h2>
          <ul class="slot-list">
            ${list.map((s) => h`
              <li class="slot">
                <div class="slot-when">
                  <div class="slot-date">${formatJst(s.start_at)} ${slotBadge(s, now)}</div>
                  <div class="slot-meta">
                    ${formatRelative(s.start_at - now)}・約${formatDuration(s.duration_sec)}
                    ${seatsText(s) ? h` ・${seatsText(s)}` : ''}
                  </div>
                </div>
                <div class="slot-cta">
                  <a class="btn btn-primary btn-sm" href="/reserve?session=${s.id}">予約する</a>
                </div>
              </li>`)}
          </ul>`;
      })}
    </div></main>`;

  return page({ title: 'オンライン説明会 | 開催日程', body });
}

// ---- 予約フォーム ----------------------------------------------------------

export function reservePage(session, { error = '', values = {}, now } = {}) {
  const st = playbackState({
    startAt: session.start_at, durationSec: session.duration_sec,
    lateJoinSec: session.late_join_sec, archiveHours: session.archive_hours,
    lobbyOpenMin: session.lobby_open_min, status: session.status,
  }, now);
  const live = st.state === PlaybackState.LIVE;

  const body = h`
    <main><div class="wrap">
      <div class="card">
        <h1>${live ? 'いますぐ参加する' : 'この日時で予約する'}</h1>
        <dl class="dl">
          <dt>説明会</dt><dd>${session.title}</dd>
          <dt>開催日時</dt><dd>${formatJst(session.start_at)}${live ? '（配信中）' : ''}</dd>
          <dt>所要時間</dt><dd>約${formatDuration(session.duration_sec)}</dd>
        </dl>
      </div>

      ${error ? h`<div class="alert alert-error">${error}</div>` : ''}

      <form class="card" method="post" action="/reserve" novalidate>
        <input type="hidden" name="session_id" value="${session.id}">
        <div class="field">
          <label for="name">お名前<span class="req">必須</span></label>
          <input type="text" id="name" name="name" required maxlength="80" autocomplete="name"
                 value="${values.name || ''}" placeholder="山田 太郎">
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="email">メールアドレス<span class="opt">任意</span></label>
            <input type="email" id="email" name="email" maxlength="200" autocomplete="email"
                   value="${values.email || ''}" placeholder="you@example.com">
          </div>
          <div class="field">
            <label for="phone">電話番号<span class="opt">任意</span></label>
            <input type="tel" id="phone" name="phone" maxlength="32" autocomplete="tel"
                   value="${values.phone || ''}" placeholder="09012345678">
          </div>
        </div>
        <div class="field">
          <label for="note">ご質問・ご相談<span class="opt">任意</span></label>
          <textarea id="note" name="note" maxlength="1000"
                    placeholder="当日聞きたいことがあればご記入ください">${values.note || ''}</textarea>
        </div>
        <div class="field">
          <label class="check">
            <input type="checkbox" name="agree" value="1" required ${values.agree ? 'checked' : ''}>
            <span>
              予約確認と視聴リンクを<b>公式LINE</b>で受け取ることに同意します。
              入力情報は本説明会のご案内にのみ使用します。
            </span>
          </label>
        </div>
        <button class="btn btn-primary btn-block" type="submit">
          ${live ? '参加して視聴ページへ' : '予約を確定する'}
        </button>
        <p class="hint" style="text-align:center;margin:12px 0 0">
          次の画面で、公式LINEとの連携（1タップ）にお進みください。
        </p>
      </form>

      <p style="text-align:center"><a class="muted" href="/">← 他の日程を見る</a></p>
    </div></main>`;

  return page({ title: `予約 | ${session.title}`, body, noindex: true });
}

// ---- 予約完了（LINE連携の導線） --------------------------------------------

export function thanksPage(reservation, now) {
  const oaUrl = lineOaMessageUrl(reservation.link_code);
  const addUrl = config.line.addFriendUrl;
  const manageUrl = `${config.baseUrl}/r/${reservation.watch_token}`;
  const linked = Boolean(reservation.line_user_id);
  const soon = reservation.start_at - now < 3 * 60 * 60 * 1000;

  const st = playbackState({
    startAt: reservation.start_at, durationSec: reservation.duration_sec,
    lateJoinSec: reservation.late_join_sec, archiveHours: reservation.archive_hours,
    lobbyOpenMin: reservation.lobby_open_min, status: reservation.session_status,
  }, now);

  const body = h`
    <main><div class="wrap">
      ${st.canWatch ? h`
        <div class="card">
          <h1>ただいま配信中です</h1>
          <p class="muted">下のボタンからそのままご視聴いただけます。</p>
          <a class="btn btn-primary btn-block" href="/watch/${reservation.watch_token}">視聴ページを開く</a>
        </div>` : ''}

      <div class="card">
        <h1>${st.canWatch ? 'ご予約内容' : linked ? 'ご予約が完了しました' : 'あと1ステップで完了です'}</h1>
        <dl class="dl">
          <dt>説明会</dt><dd>${reservation.title}</dd>
          <dt>開催日時</dt><dd>${formatJst(reservation.start_at)}</dd>
          <dt>お名前</dt><dd>${reservation.name} 様</dd>
        </dl>
      </div>

      ${linked ? h`
        <div class="alert alert-ok">
          公式LINEとの連携が完了しています。${soon
            ? '視聴リンクはこのあとすぐLINEにお送りします。'
            : '開催当日の3時間前に、視聴リンクをLINEへお送りします。'}
        </div>`
      : h`
        <div class="card">
          <h2>公式LINEと連携して視聴リンクを受け取る</h2>
          <p class="muted" style="font-size:.9rem">
            視聴リンクは公式LINEにお送りします。下のボタンを押すと、
            友だち追加とコード送信がまとめて完了します。
          </p>

          <div class="code-box">
            <small>あなたの予約コード</small>
            <div class="code">${reservation.link_code}</div>
            <small>このコードを公式LINEに送信してください</small>
          </div>

          ${oaUrl ? h`
            <a class="btn btn-line btn-block" href="${oaUrl}">
              LINEを開いて連携する（1タップ）
            </a>
            <p class="hint" style="text-align:center;margin-top:10px">
              LINEが開いたら、入力済みのメッセージをそのまま送信してください。
            </p>`
          : addUrl ? h`
            <ol class="steps" style="margin-top:18px">
              <li><a class="btn btn-line btn-sm" href="${addUrl}">公式LINEを友だち追加</a></li>
              <li>トークに <b class="mono">${reservation.link_code}</b> と送信</li>
              <li>「連携が完了しました」と返信が届けば完了です</li>
            </ol>`
          : h`<div class="alert alert-warn">
              公式LINEの設定が未完了です（LINE_BASIC_ID 未設定）。管理者にご連絡ください。
            </div>`}
        </div>`}

      <div class="card card-tight">
        <h3>LINEを使っていない方へ</h3>
        <p class="muted" style="font-size:.88rem;margin-bottom:10px">
          下のページをブックマークしておけば、LINEなしでも当日ご視聴いただけます。
        </p>
        <p style="margin:0"><a class="mono" href="${manageUrl}">${manageUrl}</a></p>
        <p style="margin:12px 0 0">
          <a class="btn btn-ghost btn-sm" href="${googleCalendarUrl({
            title: reservation.title,
            startMs: reservation.start_at,
            endMs: reservation.start_at + reservation.duration_sec * 1000,
            details: `視聴ページ: ${config.baseUrl}/watch/${reservation.watch_token}`,
          })}">カレンダーに追加</a>
          <a class="btn btn-ghost btn-sm" href="${manageUrl}">予約内容を確認</a>
        </p>
      </div>
    </div></main>`;

  return page({ title: '予約完了 | オンライン説明会', body, noindex: true });
}

// ---- 予約内容の確認・キャンセル ---------------------------------------------

export function managePage(reservation, now, { notice = '' } = {}) {
  const canceled = reservation.status === 'canceled';
  const st = playbackState({
    startAt: reservation.start_at, durationSec: reservation.duration_sec,
    lateJoinSec: reservation.late_join_sec, archiveHours: reservation.archive_hours,
    lobbyOpenMin: reservation.lobby_open_min, status: reservation.session_status,
  }, now);
  const watchable = st.canWatch;
  const oaUrl = lineOaMessageUrl(reservation.link_code);

  const body = h`
    <main><div class="wrap">
      ${notice ? h`<div class="alert alert-ok">${notice}</div>` : ''}

      <div class="card">
        <h1>ご予約内容</h1>
        ${canceled ? h`<div class="alert alert-warn">このご予約はキャンセル済みです。</div>` : ''}
        <dl class="dl">
          <dt>説明会</dt><dd>${reservation.title}</dd>
          <dt>開催日時</dt><dd>${formatJst(reservation.start_at)}</dd>
          <dt>所要時間</dt><dd>約${formatDuration(reservation.duration_sec)}</dd>
          <dt>お名前</dt><dd>${reservation.name} 様</dd>
          <dt>LINE連携</dt><dd>${reservation.line_user_id ? '連携済み' : '未連携'}</dd>
        </dl>
      </div>

      ${canceled ? '' : watchable ? h`
        <div class="card">
          <h2>配信中です</h2>
          <a class="btn btn-primary btn-block" href="/watch/${reservation.watch_token}">視聴ページを開く</a>
        </div>`
      : st.state === PlaybackState.ENDED ? h`
        <div class="card"><p class="muted">この回は終了しました。</p></div>`
      : h`
        <div class="card">
          <h2>当日の視聴について</h2>
          <p>開始3時間前に、視聴リンクを公式LINEへお送りします。開始時刻になると自動で始まります。</p>
          <p class="muted" style="font-size:.88rem">開始まで ${formatRelative(reservation.start_at - now)}</p>
          <a class="btn btn-ghost btn-block" href="/watch/${reservation.watch_token}">視聴ページを開いて待つ</a>
        </div>

        ${reservation.line_user_id ? '' : oaUrl ? h`
          <div class="card">
            <h3>公式LINEと連携する</h3>
            <p class="muted" style="font-size:.88rem">
              連携すると、開始3時間前と10分前にリマインドが届きます。
            </p>
            <a class="btn btn-line btn-block" href="${oaUrl}">LINEを開いて連携する</a>
          </div>` : ''}

        <form class="card card-tight" method="post" action="/r/${reservation.watch_token}/cancel"
              onsubmit="return confirm('この予約をキャンセルします。よろしいですか？')">
          <button class="btn btn-danger btn-sm" type="submit">予約をキャンセルする</button>
        </form>`}
    </div></main>`;

  return page({ title: '予約内容 | オンライン説明会', body, noindex: true });
}
