import type {
  PostEntry,
  PostRates,
  VerdictThresholds,
  WeeklyEntry,
  WeeklyRates,
} from "./types";

/**
 * 安全な除算。分子が null、分母が null / 0 の場合は null を返す（ゼロ除算・未入力ガード）。
 * すべてのレート計算はこの純関数を通す。
 */
export function ratio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined) return null;
  if (denominator === 0) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  return numerator / denominator;
}

/** 引き算（どちらかが null なら null）。 */
function sub(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

/** 週次エントリからレート一式を計算する（純関数）。 */
export function computeWeeklyRates(e: WeeklyEntry): WeeklyRates {
  return {
    followerGrowth: ratio(e.newFollowers, e.followersStart),
    homeRate: ratio(e.followerReach, e.followersStart),
    nonFollowerReachRate: ratio(sub(e.reach, e.followerReach), e.reach),
    profileVisitRate: ratio(e.profileVisits, e.reach),
    followerConversionRate: ratio(e.newFollowers, e.profileVisits),
    saveRate: ratio(e.saves, e.reach),
    shareRate: ratio(e.shares, e.reach),
    linkCtr: ratio(e.linkClicks, e.profileVisits),
    storyViewRate: ratio(e.storyViews, e.followersStart),
    conversionRate: ratio(e.conversions, e.linkClicks),
  };
}

/** 投稿エントリからレート一式を計算する（分母はビュー数。維持率のみ 平均視聴時間÷動画尺）。 */
export function computePostRates(p: PostEntry): PostRates {
  return {
    retentionRate: ratio(p.avgWatchSec, p.videoSec),
    likeRate: ratio(p.likes, p.views),
    saveRate: ratio(p.saves, p.views),
    shareRate: ratio(p.shares, p.views),
    profileVisitRate: ratio(p.profileVisits, p.views),
  };
}

export type VerdictSuggestion = "勝ち候補" | "負け候補" | null;

/**
 * 投稿の勝ち/負けサジェスト（最終判定はユーザーが手動確定）。
 * - 勝ち候補: 保存率 ≥ winSaveRate または シェア率 ≥ winShareRate
 * - 負け候補: 保存率 < loseSaveRate かつ シェア率 < loseShareRate かつ いいね率 < loseLikeRate
 * 判定に必要な値が欠けている場合は null。
 */
export function suggestVerdict(
  rates: PostRates,
  t: VerdictThresholds,
): VerdictSuggestion {
  const { saveRate, shareRate, likeRate } = rates;

  // 勝ち判定は「いずれか」なので、片方でも満たせば勝ち候補
  if (
    (saveRate !== null && saveRate >= t.winSaveRate) ||
    (shareRate !== null && shareRate >= t.winShareRate)
  ) {
    return "勝ち候補";
  }

  // 負け判定は3条件すべて必要 → すべての値が揃っている必要がある
  if (saveRate !== null && shareRate !== null && likeRate !== null) {
    if (
      saveRate < t.loseSaveRate &&
      shareRate < t.loseShareRate &&
      likeRate < t.loseLikeRate
    ) {
      return "負け候補";
    }
  }

  return null;
}

export type RateStatus = "good" | "warn" | "bad" | "none";

/**
 * しきい値に対するレートの3色ステータス。
 * value ≥ good → 達成 / value ≥ warn → 注意 / それ未満 → 未達 / null → none
 */
export function rateStatus(
  value: number | null,
  good: number,
  warn: number,
): RateStatus {
  if (value === null) return "none";
  if (value >= good) return "good";
  if (value >= warn) return "warn";
  return "bad";
}

/**
 * 前週比（ポイント差）。今週・前週いずれかが null なら null。
 * 返り値はレート差（例: 0.42 → 0.38 なら -0.04）。
 */
export function deltaPoint(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

/** 週開始日で昇順ソートした新しい配列を返す。 */
export function sortByWeekAsc(entries: WeeklyEntry[]): WeeklyEntry[] {
  return [...entries].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** 週開始日で降順（新しい順）ソートした新しい配列を返す。 */
export function sortByWeekDesc(entries: WeeklyEntry[]): WeeklyEntry[] {
  return [...entries].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}
