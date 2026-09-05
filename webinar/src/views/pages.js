import { page, errorPage } from './layout.js';
import { h, nl2br } from '../lib/html.js';
import { config } from '../config.js';
import { formatJst, formatDuration, formatRelative, isSameJstDay, googleCalendarUrl } from '../lib/time.js';
import { seatsLeft } from '../domain/sessions.js';
import { landing } from '../content/landing.js';
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

// ---- トップページ（LP＋日程選択） --------------------------------------------

/** 日程のカード1件 */
function slotItem(s, now) {
  return h`
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
    </li>`;
}

export function indexPage(sessions, now) {
  const next = sessions[0] || null;
  const webinar = next;   // 説明会の基本情報は開催枠から引く（管理画面で編集できる）
  const c = landing;

  // 一度に全部並べると選びにくいので、直近だけ出して残りは折りたたむ
  const VISIBLE = 6;
  const head = sessions.slice(0, VISIBLE);
  const rest = sessions.slice(VISIBLE);

  const slots = h`
    <section class="lp-section" id="dates">
      <h2 class="lp-h2">開催日程を選ぶ</h2>
      ${sessions.length === 0 ? h`
        <div class="card" style="max-width:34em;margin:26px auto 0">
          <p>現在ご予約いただける日程がありません。</p>
          <p class="muted">次回の開催が決まりましたら、公式LINEでお知らせします。</p>
          ${config.line.addFriendUrl ? h`
            <a class="btn btn-line btn-block" href="${config.line.addFriendUrl}">公式LINEでお知らせを受け取る</a>` : ''}
        </div>`
      : h`
        <ul class="slot-list lp-slots">${head.map((s) => slotItem(s, now))}</ul>
        ${rest.length ? h`
          <details class="lp-more">
            <summary>ほかの日程を見る（あと${rest.length}件）</summary>
            <ul class="slot-list lp-slots">${rest.map((s) => slotItem(s, now))}</ul>
          </details>` : ''}
        <p class="muted lp-fineprint">
          ご予約後、開始3時間前に公式LINEへ視聴リンクをお送りします。
        </p>`}
    </section>`;

  const body = h`
    <main>
      <!-- ヒーロー -->
      <section class="lp-hero">
        <div class="wrap">
          <p class="lp-eyebrow">${c.hero.eyebrow}</p>
          <h1 class="lp-title">${c.hero.title}</h1>
          <p class="lp-lead">${nl2br(c.hero.lead)}</p>
          <ul class="lp-points">${c.hero.points.map((p) => h`<li>${p}</li>`)}</ul>
          ${next ? h`
            <a class="btn btn-primary lp-cta" href="#dates">日程を見て予約する</a>
            <p class="lp-next">次回 ${formatJst(next.start_at)}${
              webinar.duration_sec ? h`・約${formatDuration(webinar.duration_sec)}` : ''}</p>`
          : h`<a class="btn btn-primary lp-cta" href="#dates">開催日程を見る</a>`}
        </div>
      </section>

      <div class="wrap">
        <!-- こんな方に -->
        <section class="lp-section">
          <h2 class="lp-h2">${c.forWhom.title}</h2>
          <ul class="lp-check">${c.forWhom.items.map((t) => h`<li>${t}</li>`)}</ul>
        </section>

        <!-- 説明会でお伝えすること -->
        <section class="lp-section">
          <h2 class="lp-h2">${c.learn.title}</h2>
          <div class="lp-grid">
            ${c.learn.items.map((item, i) => h`
              <div class="lp-card">
                <span class="lp-num">${String(i + 1).padStart(2, '0')}</span>
                <h3>${item.title}</h3>
                <p>${item.body}</p>
              </div>`)}
          </div>
        </section>

        <!-- 参加方法 -->
        <section class="lp-section">
          <h2 class="lp-h2">${c.how.title}</h2>
          <p class="lp-sub">${c.how.lead}</p>
          <ol class="lp-steps">
            ${c.how.steps.map((step) => h`
              <li><b>${step.title}</b><span>${step.body}</span></li>`)}
          </ol>
        </section>

        <!-- 当日の流れ -->
        <section class="lp-section">
          <h2 class="lp-h2">${c.timetable.title}</h2>
          <dl class="lp-timetable">
            ${c.timetable.items.map((t) => h`<dt>${t.at}</dt><dd>${t.body}</dd>`)}
          </dl>
          <p class="muted lp-fineprint">${c.timetable.note}</p>
        </section>

        ${slots}

        <!-- よくあるご質問 -->
        <section class="lp-section">
          <h2 class="lp-h2">${c.faq.title}</h2>
          <div class="lp-faq">
            ${c.faq.items.map((item) => h`
              <details>
                <summary>${item.q}</summary>
                <p>${item.a}</p>
              </details>`)}
          </div>
        </section>

        <!-- 注意書き -->
        <section class="lp-section">
          <div class="lp-notes">
            ${c.notes.map((n) => h`<p>${n}</p>`)}
          </div>
        </section>
      </div>
    </main>`;

  return page({ title: `${c.hero.title} | ${config.brand.name}`, body });
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
