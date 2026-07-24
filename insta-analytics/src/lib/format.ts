/* 表示フォーマット関連のユーティリティ（すべて純関数）。 */

const PLACEHOLDER = "—";

/** レート（0〜1）を小数1桁の % で表示。null は「—」。 */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return PLACEHOLDER;
  }
  return `${(value * 100).toFixed(digits)}%`;
}

/** 前週比ポイント差（レート差）を「▲/▼ x.x pt」で表示。 */
export function deltaLabel(delta: number | null | undefined): {
  text: string;
  dir: "up" | "down" | "flat" | "none";
} {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return { text: PLACEHOLDER, dir: "none" };
  }
  const pts = delta * 100;
  const abs = Math.abs(pts).toFixed(1);
  if (Math.abs(pts) < 0.05) return { text: `±0.0 pt`, dir: "flat" };
  if (pts > 0) return { text: `▲ ${abs} pt`, dir: "up" };
  return { text: `▼ ${abs} pt`, dir: "down" };
}

/** 整数（人数・回数など）を桁区切りで表示。null は「—」。 */
export function intFmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return PLACEHOLDER;
  }
  return Math.round(value).toLocaleString("ja-JP");
}

/** 日付文字列 (YYYY-MM-DD) を「M/D」表示。 */
export function shortDate(iso: string): string {
  if (!iso) return PLACEHOLDER;
  const [, m, d] = iso.split("-");
  if (!m || !d) return iso;
  return `${Number(m)}/${Number(d)}`;
}

/** 秒を「x.x秒」表示。 */
export function secFmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return PLACEHOLDER;
  }
  return `${value}秒`;
}

export const PLACEHOLDER_DASH = PLACEHOLDER;
