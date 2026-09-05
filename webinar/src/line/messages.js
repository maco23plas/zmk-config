// LINEに送るメッセージの組み立て。
// Flex Message は見た目が良いぶん壊れやすいので、URLがhttpsでない場合など
// 送れない条件のときはテキストに自動で退避する。

import { config } from '../config.js';
import { formatJst, formatJstShort, formatJstTime, formatDuration, isSameJstDay, googleCalendarUrl } from '../lib/time.js';

// ANTAIサイトと合わせたブランドカラー
const COLOR = {
  green: '#10B981',
  greenDark: '#0B8F63',
  navy: '#0E2A40',
  ink: '#0E2233',
  muted: '#5C6B7A',
  amber: '#FF9A3C',
  line: '#E7EDF2',
  tint: '#E6F8F0',
  white: '#FFFFFF',
};

const isHttps = (url) => /^https:\/\//i.test(String(url || ''));

const text = (body) => ({ type: 'text', text: String(body).slice(0, 4900), wrap: true });

const sep = (margin = 'md') => ({ type: 'separator', margin, color: COLOR.line });

const label = (body, opts = {}) => ({
  type: 'text', text: String(body), size: opts.size || 'sm',
  color: opts.color || COLOR.muted, wrap: true, weight: opts.weight, align: opts.align,
  margin: opts.margin,
});

const row = (key, value) => ({
  type: 'box', layout: 'baseline', spacing: 'sm', margin: 'md',
  contents: [
    { type: 'text', text: key, size: 'sm', color: COLOR.muted, flex: 2 },
    { type: 'text', text: String(value), size: 'sm', color: COLOR.ink, flex: 5, wrap: true, weight: 'bold' },
  ],
});

const primaryButton = (labelText, url, color = COLOR.green) => ({
  type: 'button', style: 'primary', height: 'sm', color,
  action: { type: 'uri', label: labelText.slice(0, 20), uri: url },
});

const secondaryButton = (labelText, url) => ({
  type: 'button', style: 'link', height: 'sm',
  action: { type: 'uri', label: labelText.slice(0, 20), uri: url },
});

/**
 * Flexメッセージを組む。ボタンURLがhttpsでない（＝LINEが受け付けない）場合は
 * テキストメッセージに退避して、通知そのものは必ず届くようにする。
 */
function bubble({ altText, headerText, headerColor, title, rows, bodyNotes, buttons, fallbackText }) {
  const list = buttons || [];
  // 主要ボタン（視聴ページ等）が https でないと LINE が受け付けないため、
  // その場合は Flex をやめてURL入りのテキストにする。通知そのものは必ず届かせる。
  const primaryBroken = list.some((b) => b.primary !== false && !isHttps(b.url));
  if (primaryBroken) return text(fallbackText || altText);
  const usable = list.filter((b) => isHttps(b.url));

  const bodyContents = [
    { type: 'text', text: title, weight: 'bold', size: 'lg', color: COLOR.ink, wrap: true },
    ...(rows || []).map(([k, v]) => row(k, v)),
  ];
  if (bodyNotes?.length) {
    bodyContents.push(sep('lg'));
    for (const note of bodyNotes) bodyContents.push(label(note, { margin: 'md' }));
  }

  return {
    type: 'flex',
    altText: altText.slice(0, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '14px',
        backgroundColor: headerColor || COLOR.navy,
        contents: [{ type: 'text', text: headerText, color: COLOR.white, weight: 'bold', size: 'sm', wrap: true }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '18px', contents: bodyContents },
      footer: usable.length
        ? {
            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
            contents: usable.map((b) => (b.primary === false
              ? secondaryButton(b.label, b.url)
              : primaryButton(b.label, b.url, b.color))),
          }
        : undefined,
    },
  };
}

