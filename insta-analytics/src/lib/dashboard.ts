import { computeWeeklyRates, deltaPoint, rateStatus, sortByWeekAsc } from "./calc";
import type { RateStatus } from "./calc";
import { shortDate } from "./format";
import { BENCHMARKED_META, RATE_TO_DIAGNOSIS_KPI } from "./metrics";
import type {
  BenchmarkSettings,
  WeeklyEntry,
  WeeklyRateKey,
  WeeklyRates,
} from "./types";
import type { RatePoint } from "@/components/charts";

export interface KpiCardData {
  key: WeeklyRateKey;
  label: string;
  benchmark: string;
  value: number | null;
  delta: number | null; // 前週比（ポイント差）
  status: RateStatus;
  good: number;
  diagnosisKpi: string | null;
}

/** 週次エントリ（時系列）から、あるレートキーのポイント列を作る。 */
export function rateSeries(
  sortedAsc: WeeklyEntry[],
  key: WeeklyRateKey,
): RatePoint[] {
  return sortedAsc.map((e) => ({
    label: shortDate(e.weekStart),
    value: computeWeeklyRates(e)[key],
  }));
}

/** 最新週の benchmarked KPI カード群を作る。 */
export function buildKpiCards(
  entries: WeeklyEntry[],
  benchmarks: BenchmarkSettings,
): KpiCardData[] {
  const asc = sortByWeekAsc(entries);
  const latest = asc[asc.length - 1];
  const prev = asc[asc.length - 2];
  const latestRates: WeeklyRates | null = latest
    ? computeWeeklyRates(latest)
    : null;
  const prevRates: WeeklyRates | null = prev ? computeWeeklyRates(prev) : null;

  return BENCHMARKED_META.map((m) => {
    const value = latestRates ? latestRates[m.key] : null;
    const previous = prevRates ? prevRates[m.key] : null;
    const th = benchmarks[m.benchmarkKey];
    return {
      key: m.key,
      label: m.label,
      benchmark: m.benchmark,
      value,
      delta: deltaPoint(value, previous),
      status: rateStatus(value, th.good, th.warn),
      good: th.good,
      diagnosisKpi: RATE_TO_DIAGNOSIS_KPI[m.key] ?? null,
    };
  });
}

export interface DeclineAlert {
  key: WeeklyRateKey;
  label: string;
  diagnosisKpi: string | null;
  values: number[]; // 直近3週の値（古→新）
}

/**
 * 2週連続で低下しているレートを検出する。
 * 直近3週が非 null かつ w1 > w2 > w3 のとき警告。
 */
export function detectDeclines(entries: WeeklyEntry[]): DeclineAlert[] {
  const asc = sortByWeekAsc(entries);
  if (asc.length < 3) return [];
  const last3 = asc.slice(-3).map(computeWeeklyRates);

  const alerts: DeclineAlert[] = [];
  for (const m of BENCHMARKED_META) {
    const vals = last3.map((r) => r[m.key]);
    if (vals.some((v) => v === null)) continue;
    const [a, b, c] = vals as [number, number, number];
    if (a > b && b > c) {
      alerts.push({
        key: m.key,
        label: m.label,
        diagnosisKpi: RATE_TO_DIAGNOSIS_KPI[m.key] ?? null,
        values: [a, b, c],
      });
    }
  }
  return alerts;
}
