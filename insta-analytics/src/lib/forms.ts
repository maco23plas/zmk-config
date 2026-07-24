/** 入力文字列 → number | null（空文字・不正値は null）。 */
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** number | null → 入力用文字列（null は空文字）。 */
export function numStr(n: number | null): string {
  return n === null || n === undefined ? "" : String(n);
}

/** 今日の日付を YYYY-MM-DD で返す（date input 初期値用）。 */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