/** 通知の組み立てに必要な情報をまとめる */
export function buildContext(job) {
  const watchUrl = `${config.baseUrl}/watch/${job.watch_token}`;
  return {
    name: job.name,
    title: job.title,
    startAt: job.start_at,
    durationSec: job.duration_sec,
    watchUrl,
    manageUrl: `${config.baseUrl}/r/${job.watch_token}`,
    calendarUrl: googleCalendarUrl({
      title: job.title,
      startMs: job.start_at,
      endMs: job.start_at + job.duration_sec * 1000,
      details: `視聴ページ: ${watchUrl}`,
    }),
  };
}

const HOW_TO_WATCH = 'アプリのインストールやログインは不要です。リンクを開いたまま開始時刻になると、自動で映像が始まります。';

// ---- 各通知 ---------------------------------------------------------------

export function confirmMessage(ctx, now = Date.now()) {
  const soon = ctx.startAt - now < 3 * 60 * 60 * 1000;
  return bubble({
    altText: `【予約完了】${formatJstShort(ctx.startAt)} ${ctx.title}`,
    headerText: '✓ ご予約を受け付けました',
    headerColor: COLOR.green,
    title: ctx.title,
    rows: [
      ['開催日時', formatJst(ctx.startAt)],
      ['所要時間', `約${formatDuration(ctx.durationSec)}`],
      ['視聴方法', 'このトークに届くリンクから'],
    ],
    bodyNotes: [
      soon
        ? 'まもなく開始のため、視聴リンクをこのあとすぐお送りします。'
        : '開始3時間前に、視聴リンクをこのトークにお送りします。',
      HOW_TO_WATCH,
    ],
    buttons: [
      { label: '予約内容を確認', url: ctx.manageUrl },
      { label: 'カレンダーに追加', url: ctx.calendarUrl, primary: false },
    ],
    fallbackText: `ご予約を受け付けました。\n\n${ctx.title}\n${formatJst(ctx.startAt)}\n\n開始3時間前に視聴リンクをお送りします。`,
  });
}

export function remind1dMessage(ctx) {
  return bubble({
    altText: `【明日】${formatJstShort(ctx.startAt)} ${ctx.title}`,
    headerText: '明日開催です',
    headerColor: COLOR.navy,
    title: ctx.title,
    rows: [['開催日時', formatJst(ctx.startAt)], ['所要時間', `約${formatDuration(ctx.durationSec)}`]],
    bodyNotes: ['当日の開始3時間前に、視聴リンクをこのトークにお送りします。'],
    buttons: [{ label: '予約内容を確認', url: ctx.manageUrl }],
    fallbackText: `明日 ${formatJst(ctx.startAt)} は「${ctx.title}」です。当日3時間前に視聴リンクをお送りします。`,
  });
}

/** ★中核: 開催当日3時間前に送る視聴リンク */
export function watchLinkMessage(ctx, now = Date.now()) {
  const today = isSameJstDay(ctx.startAt, now);
  const when = today ? `本日 ${formatJstTime(ctx.startAt)}` : formatJst(ctx.startAt);
  return bubble({
    altText: `【${when}開始】視聴リンクをお送りします｜${ctx.title}`,
    headerText: `📺 ${when} 開始｜視聴リンク`,
    headerColor: COLOR.green,
    title: ctx.title,
    rows: [
      ['開催日時', formatJst(ctx.startAt)],
      ['所要時間', `約${formatDuration(ctx.durationSec)}`],
    ],
    bodyNotes: [
      '下のボタンから視聴ページを開いてお待ちください。開始時刻になると自動で始まります。',
      'Zoomなどのアプリは不要です。スマホでもPCでもそのまま見られます。',
      '※開始後の巻き戻しはできません。時間になりましたらご参加ください。',
    ],
    buttons: [
      { label: '視聴ページを開く', url: ctx.watchUrl },
      { label: 'カレンダーに追加', url: ctx.calendarUrl, primary: false },
    ],
    fallbackText: `【${when}開始】${ctx.title}\n\n視聴ページはこちら:\n${ctx.watchUrl}\n\n${HOW_TO_WATCH}`,
  });
}

