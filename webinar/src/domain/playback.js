// 疑似ライブ(simulive)の状態計算。
//
// 考え方: 動画の再生位置はサーバー時刻から一意に決まる。
//   再生位置 = 現在時刻 - 開始時刻
// 誰がいつ開いても同じ位置が流れ、巻き戻しも早送りもできない。
// これが「Zoomに入らなくても、本当に生配信を見ているのと同じ体験」の中身。
//
// この関数は純粋関数。DBにもネットワークにも触らないのでテストしやすい。

export const PlaybackState = {
  CANCELED: 'canceled',   // 中止
  SCHEDULED: 'scheduled', // 開始前（待機画面＋カウントダウン）
  SOON: 'soon',           // 開始直前（10分前〜）
  LIVE: 'live',           // 配信中
  LATE_CLOSED: 'late_closed', // 途中入場の締切を過ぎた
  ARCHIVE: 'archive',     // 見逃し配信（シーク可）
  ENDED: 'ended',         // 終了
};

export const SOON_WINDOW_MS = 10 * 60 * 1000;

/**
 * @param {object} plan
 * @param {number} plan.startAt        開始時刻 epoch ms
 * @param {number} plan.durationSec    本編の長さ（秒）
 * @param {number} [plan.lateJoinSec]  開始後この秒数まで入場可。0 は配信中いつでも可。
 * @param {number} [plan.archiveHours] 終了後の見逃し配信時間（0 でなし）
 * @param {string} [plan.status]       開催枠の状態
 * @param {number} now                 現在時刻 epoch ms
 */
export function playbackState(plan, now) {
  const startAt = Number(plan.startAt);
  const durationSec = Math.max(0, Number(plan.durationSec) || 0);
  const lateJoinSec = Math.max(0, Number(plan.lateJoinSec) || 0);
  const archiveHours = Math.max(0, Number(plan.archiveHours) || 0);
  const endAt = startAt + durationSec * 1000;
  const archiveUntil = endAt + archiveHours * 3600 * 1000;

  const base = {
    startAt,
    endAt,
    durationSec,
    positionSec: 0,
    msUntilStart: startAt - now,
    msUntilEnd: endAt - now,
    canWatch: false,   // 動画を再生してよいか
    seekable: false,   // シークを許すか（見逃し配信のみ true）
    progress: 0,
  };

  if (plan.status === 'canceled') return { ...base, state: PlaybackState.CANCELED };

  if (now < startAt) {
    const state = startAt - now <= SOON_WINDOW_MS ? PlaybackState.SOON : PlaybackState.SCHEDULED;
    return { ...base, state };
  }

  if (now < endAt) {
    const positionSec = (now - startAt) / 1000;
    // 途中入場の締切（0 は無制限）
    if (lateJoinSec > 0 && positionSec > lateJoinSec) {
      return { ...base, state: PlaybackState.LATE_CLOSED, positionSec, progress: positionSec / durationSec };
    }
    return {
      ...base,
      state: PlaybackState.LIVE,
      positionSec,
      canWatch: true,
      progress: durationSec > 0 ? positionSec / durationSec : 0,
    };
  }

  if (archiveHours > 0 && now < archiveUntil) {
    return {
      ...base,
      state: PlaybackState.ARCHIVE,
      positionSec: 0,
      canWatch: true,
      seekable: true,
      progress: 0,
      archiveUntil,
    };
  }

  return { ...base, state: PlaybackState.ENDED, positionSec: durationSec, progress: 1 };
}

/** 動画そのものへのアクセスを許してよい状態か（/media の入場ゲート） */
export function mediaAllowed(state) {
  return state === PlaybackState.LIVE || state === PlaybackState.ARCHIVE;
}

/** 画面に出す状態ラベル */
export const STATE_LABEL = {
  [PlaybackState.CANCELED]: '中止',
  [PlaybackState.SCHEDULED]: '開始前',
  [PlaybackState.SOON]: 'まもなく開始',
  [PlaybackState.LIVE]: '配信中',
  [PlaybackState.LATE_CLOSED]: '入場締切',
  [PlaybackState.ARCHIVE]: '見逃し配信',
  [PlaybackState.ENDED]: '終了',
};

/**
 * 動画ソースの種別を判定する。
 *  - 'youtube:VIDEO_ID' → YouTube 限定公開動画（自前の動画ホスティングが不要）
 *  - 'file:name.mp4'    → MEDIA_DIR 配下のファイルを自前配信
 *  - 'https://...'      → 外部URL（CDN/S3の署名付きURL等）
 */
export function parseVideoSource(videoUrl) {
  const s = String(videoUrl || '').trim();
  if (s.startsWith('youtube:')) return { type: 'youtube', id: s.slice('youtube:'.length).trim() };
  if (s.startsWith('file:')) return { type: 'file', name: s.slice('file:'.length).trim() };
  if (/^https?:\/\//i.test(s)) return { type: 'url', url: s };
  return { type: 'unknown', raw: s };
}
