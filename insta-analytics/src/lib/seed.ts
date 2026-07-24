import { makeId } from "./utils";
import type { PostEntry, WeeklyEntry } from "./types";

/**
 * 開発用サンプルデータ（週次3週分＋投稿5件）。
 * ダッシュボード空状態のボタンから1クリックで投入する。
 */
export function seedWeekly(): WeeklyEntry[] {
  const now = new Date().toISOString();
  const base = (
    weekStart: string,
    v: Omit<WeeklyEntry, "id" | "weekStart" | "createdAt" | "updatedAt">,
  ): WeeklyEntry => ({
    id: makeId(),
    weekStart,
    ...v,
    createdAt: now,
    updatedAt: now,
  });

  return [
    base("2026-07-06", {
      followersStart: 5000,
      newFollowers: 120,
      posts: 5,
      stories: 20,
      views: 40000,
      reach: 22000,
      followerReach: 9700, // ホーム率 ≈ 43.7%
      profileVisits: 900,
      saves: 480,
      shares: 130,
      linkClicks: 210,
      storyViews: 260,
      conversions: 6,
    }),
    base("2026-07-13", {
      followersStart: 5120,
      newFollowers: 90,
      posts: 4,
      stories: 18,
      views: 35000,
      reach: 19000,
      followerReach: 7900, // ホーム率 ≈ 34.4%（低下）
      profileVisits: 700,
      saves: 300,
      shares: 80,
      linkClicks: 150,
      storyViews: 210,
      conversions: 3,
    }),
    base("2026-07-20", {
      followersStart: 5210,
      newFollowers: 150,
      posts: 6,
      stories: 24,
      views: 52000,
      reach: 27000,
      followerReach: 12400, // ホーム率 ≈ 47.6%（回復）
      profileVisits: 1100,
      saves: 700,
      shares: 90, // シェア率は3週連続で低下 → アラート対象
      linkClicks: 300,
      storyViews: 320,
      conversions: 9,
    }),
  ];
}

export function seedPosts(): PostEntry[] {
  const now = new Date().toISOString();
  const base = (
    v: Omit<PostEntry, "id" | "createdAt" | "updatedAt">,
  ): PostEntry => ({
    id: makeId(),
    ...v,
    createdAt: now,
    updatedAt: now,
  });

  return [
    base({
      date: "2026-07-20",
      format: "リール",
      title: "朝ルーティン時短術",
      hook: "実は9割が損してる朝の3分",
      views: 60000,
      reach: 42000,
      nonFollowerReachPct: 78,
      videoSec: 30,
      avgWatchSec: 18, // 維持率 60%
      likes: 1500,
      comments: 90,
      saves: 1400, // 保存率 2.3%
      shares: 620, // シェア率 1.03%
      profileVisits: 900,
      follows: 210,
      verdict: "勝ち",
      memo: "冒頭2秒の損失フックが効いた。同型でシリーズ化する。",
    }),
    base({
      date: "2026-07-18",
      format: "カルーセル",
      title: "保存版・便利家電100選",
      hook: "永久保存推奨のまとめ",
      views: 22000,
      reach: 20000,
      nonFollowerReachPct: 45,
      videoSec: null,
      avgWatchSec: null,
      likes: 380,
      comments: 25,
      saves: 900, // 保存率 4.1%
      shares: 120, // シェア率 0.55%
      profileVisits: 400,
      follows: 60,
      verdict: "勝ち",
      memo: "枚数多め×まとめ企画は保存に強い。100選フォーマットを横展開。",
    }),
    base({
      date: "2026-07-16",
      format: "リール",
      title: "失敗あるある集",
      hook: "共感しかないやつ",
      views: 45000,
      reach: 33000,
      nonFollowerReachPct: 70,
      videoSec: 25,
      avgWatchSec: 11, // 維持率 44%
      likes: 900,
      comments: 60,
      saves: 500, // 保存率 1.1%
      shares: 400, // シェア率 0.89%
      profileVisits: 500,
      follows: 90,
      verdict: "勝ち",
      memo: "「送りたくなる」あるある系はシェアが伸びる。維持率は要改善。",
    }),
    base({
      date: "2026-07-14",
      format: "ストーリーズ",
      title: "アンケート企画",
      hook: "AとBどっち派？",
      views: 3000,
      reach: 2900,
      nonFollowerReachPct: 5,
      videoSec: null,
      avgWatchSec: null,
      likes: 0,
      comments: 0,
      saves: 20,
      shares: 15,
      profileVisits: 60,
      follows: 5,
      verdict: "普通",
      memo: "2択は反応率高め。親密度シグナル狙いで継続。",
    }),
    base({
      date: "2026-07-12",
      format: "フィード単枚",
      title: "新商品告知",
      hook: "ついに発売しました",
      views: 8000,
      reach: 7500,
      nonFollowerReachPct: 20,
      videoSec: null,
      avgWatchSec: null,
      likes: 100, // いいね率 1.25%
      comments: 12,
      saves: 35, // 保存率 0.44%
      shares: 10, // シェア率 0.13%
      profileVisits: 120,
      follows: 8,
      verdict: "負け",
      memo: "告知単体は広告感が強く伸びにくい。ベネフィット訴求へ作り替える。",
    }),
  ];
}