export function remind10mMessage(ctx) {
  return bubble({
    altText: `まもなく開始（10分前）｜${ctx.title}`,
    headerText: '⏰ まもなく開始です（あと10分）',
    headerColor: COLOR.amber,
    title: ctx.title,
    rows: [['開始時刻', `${formatJstTime(ctx.startAt)}`]],
    bodyNotes: ['視聴ページを開いてお待ちください。時間になると自動で始まります。'],
    buttons: [{ label: '視聴ページを開く', url: ctx.watchUrl }],
    fallbackText: `まもなく開始です（あと10分）。\n${ctx.title}\n${ctx.watchUrl}`,
  });
}

export function startMessage(ctx) {
  return bubble({
    altText: `開始しました｜${ctx.title}`,
    headerText: '🔴 ただいま開始しました',
    headerColor: COLOR.green,
    title: ctx.title,
    rows: [['開始時刻', formatJstTime(ctx.startAt)]],
    bodyNotes: ['下のボタンからご参加ください。'],
    buttons: [{ label: '視聴ページを開く', url: ctx.watchUrl }],
    fallbackText: `開始しました。\n${ctx.title}\n${ctx.watchUrl}`,
  });
}

export function followupMessage(ctx) {
  return bubble({
    altText: `ご参加ありがとうございました｜${ctx.title}`,
    headerText: 'ご参加ありがとうございました',
    headerColor: COLOR.navy,
    title: ctx.title,
    bodyNotes: [
      'ご不明な点があれば、このトークにそのままご返信ください。担当者がご回答します。',
    ],
    buttons: [{ label: '予約内容を確認', url: ctx.manageUrl, primary: false }],
    fallbackText: 'ご参加ありがとうございました。ご不明な点はこのトークにご返信ください。',
  });
}

const BUILDERS = {
  confirm: confirmMessage,
  remind_1d: remind1dMessage,
  watch_link_3h: watchLinkMessage,
  remind_10m: remind10mMessage,
  start: startMessage,
  followup: followupMessage,
};

/** ジョブの種類に応じたメッセージを作る */
export function buildMessage(kind, ctx, now = Date.now()) {
  const builder = BUILDERS[kind];
  if (!builder) throw new Error(`未知の通知種別: ${kind}`);
  return builder(ctx, now);
}

// ---- Webhook への応答 ------------------------------------------------------

export function welcomeMessage() {
  const bookUrl = `${config.baseUrl}/`;
  return bubble({
    altText: '友だち追加ありがとうございます',
    headerText: '友だち追加ありがとうございます',
    headerColor: COLOR.green,
    title: 'オンライン説明会のご案内',
    bodyNotes: [
      '開催日時をお選びいただくと、当日の開始3時間前に視聴リンクをこのトークにお送りします。',
      'すでにサイトで予約済みの方は、表示された「予約コード」をこのトークに送信してください。',
    ],
    buttons: [{ label: '開催日程を見る', url: bookUrl }],
    fallbackText: `友だち追加ありがとうございます。\n開催日程はこちら:\n${bookUrl}`,
  });
}

export function linkedMessage(ctx, now = Date.now()) {
  const soon = ctx.startAt - now < 3 * 60 * 60 * 1000;
  return bubble({
    altText: `連携完了｜${formatJstShort(ctx.startAt)} ${ctx.title}`,
    headerText: '✓ 予約とLINEの連携が完了しました',
    headerColor: COLOR.green,
    title: ctx.title,
    rows: [['開催日時', formatJst(ctx.startAt)], ['お名前', ctx.name]],
    bodyNotes: [
      soon ? 'まもなく開始のため、視聴リンクをこのあとすぐお送りします。'
           : '開始3時間前に、視聴リンクをこのトークにお送りします。',
    ],
    buttons: [
      { label: '予約内容を確認', url: ctx.manageUrl },
      { label: 'カレンダーに追加', url: ctx.calendarUrl, primary: false },
    ],
    fallbackText: `連携が完了しました。\n${ctx.title}\n${formatJst(ctx.startAt)}\n開始3時間前に視聴リンクをお送りします。`,
  });
}

