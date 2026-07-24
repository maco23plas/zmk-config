import type { Settings } from "./types";

/**
 * 設定の初期値。
 * ベンチマークの初期値は kpis の benchmark2026 を参考にした妥当値。
 * （good = 達成ライン / warn = 注意ライン、いずれも比率 0〜1）
 */
export const DEFAULT_SETTINGS: Settings = {
  benchmarks: {
    homeRate: { good: 0.4, warn: 0.3 }, // ホーム率 達成40%/注意30%
    saveRate: { good: 0.02, warn: 0.01 }, // 保存率 達成2%/注意1%
    shareRate: { good: 0.008, warn: 0.003 }, // シェア率 達成0.8%/注意0.3%
    followerConversionRate: { good: 0.05, warn: 0.03 }, // 転換率 達成5%/注意3%
    storyViewRate: { good: 0.05, warn: 0.03 }, // ストーリーズ閲覧率 達成5%/注意3%
    profileVisitRate: { good: 0.03, warn: 0.015 }, // プロフアクセス率 達成3%/注意1.5%
  },
  verdict: {
    winSaveRate: 0.02, // 保存率 ≥ 2%
    winShareRate: 0.008, // シェア率 ≥ 0.8%
    loseSaveRate: 0.005, // 保存率 < 0.5%
    loseShareRate: 0.002, // シェア率 < 0.2%
    loseLikeRate: 0.015, // いいね率 < 1.5%
  },
};

/** 維持率の初期しきい値（投稿別グラフ・目安ライン用途）。 */
export const RETENTION_THRESHOLD = { good: 0.5, warn: 0.35 };
