import { page } from './layout.js';
import { h, raw } from '../lib/html.js';
import { formatJstShort, formatDuration, toDatetimeLocal, formatRelative } from '../lib/time.js';
import { JOB_KINDS } from '../domain/notifications.js';
import { playbackState, STATE_LABEL } from '../domain/playback.js';
import { seatsLeft } from '../domain/sessions.js';

const TABS = [
  ['/admin', 'ダッシュボード'],
  ['/admin/sessions', '開催枠'],
  ['/admin/webinars', 'コンテンツ'],
  ['/admin/reservations', '予約'],
  ['/admin/jobs', '通知'],
];

function shell(active, title, body) {
  const header = h`
    <header class="site-head admin-head">
      <div class="wrap-wide">
        <a class="brand" href="/admin">説明会 管理画面<span>アンタイ</span></a>
        <nav>
          <a href="/" target="_blank" rel="noopener">予約サイト ↗</a>
          <form class="inline-form" method="post" action="/admin/logout">
            <button class="btn btn-ghost btn-sm" style="padding:4px 12px" type="submit">ログアウト</button>
          </form>
        </nav>
      </div>
    </header>`;

  return page({
    title: `${title} | 説明会 管理画面`,
    noindex: true,
    header,
    footer: false,
    brandHref: '/admin',
    body: h`
      <main><div class="wrap-wide">
        <div class="tabs">
          ${TABS.map(([href, label]) => h`<a class="${href === active ? 'on' : ''}" href="${href}">${label}</a>`)}
        </div>
        ${raw(String(body))}
      </div></main>`,
  });
}

export function loginPage(error = '') {
  return page({
    title: 'ログイン | 説明会 管理画面',
    noindex: true,
    header: '',
    footer: false,
    body: h`
      <div class="login-wrap">
        <form class="card" method="post" action="/admin/login">
          <h1 style="font-size:1.2rem">管理画面ログイン</h1>
          ${error ? h`<div class="alert alert-error">${error}</div>` : ''}
          <div class="field">
            <label for="user">ユーザー名</label>
            <input type="text" id="user" name="user" autocomplete="username" required>
          </div>
          <div class="field">
            <label for="pass">パスワード</label>
            <input type="password" id="pass" name="pass" autocomplete="current-password" required>
          </div>
          <button class="btn btn-primary btn-block" type="submit">ログイン</button>
        </form>
      </div>`,
  });
}

const pill = (status) => h`<span class="pill pill-${status}">${{
  sent: '送信済', pending: '送信待ち', failed: '失敗', skipped: '見送り', canceled: '取消',
}[status] || status}</span>`;

// ---- ダッシュボード --------------------------------------------------------

export function dashboardPage({ stats, upcoming, recentJobs, warnings, now }) {
  return shell('/admin', 'ダッシュボード', h`
    ${warnings.length ? h`
      <div class="alert alert-warn">
        <b>設定の確認</b>
        <ul style="margin:8px 0 0;padding-left:20px">${warnings.map((w) => h`<li>${w}</li>`)}</ul>
      </div>` : ''}

    <div class="stat-grid">
      <div class="stat"><div class="n">${stats.upcomingSessions}</div><div class="k">今後の開催枠</div></div>
      <div class="stat"><div class="n">${stats.activeReservations}</div><div class="k">有効な予約</div></div>
      <div class="stat"><div class="n">${stats.linkedRate}%</div><div class="k">LINE連携率</div></div>
      <div class="stat"><div class="n">${stats.pendingJobs}</div><div class="k">送信待ちの通知</div></div>
      <div class="stat"><div class="n">${stats.failedJobs}</div><div class="k">送信失敗</div></div>
    </div>

    <div class="card">
      <h2>直近の開催枠</h2>
      ${upcoming.length === 0 ? h`<p class="muted">予定されている開催枠がありません。「開催枠」タブから追加してください。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>開催日時</th><th>コンテンツ</th><th>状態</th><th class="num">予約</th><th></th></tr></thead>
          <tbody>${upcoming.map((s) => {
            const st = playbackState({ startAt: s.start_at, durationSec: s.duration_sec, lateJoinSec: s.late_join_sec, archiveHours: s.archive_hours, status: s.status }, now);
            return h`<tr>
              <td class="nowrap"><b>${formatJstShort(s.start_at)}</b><br><small class="muted">${formatRelative(s.start_at - now)}</small></td>
              <td>${s.title}</td>
              <td class="nowrap">${STATE_LABEL[st.state]}${s.status !== 'open' ? h` <span class="muted">(${s.status})</span>` : ''}</td>
              <td class="num">${s.reserved}${s.capacity > 0 ? ` / ${s.capacity}` : ''}</td>
              <td class="nowrap"><a class="btn btn-ghost btn-sm" href="/admin/reservations?session=${s.id}">予約を見る</a></td>
            </tr>`;
          })}</tbody>
        </table></div>`}
    </div>

    <div class="card">
      <h2>直近の通知</h2>
      ${recentJobs.length === 0 ? h`<p class="muted">まだ通知はありません。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>種類</th><th>宛先</th><th>予定時刻</th><th>状態</th></tr></thead>
          <tbody>${recentJobs.map((j) => h`<tr>
            <td class="nowrap">${JOB_KINDS[j.kind]?.label || j.kind}</td>
            <td>${j.name}</td>
            <td class="nowrap">${formatJstShort(j.scheduled_at)}</td>
            <td>${pill(j.status)}${j.last_error ? h`<br><small class="muted">${j.last_error}</small>` : ''}</td>
          </tr>`)}</tbody>
        </table></div>`}
    </div>`);
}

