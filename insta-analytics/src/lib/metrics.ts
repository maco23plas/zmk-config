import type { BenchmarkKey, WeeklyRateKey } from "./types";

/** 週次レートの表示メタ情報。benchmarkKey がある指標はダッシュボードで3色ステータス表示。 */
export interface WeeklyRateMeta {
  key: WeeklyRateKey;
  label: string;
  benchmark: string; // 目安（表示用テキスト）
  benchmarkKey: BenchmarkKey | null; // settings のしきい値と対応（あれば色分け）
  desc: string;
}

export const WEEKLY_RATE_META: WeeklyRateMeta[] = [
  {
    key: "homeRate",
    label: "ホーム率",
    benchmark: "40〜50%",
    benchmarkKey: "homeRate",
    desc: "フォロワーリーチ ÷ 週初フォロワー数",
  },
  {
    key: "saveRate",
    label: "保存率",
    benchmark: "1%〜（2〜3%で優秀）",
    benchmarkKey: "saveRate",
    desc: "保存 ÷ リーチ",
  },
  {
    key: "shareRate",
    label: "シェア率",
    benchmark: "0.3〜1%で強い",
    benchmarkKey: "shareRate",
    desc: "シェア（送信） ÷ リーチ",
  },
  {
    key: "followerConversionRate",
    label: "フォロワー転換率",
    benchmark: "5〜8%以上",
    benchmarkKey: "followerConversionRate",
    desc: "新規フォロワー ÷ プロフィールアクセス",
  },
  {
    key: "profileVisitRate",
    label: "プロフアクセス率",
    benchmark: "フィード3%〜",
    benchmarkKey: "profileVisitRate",
    desc: "プロフィールアクセス ÷ リーチ",
  },
  {
    key: "storyViewRate",
    label: "ストーリーズ閲覧率",
    benchmark: "規模別3〜10%",
    benchmarkKey: "storyViewRate",
    desc: "ストーリーズ閲覧 ÷ 週初フォロワー数",
  },
  {
    key: "nonFollowerReachRate",
    label: "フォロワー外リーチ率",
    benchmark: "認知目的で50〜70%",
    benchmarkKey: null,
    desc: "(リーチ − フォロワーリーチ) ÷ リーチ",
  },
  {
    key: "linkCtr",
    label: "リンクCTR",
    benchmark: "1〜3%",
    benchmarkKey: null,
    desc: "外部リンククリック ÷ プロフィールアクセス",
  },
  {
    key: "conversionRate",
    label: "成約率",
    benchmark: "EC通説1〜3%",
    benchmarkKey: null,
    desc: "CV数 ÷ 外部リンククリック",
  },
  {
    key: "followerGrowth",
    label: "フォロワー増加率",
    benchmark: "月2〜5%",
    benchmarkKey: null,
    desc: "新規フォロワー ÷ 週初フォロワー数",
  },
];

/** ダッシュボードのスパークラインで扱う主要4レート。 */
export const SPARKLINE_KEYS: WeeklyRateKey[] = [
  "homeRate",
  "saveRate",
  "shareRate",
  "followerConversionRate",
];

/** レートキー → ラベル の逆引き。 */
export const RATE_LABEL: Record<WeeklyRateKey, string> = WEEKLY_RATE_META.reduce(
  (acc, m) => {
    acc[m.key] = m.label;
    return acc;
  },
  {} as Record<WeeklyRateKey, string>,
);

/** benchmarkKey を持つレートのメタ（benchmarkKey は非 null で確定）。 */
export type BenchmarkedRateMeta = WeeklyRateMeta & { benchmarkKey: BenchmarkKey };

/** benchmarkKey を持つレート（ダッシュボードで色分け・アラート対象）。 */
export const BENCHMARKED_META: BenchmarkedRateMeta[] = WEEKLY_RATE_META.filter(
  (m): m is BenchmarkedRateMeta => m.benchmarkKey !== null,
);

/** ダッシュボードのアラートから診断フローへ飛ぶ際の KPI 対応表。 */
export const RATE_TO_DIAGNOSIS_KPI: Partial<Record<WeeklyRateKey, string>> = {
  homeRate: "リーチ",
  saveRate: "保存率",
  shareRate: "シェア率（送信）",
  followerConversionRate: "フォロワー転換率",
  profileVisitRate: "プロフアクセス率",
  storyViewRate: "ストーリーズ閲覧率",
  linkCtr: "リンクCTR",
  conversionRate: "成約率",
};