export function codeNotFoundMessage() {
  return text(
    '予約コードが確認できませんでした。\n\n'
    + '・予約完了ページに表示された6文字のコードをそのまま送信してください\n'
    + '・お手元にコードが無い場合は「予約」と送信すると、日程一覧をご案内します',
  );
}

export function alreadyLinkedOtherMessage() {
  return text('この予約コードは、すでに別のLINEアカウントと連携されています。お心当たりがない場合はこのトークにご連絡ください。');
}

export function duplicateMessage() {
  return text('この回はすでにご予約済みです。開始3時間前に視聴リンクをお送りしますので、そのままお待ちください。');
}

/** 「予約」と送られたとき / 空き枠の案内 */
export function sessionListMessage(sessions) {
  const bookUrl = `${config.baseUrl}/`;
  if (sessions.length === 0) {
    return text(`現在ご予約いただける日程がありません。\n最新の日程はこちらからご確認ください。\n${bookUrl}`);
  }
  const lines = sessions.slice(0, 5).map((s) => `・${formatJst(s.start_at)}`).join('\n');
  return bubble({
    altText: '開催日程のご案内',
    headerText: '📅 開催中の日程',
    headerColor: COLOR.navy,
    title: sessions[0].title,
    bodyNotes: [lines, 'ボタンから日時を選んでご予約ください。'],
    buttons: [{ label: '日程を選んで予約する', url: bookUrl }],
    fallbackText: `開催日程:\n${lines}\n\nご予約はこちら:\n${bookUrl}`,
  });
}

/** 予約状況の確認（「確認」と送られたとき） */
export function myReservationsMessage(reservations) {
  if (reservations.length === 0) {
    return text(`現在お預かりしているご予約はありません。\n日程はこちらから:\n${config.baseUrl}/`);
  }
  const r = reservations[0];
  const ctx = buildContext({
    watch_token: r.watch_token, name: r.name, title: r.title,
    start_at: r.start_at, duration_sec: r.duration_sec,
  });
  const others = reservations.slice(1).map((x) => `・${formatJst(x.start_at)}`);
  return bubble({
    altText: `ご予約: ${formatJstShort(r.start_at)} ${r.title}`,
    headerText: '現在のご予約',
    headerColor: COLOR.navy,
    title: r.title,
    rows: [['開催日時', formatJst(r.start_at)], ['お名前', r.name]],
    bodyNotes: others.length ? [`他のご予約:\n${others.join('\n')}`] : ['開始3時間前に視聴リンクをお送りします。'],
    buttons: [{ label: '予約内容を確認', url: ctx.manageUrl }],
    fallbackText: `ご予約: ${formatJst(r.start_at)}\n${r.title}\n${ctx.manageUrl}`,
  });
}

export function helpMessage() {
  return text(
    'ご利用方法\n\n'
    + '「予約」… 開催日程をご案内します\n'
    + '「確認」… 現在のご予約を表示します\n'
    + '「キャンセル」… ご予約の取り消し方法をご案内します\n\n'
    + '予約コード（6文字）を送信すると、サイトでのご予約とこのトークが連携され、'
    + '当日の開始3時間前に視聴リンクが届きます。',
  );
}

export function cancelGuideMessage(reservations) {
  if (reservations.length === 0) return text('現在お預かりしているご予約はありません。');
  const r = reservations[0];
  return text(
    `ご予約の取り消しは、下のページから行えます。\n\n${formatJst(r.start_at)}\n${r.title}\n\n`
    + `${config.baseUrl}/r/${r.watch_token}`,
  );
}

export const plainText = text;