// ---- 開催枠 ----------------------------------------------------------------

export function sessionsPage({ sessions, webinars, rules, now, notice }) {
  const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
  return shell('/admin/sessions', '開催枠', h`
    ${notice ? h`<div class="alert alert-ok">${notice}</div>` : ''}
    ${webinars.length === 0 ? h`
      <div class="alert alert-warn">先に「コンテンツ」タブで配信する説明会を登録してください。</div>` : h`

    <div class="card">
      <h2>開催枠を追加</h2>
      <form method="post" action="/admin/sessions">
        <div class="grid-2">
          <div class="field">
            <label for="webinar_id">コンテンツ</label>
            <select id="webinar_id" name="webinar_id" required>
              ${webinars.map((w) => h`<option value="${w.id}">${w.title}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="start_at">開催日時（日本時間）</label>
            <input type="datetime-local" id="start_at" name="start_at" required
                   value="${toDatetimeLocal(now + 24 * 3600 * 1000)}">
          </div>
        </div>
        <div class="field" style="max-width:220px">
          <label for="capacity">定員<span class="opt">0で無制限</span></label>
          <input type="number" id="capacity" name="capacity" min="0" value="0">
        </div>
        <button class="btn btn-primary" type="submit">開催枠を追加</button>
      </form>
    </div>

    <div class="card">
      <h2>定期開催ルール</h2>
      <p class="muted" style="font-size:.87rem">
        曜日と時刻を決めておくと、先の日程の開催枠が自動で作られ続けます（エバーグリーン運用）。
      </p>
      ${rules.length > 0 ? h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>コンテンツ</th><th>曜日</th><th>時刻</th><th class="num">定員</th><th class="num">何日先まで</th><th></th></tr></thead>
          <tbody>${rules.map((r) => h`<tr>
            <td>${r.title}</td>
            <td>${String(r.weekdays).split(',').map((d) => weekdayNames[Number(d)] || d).join('・')}</td>
            <td>${r.time_jst}</td>
            <td class="num">${r.capacity || '無制限'}</td>
            <td class="num">${r.horizon_days}日</td>
            <td class="nowrap">
              <form class="inline-form" method="post" action="/admin/rules/${r.id}/delete"
                    onsubmit="return confirm('このルールを削除しますか？（作成済みの枠は残ります）')">
                <button class="btn btn-danger btn-sm" type="submit">削除</button>
              </form>
            </td>
          </tr>`)}</tbody>
        </table></div>` : ''}

      <form method="post" action="/admin/rules" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">
        <div class="grid-2">
          <div class="field">
            <label for="rule_webinar">コンテンツ</label>
            <select id="rule_webinar" name="webinar_id" required>
              ${webinars.map((w) => h`<option value="${w.id}">${w.title}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="time_jst">開始時刻（日本時間）</label>
            <input type="text" id="time_jst" name="time_jst" placeholder="20:00" pattern="[0-9]{1,2}:[0-9]{2}" required>
          </div>
        </div>
        <div class="field">
          <label>開催する曜日</label>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            ${weekdayNames.map((n, i) => h`
              <label class="check" style="width:auto">
                <input type="checkbox" name="weekdays" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}>
                <span>${n}</span>
              </label>`)}
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="rule_capacity">定員<span class="opt">0で無制限</span></label>
            <input type="number" id="rule_capacity" name="capacity" min="0" value="0">
          </div>
          <div class="field">
            <label for="horizon_days">何日先まで枠を作るか</label>
            <input type="number" id="horizon_days" name="horizon_days" min="1" max="90" value="14">
          </div>
        </div>
        <button class="btn btn-primary" type="submit">ルールを追加</button>
      </form>
    </div>`}

    <div class="card">
      <h2>開催枠の一覧</h2>
      ${sessions.length === 0 ? h`<p class="muted">まだ開催枠がありません。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>開催日時</th><th>コンテンツ</th><th>状態</th><th class="num">予約</th><th>視聴ページ</th><th></th></tr></thead>
          <tbody>${sessions.map((s) => {
            const st = playbackState({ startAt: s.start_at, durationSec: s.duration_sec, lateJoinSec: s.late_join_sec, archiveHours: s.archive_hours, status: s.status }, now);
            const left = seatsLeft(s);
            return h`<tr>
              <td class="nowrap"><b>${formatJstShort(s.start_at)}</b><br><small class="muted">${formatRelative(s.start_at - now)}</small></td>
              <td>${s.title}<br><small class="muted">約${formatDuration(s.duration_sec)}</small></td>
              <td class="nowrap">${STATE_LABEL[st.state]}${s.status === 'canceled' ? h` <span class="pill pill-canceled">中止</span>` : s.status === 'closed' ? h` <span class="pill pill-skipped">受付停止</span>` : ''}</td>
              <td class="num">${s.reserved}${left !== null ? h`<br><small class="muted">残${left}</small>` : ''}</td>
              <td><a href="/reserve?session=${s.id}" target="_blank" rel="noopener">予約ページ ↗</a></td>
              <td class="nowrap">
                <form class="inline-form" method="post" action="/admin/sessions/${s.id}/status">
                  <input type="hidden" name="status" value="${s.status === 'open' ? 'closed' : 'open'}">
                  <button class="btn btn-ghost btn-sm" type="submit">${s.status === 'open' ? '受付停止' : '受付再開'}</button>
                </form>
                <form class="inline-form" method="post" action="/admin/sessions/${s.id}/status"
                      onsubmit="return confirm('この回を中止します。予約者への通知は停止されます。')">
                  <input type="hidden" name="status" value="canceled">
                  <button class="btn btn-danger btn-sm" type="submit">中止</button>
                </form>
              </td>
            </tr>`;
          })}</tbody>
        </table></div>`}
    </div>`);
}

// ---- コンテンツ ------------------------------------------------------------

export function webinarsPage({ webinars, editing, chatText, pollsText, notice }) {
  const w = editing || {};
  return shell('/admin/webinars', 'コンテンツ', h`
    ${notice ? h`<div class="alert alert-ok">${notice}</div>` : ''}

    <div class="card">
      <h2>${editing ? 'コンテンツを編集' : 'コンテンツを追加'}</h2>
      <form method="post" action="/admin/webinars">
        ${editing ? h`<input type="hidden" name="id" value="${w.id}">` : ''}
        <div class="field">
          <label for="title">タイトル</label>
          <input type="text" id="title" name="title" required maxlength="120" value="${w.title || ''}"
                 placeholder="社会保険給付金サポート オンライン説明会">
        </div>
        <div class="field">
          <label for="description">説明文</label>
          <textarea id="description" name="description" maxlength="2000">${w.description || ''}</textarea>
        </div>
        <div class="field">
          <label for="video_url">動画</label>
          <input type="text" id="video_url" name="video_url" required value="${w.video_url || ''}"
                 placeholder="youtube:VIDEO_ID / file:seminar.mp4 / https://cdn.example.com/seminar.mp4">
          <p class="hint">
            <b>youtube:動画ID</b> … YouTubeの限定公開動画を使う（動画の置き場所が不要でいちばん手軽）<br>
            <b>file:ファイル名</b> … <span class="mono">media/</span> に置いたMP4を自前配信する<br>
            <b>https://…</b> … CDNやS3のURL（配信時間中だけリダイレクトされます）
          </p>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="duration_min">本編の長さ（分）</label>
            <input type="number" id="duration_min" name="duration_min" min="1" max="600" required
                   value="${Math.round((w.duration_sec || 3600) / 60)}">
            <p class="hint">動画の実尺と揃えてください。この長さを過ぎると「終了」表示になります。</p>
          </div>
          <div class="field">
            <label for="presenter">登壇者<span class="opt">任意</span></label>
            <input type="text" id="presenter" name="presenter" maxlength="80" value="${w.presenter || ''}">
          </div>
        </div>

        <h3 style="margin-top:22px">申し込みボタン（CTA）</h3>
        <div class="grid-2">
          <div class="field">
            <label for="cta_label">ボタンの文言<span class="opt">任意</span></label>
            <input type="text" id="cta_label" name="cta_label" maxlength="40" value="${w.cta_label || ''}"
                   placeholder="無料相談を申し込む">
          </div>
          <div class="field">
            <label for="cta_url">リンク先URL</label>
            <input type="text" id="cta_url" name="cta_url" maxlength="500" value="${w.cta_url || ''}"
                   placeholder="https://lin.ee/xxxxxxx">
          </div>
        </div>
        <div class="field" style="max-width:280px">
          <label for="cta_at_min">ボタンを出すタイミング（開始からの分）</label>
          <input type="number" id="cta_at_min" name="cta_at_min" min="0" max="600"
                 value="${Math.round((w.cta_at_sec || 0) / 60)}">
        </div>

        <h3 style="margin-top:22px">視聴の設定</h3>
        <div class="grid-2">
          <div class="field">
            <label for="late_join_min">途中入場を許す時間（分）<span class="opt">0で制限なし</span></label>
            <input type="number" id="late_join_min" name="late_join_min" min="0" max="600"
                   value="${Math.round((w.late_join_sec || 0) / 60)}">
            <p class="hint">0 なら配信中いつでも入場できます。数字を入れると「遅刻すると入れない」運用になります。</p>
          </div>
          <div class="field">
            <label for="archive_hours">見逃し配信（時間）<span class="opt">0でなし</span></label>
            <input type="number" id="archive_hours" name="archive_hours" min="0" max="720"
                   value="${w.archive_hours || 0}">
            <p class="hint">終了後、この時間だけ最初から視聴できるようにします（早送り可）。</p>
          </div>
        </div>

        <h3 style="margin-top:22px">会場（ライブ感）の設定</h3>
        <div class="alert alert-info">
          参加者数と入室通知は、<b>同じ回に実際に参加している方のもの</b>です。
          開催枠を時刻で区切っているので、作り物を出さなくても人が集まります。<br>
          この画面では<b>参加者からの書き込みは受け付けません</b>。質問は公式LINEで受けます。
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="lobby_open_min">何分前に開場するか</label>
            <input type="number" id="lobby_open_min" name="lobby_open_min" min="0" max="120"
                   value="${w.lobby_open_min ?? 15}">
            <p class="hint">開場すると、参加者は会場に入って挨拶しながら開始を待てます。</p>
          </div>
          <div class="field">
            <label for="min_viewers_shown">参加者数を出しはじめる人数</label>
            <input type="number" id="min_viewers_shown" name="min_viewers_shown" min="1" max="1000"
                   value="${w.min_viewers_shown ?? 3}">
            <p class="hint">1〜2名のときに人数を出すと逆に寂しいので、この人数から表示します。</p>
          </div>
        </div>
        <div class="field">
          <label class="check">
            <input type="checkbox" name="show_viewer_count" value="1" ${w.show_viewer_count ?? 1 ? 'checked' : ''}>
            <span>参加者数を表示する（実際に会場にいる人数）</span>
          </label>
        </div>
        <div class="field">
          <label class="check">
            <input type="checkbox" name="show_chat" value="1" ${w.show_chat ?? 1 ? 'checked' : ''}>
            <span>司会の進行アナウンスを表示する（下の台本を時刻どおりに流します）</span>
          </label>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="welcome_message">入室時のひとこと<span class="opt">任意</span></label>
            <input type="text" id="welcome_message" name="welcome_message" maxlength="120"
                   value="${w.welcome_message || ''}" placeholder="ご参加ありがとうございます。">
            <p class="hint">空欄なら「◯◯さん、ご参加ありがとうございます。」と表示します。</p>
          </div>
          <div class="field">
            <label for="closing_message">終了時のひとこと<span class="opt">任意</span></label>
            <input type="text" id="closing_message" name="closing_message" maxlength="200"
                   value="${w.closing_message || ''}" placeholder="本日はありがとうございました。ご質問は公式LINEへ。">
          </div>
        </div>

        <h3 style="margin-top:22px">司会の進行台本</h3>
        <div class="field">
          <label for="chat_script">開場中と配信中に流すアナウンス</label>
          <textarea id="chat_script" name="chat_script" style="min-height:150px"
                    placeholder="-10:00 事務局 まもなく開場します。音声が出るかご確認ください&#10;-01:00 事務局 まもなく開始します&#10;00:30 事務局 本日はお集まりいただきありがとうございます">${chatText || ''}</textarea>
          <p class="hint">
            1行につき「時刻 名前 本文」。時刻は開始からの経過で、<b>頭に「-」を付けると開始前</b>（開場中）に流れます。<br>
            例: <span class="mono">-05:00 事務局 まもなく開始します</span> ／ <span class="mono">30:00 事務局 資料は公式LINEでお送りします</span><br>
            これは<b>主催者自身のアナウンス</b>です。行頭に <span class="mono">~</span> を付けると参加者として表示されますが、
            実在しない参加者の発言はステルスマーケティング規制に触れうるため推奨しません。
          </p>
        </div>

        <h3 style="margin-top:22px">アンケート（配信中に出す投票）</h3>
        <div class="field">
          <label for="polls_text">投票</label>
          <textarea id="polls_text" name="polls_text" style="min-height:90px"
                    placeholder="10:00 | いまのご状況は？ | 退職済み | 退職予定 | 検討中">${pollsText || ''}</textarea>
          <p class="hint">
            1行につき「時刻 | 質問 | 選択肢1 | 選択肢2 …」。集計結果はその回の実際の回答です。<br>
            締め切りを設ける場合は <span class="mono">10:00..15:00 | …</span> のように書きます。
          </p>
        </div>

        <button class="btn btn-primary" type="submit">${editing ? '保存する' : '追加する'}</button>
        ${editing ? h`<a class="btn btn-ghost" href="/admin/webinars">新規追加に戻る</a>` : ''}
      </form>
    </div>

    <div class="card">
      <h2>登録済みのコンテンツ</h2>
      ${webinars.length === 0 ? h`<p class="muted">まだありません。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>タイトル</th><th>動画</th><th class="num">長さ</th><th>会場</th><th></th></tr></thead>
          <tbody>${webinars.map((x) => h`<tr>
            <td>${x.title}</td>
            <td class="mono">${x.video_url}</td>
            <td class="num nowrap">${formatDuration(x.duration_sec)}</td>
            <td class="nowrap">
              <span class="pill pill-pending">${x.lobby_open_min}分前開場</span>
              ${x.show_chat ? h` <span class="pill pill-sent">進行あり</span>` : ''}
            </td>
            <td class="nowrap"><a class="btn btn-ghost btn-sm" href="/admin/webinars?edit=${x.id}">編集</a></td>
          </tr>`)}</tbody>
        </table></div>`}
    </div>`);
}

// ---- 予約 ------------------------------------------------------------------

export function reservationsPage({ reservations, sessions, sessionId, now }) {
  return shell('/admin/reservations', '予約', h`
    <div class="card card-tight">
      <form method="get" action="/admin/reservations" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="margin:0;min-width:260px;flex:1">
          <label for="session">開催枠でしぼり込む</label>
          <select id="session" name="session" onchange="this.form.submit()">
            <option value="">すべて</option>
            ${sessions.map((s) => h`
              <option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>
                ${formatJstShort(s.start_at)}　${s.title}（${s.reserved}件）
              </option>`)}
          </select>
        </div>
        <a class="btn btn-ghost" href="/admin/reservations.csv${sessionId ? `?session=${sessionId}` : ''}">CSVで書き出す</a>
      </form>
    </div>

    <div class="card">
      <h2>予約一覧（${reservations.length}件）</h2>
      ${reservations.length === 0 ? h`<p class="muted">該当する予約がありません。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr>
            <th>開催日時</th><th>お名前</th><th>連絡先</th><th>LINE</th>
            <th>視聴</th><th>状態</th><th>コード</th>
          </tr></thead>
          <tbody>${reservations.map((r) => h`<tr>
            <td class="nowrap">${formatJstShort(r.start_at)}</td>
            <td>${r.name}${r.note ? h`<br><small class="muted">${r.note}</small>` : ''}</td>
            <td><small>${r.email}${r.email && r.phone ? h`<br>` : ''}${r.phone}</small></td>
            <td class="nowrap">${r.line_user_id
              ? h`<span class="pill pill-sent">連携済</span>${r.line_display_name ? h`<br><small class="muted">${r.line_display_name}</small>` : ''}`
              : h`<span class="pill pill-skipped">未連携</span>`}</td>
            <td class="nowrap">${r.watched_sec ? h`${Math.round(r.watched_sec / 60)}分${r.cta_clicks ? h`<br><small class="muted">CTA ${r.cta_clicks}回</small>` : ''}`
              : h`<span class="muted">—</span>`}</td>
            <td class="nowrap">${r.status === 'active' ? h`<span class="pill pill-sent">有効</span>` : h`<span class="pill pill-canceled">取消</span>`}</td>
            <td class="mono nowrap">${r.link_code}</td>
          </tr>`)}</tbody>
        </table></div>`}
    </div>`);
}

// ---- 通知 ------------------------------------------------------------------

export function jobsPage({ jobs, counts, now, notice }) {
  return shell('/admin/jobs', '通知', h`
    ${notice ? h`<div class="alert alert-ok">${notice}</div>` : ''}
    <div class="stat-grid">
      ${['pending', 'sent', 'failed', 'skipped'].map((s) => h`
        <div class="stat"><div class="n">${counts[s] || 0}</div><div class="k">${
          { pending: '送信待ち', sent: '送信済', failed: '失敗', skipped: '見送り' }[s]}</div></div>`)}
    </div>

    <div class="card">
      <h2>通知の一覧</h2>
      <p class="muted" style="font-size:.87rem">
        「視聴リンク（3時間前）」が、この仕組みの中心です。送信待ちのまま時刻を過ぎている場合は、
        LINE連携が済んでいるか（予約タブ）をご確認ください。
      </p>
      ${jobs.length === 0 ? h`<p class="muted">まだ通知はありません。</p>` : h`
        <div class="table-wrap"><table class="tbl">
          <thead><tr><th>種類</th><th>宛先</th><th>開催日時</th><th>送信予定</th><th>状態</th><th></th></tr></thead>
          <tbody>${jobs.map((j) => h`<tr>
            <td class="nowrap">${JOB_KINDS[j.kind]?.label || j.kind}</td>
            <td>${j.name}</td>
            <td class="nowrap">${formatJstShort(j.start_at)}</td>
            <td class="nowrap">${formatJstShort(j.scheduled_at)}
              ${j.status === 'pending' ? h`<br><small class="muted">${formatRelative(j.scheduled_at - now)}</small>` : ''}</td>
            <td>${pill(j.status)}
              ${j.attempts > 0 ? h`<br><small class="muted">${j.attempts}回試行</small>` : ''}
              ${j.last_error ? h`<br><small class="muted">${j.last_error}</small>` : ''}</td>
            <td class="nowrap">
              ${['failed', 'skipped', 'sent'].includes(j.status) ? h`
                <form class="inline-form" method="post" action="/admin/jobs/${j.id}/requeue">
                  <button class="btn btn-ghost btn-sm" type="submit">再送する</button>
                </form>` : ''}
            </td>
          </tr>`)}</tbody>
        </table></div>`}
    </div>`);
}

