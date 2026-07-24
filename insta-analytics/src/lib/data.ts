import rawData from "../../insta_data.json";
import type {
  Diagnosis,
  DiagnosisKpi,
  InstaData,
  Kpi,
  Meta,
  Update2026,
} from "./types";

/**
 * プロジェクト直下の insta_data.json を読み込む（内容は変更しない）。
 * JSON の推論型を厳密なドメイン型へ確定させる。
 */
const data = rawData as unknown as InstaData;

export const meta: Meta = data.meta;
export const kpis: Kpi[] = data.kpis;
export const diagnosis: Diagnosis[] = data.diagnosis;
export const updates2026: Update2026[] = data.updates2026;

/** 診断フローで選択できる KPI（8種類・表示順）。 */
export const DIAGNOSIS_KPIS: DiagnosisKpi[] = [
  "リーチ",
  "プロフアクセス率",
  "フォロワー転換率",
  "保存率",
  "シェア率（送信）",
  "リンクCTR",
  "ストーリーズ閲覧率",
  "成約率",
];

/** ある KPI に紐づく state（重複排除・登場順）を返す。 */
export function statesForKpi(kpi: string): string[] {
  const seen = new Set<string>();
  for (const d of diagnosis) {
    if (d.kpi === kpi) seen.add(d.state);
  }
  return [...seen];
}

/** KPI × state に一致する診断カードを返す。 */
export function diagnosisFor(kpi: string, state: string): Diagnosis[] {
  return diagnosis.filter((d) => d.kpi === kpi && d.state === state);
}
