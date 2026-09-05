// 時刻の単一の入口。テストから固定できるようにしておく。
let override = null;

export const clock = {
  now: () => (override === null ? Date.now() : override),
  /** テスト用: 現在時刻を固定する。null で実時間に戻す。 */
  setNow(ms) { override = ms; },
  advance(ms) { override = (override === null ? Date.now() : override) + ms; },
};
