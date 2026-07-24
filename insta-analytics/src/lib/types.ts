/* =========================================================================
   ドメイン型定義
   - insta_data.json（静的コンテンツ）
   - ユーザーデータ（週次・投稿別・設定・診断チェック） … localStorage 保存
   ========================================================================= */

/* ---------- insta_data.json ---------- */

export type Category = "継続" | "更新" | "新規";

export interface Meta {
  title: string;
  benchmark_note: string;
  categories: Record<Category, string>;
}

export interface Kpi {
  id: number;
  name: string;
  definition: string;
  where: string;
  benchmark2026: string;
  note: string;
}

/** 診断フローの対象 KPI（8種類）。 */
export type DiagnosisKpi =
  | "リーチ"
  | "プロフアクセス率"
  | "フォロワー転換率"
  | "保存率"
  | "シェア率（送信）"
  | "リンクCTR"
  | "ストーリーズ閲覧率"
  | "成約率";

export interface Diagnosis {
  id: number;
  kpi: string;
  state: string;
  checkpoint: string;
  action: string;
  category: Category;
  criteria: string;
}

export interface Update2026 {
  id: number;
  area: string;
  before: string;
  after: string;
  category: Category;
}

export interface InstaData {
  meta: Meta;
  kpis: Kpi[];
  diagnosis: Diagnosis[];
  updates2026: Update2026[];
}

/* ---------- ユーザーデータ：週次 ---------- */

/** 週次で手入力する生値（14項目）。未入力は null。 */
export interface WeeklyEntry {
  id: string;
  weekStart: string; // 週開始日 (YYYY-MM-DD)
  followersStart: number | null; // 週初フォロワー数
  newFollowers: number | null; // 新規フォロワー数（純増）
  posts: number | null; // 投稿数
  stories: number | null; // ストーリーズ本数
  views: number | null; // ビュー数
  reach: number | null; // リーチ
  followerReach: number | null; // うちフォロワーリーチ
  profileVisits: number | null; // プロフィールアクセス
  saves: number | null; // 保存
  shares: number | null; // シェア（送信）
  linkClicks: number | null; // 外部リンククリック
  storyViews: number | null; // ストーリーズ閲覧（平均）
  conversions: number | null; // CV数
  createdAt: string;
  updatedAt: string;
}

/** 週次の生値のうち、計算に使う数値フィールドのキー。 */
export type WeeklyNumericKey = Exclude<
  keyof WeeklyEntry,
  "id" | "weekStart" | "createdAt" | "updatedAt"
>;

/** 週次から導出されるレート（比率、0〜1 or null）。 */
export interface WeeklyRates {
  followerGrowth: number | null; // フォロワー増加率
  homeRate: number | null; // ホーム率
  nonFollowerReachRate: number | null; // フォロワー外リーチ率
  profileVisitRate: number | null; // プロフアクセス率
  followerConversionRate: number | null; // フォロワー転換率
  saveRate: number | null; // 保存率
  shareRate: number | null; // シェア率
  linkCtr: number | null; // リンクCTR
  storyViewRate: number | null; // ストーリーズ閲覧率
  conversionRate: number | null; // 成約率
}

export type WeeklyRateKey = keyof WeeklyRates;

/* ---------- ユーザーデータ：投稿別 ---------- */

export type PostFormat = "リール" | "カルーセル" | "フィード単枚" | "ストーリーズ" | "ライブ";

export type PostVerdict = "勝ち" | "普通" | "負け";

export interface PostEntry {
  id: string;
  date: string; // 投稿日
  format: PostFormat; // 形式
  title: string; // 企画名
  hook: string; // フック（冒頭文言）
  views: number | null; // ビュー数
  reach: number | null; // リーチ
  nonFollowerReachPct: number | null; // フォロワー外リーチ率（% 手入力）
  videoSec: number | null; // 動画尺（秒）
  avgWatchSec: number | null; // 平均視聴時間（秒）
  likes: number | null; // いいね
  comments: number | null; // コメント
  saves: number | null; // 保存
  shares: number | null; // シェア
  profileVisits: number | null; // プロフィールアクセス
  follows: number | null; // フォロー数
  verdict: PostVerdict; // 判定（手動確定）
  memo: string; // 学びメモ
  createdAt: string;
  updatedAt: string;
}

/** 投稿から導出されるレート（すべて 0〜1 or null）。 */
export interface PostRates {
  retentionRate: number | null; // 維持率 = 平均視聴時間 ÷ 動画尺
  likeRate: number | null; // いいね率 = いいね ÷ ビュー数
  saveRate: number | null; // 保存率 = 保存 ÷ ビュー数
  shareRate: number | null; // シェア率 = シェア ÷ ビュー数
  profileVisitRate: number | null; // プロフアクセス率 = プロフ ÷ ビュー数
}

export type PostRateKey = keyof PostRates;

/* ---------- 設定：ベンチマーク & 判定しきい値 ---------- */

/** 達成ライン / 注意ライン（比率、0〜1）。値以上で達成、注意ライン以上〜達成未満で注意、注意未満で未達。 */
export interface Threshold {
  good: number;
  warn: number;
}

/** ダッシュボードで色分けする主要レートのしきい値。 */
export interface BenchmarkSettings {
  homeRate: Threshold;
  saveRate: Threshold;
  shareRate: Threshold;
  followerConversionRate: Threshold;
  storyViewRate: Threshold;
  profileVisitRate: Threshold;
}

export type BenchmarkKey = keyof BenchmarkSettings;

/** 投稿の勝ち/負けサジェスト用しきい値。 */
export interface VerdictThresholds {
  winSaveRate: number; // これ以上の保存率で「勝ち候補」
  winShareRate: number; // これ以上のシェア率で「勝ち候補」
  loseSaveRate: number; // これ未満の保存率 かつ …
  loseShareRate: number; // これ未満のシェア率 かつ …
  loseLikeRate: number; // これ未満のいいね率 で「負け候補」
}

export interface Settings {
  benchmarks: BenchmarkSettings;
  verdict: VerdictThresholds;
}

/* ---------- 診断チェック（試した施策） ---------- */

export interface DiagnosisCheck {
  diagnosisId: number;
  checkedAt: string; // 試した日付（ISO）
}

/* ---------- エクスポート/インポート ---------- */

export interface ExportBundle {
  app: "インスタ分析思考2026";
  version: 1;
  exportedAt: string;
  weekly: WeeklyEntry[];
  posts: PostEntry[];
  settings: Settings;
  checks: DiagnosisCheck[];
}
