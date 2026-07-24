"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  LineChart as LineChartIcon,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CategoryBadge,
  EmptyState,
  PageHeader,
  StatusDot,
} from "@/components/common";
import { RateLineChart, Sparkline } from "@/components/charts";
import {
  useHydrated,
  useSettings,
  useWeekly,
  postsRepo,
  weeklyRepo,
} from "@/lib/store";
import { seedPosts, seedWeekly } from "@/lib/seed";
import {
  buildKpiCards,
  detectDeclines,
  rateSeries,
  type KpiCardData,
} from "@/lib/dashboard";
import { SPARKLINE_KEYS, RATE_LABEL } from "@/lib/metrics";
import { sortByWeekAsc } from "@/lib/calc";
import { deltaLabel, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPARK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

function DeltaText({ delta }: { delta: number | null }) {
  const { text, dir } = deltaLabel(delta);
  const Icon =
    dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const color =
    dir === "up"
      ? "text-ok"
      : dir === "down"
        ? "text-bad"
        : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", color)}>
      <Icon className="size-3.5" />
      <span className="tabular">{text}</span>
    </span>
  );
}

function KpiCard({ card }: { card: KpiCardData }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusDot status={card.status} />
          {card.label}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular">{pct(card.value)}</span>
          <DeltaText delta={card.delta} />
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          目安 {card.benchmark}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const weekly = useWeekly();
  const settings = useSettings();
  const hydrated = useHydrated();

  const asc = React.useMemo(() => sortByWeekAsc(weekly), [weekly]);
  const cards = React.useMemo(
    () => buildKpiCards(weekly, settings.benchmarks),
    [weekly, settings.benchmarks],
  );
  const alerts = React.useMemo(() => detectDeclines(weekly), [weekly]);

  const last8 = React.useMemo(() => asc.slice(-8), [asc]);
  const sparkSeries = React.useMemo(
    () =>
      SPARKLINE_KEYS.map((key) => ({
        key,
        label: RATE_LABEL[key],
        points: rateSeries(last8, key),
      })),
    [last8],
  );

  const latest = asc[asc.length - 1];

  if (!hydrated) {
    return <DashboardSkeleton />;
  }

  if (weekly.length === 0) {
    return (
      <div>
        <PageHeader
          title="ダッシュボード"
          description="週次・投稿別の数値を入力すると、各レートの達成状況と詰まり箇所がここに表示されます。"
        />
        <EmptyState
          icon={LineChartIcon}
          title="まだデータがありません"
          description="週次分析から数値を入力すると、KPIカード・トレンド・アラートが表示されます。まずはお試しでサンプルデータを入れてみるのもおすすめです。"
        >
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild>
              <Link href="/weekly">
                週次分析から入力を始める
                <ArrowUpRight className="size-4" />
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                weeklyRepo.set(seedWeekly());
                postsRepo.set(seedPosts());
              }}
            >
              <Sparkles className="size-4" />
              サンプルデータを投入（開発用）
            </Button>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ダッシュボード"
        description={
          latest
            ? `最新週：${latest.weekStart}（全${weekly.length}週）`
            : undefined
        }
      />

      {/* アラート */}
      {alerts.length > 0 ? (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.key} className="border-warn/40 bg-warn-bg/50">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-warn-bg text-warn shrink-0">
                    <AlertTriangle className="size-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">
                      「{a.label}」が2週連続で低下しています
                    </div>
                    <div className="text-xs text-muted-foreground tabular mt-0.5">
                      {a.values.map((v) => pct(v)).join(" → ")}
                    </div>
                  </div>
                </div>
                {a.diagnosisKpi ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                  >
                    <Link
                      href={`/diagnosis?kpi=${encodeURIComponent(a.diagnosisKpi)}&state=${encodeURIComponent("減った")}`}
                    >
                      診断フローを見る
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {/* KPI カード */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {cards.map((c) => (
          <KpiCard key={c.key} card={c} />
        ))}
      </div>

      {/* スパークライン */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LineChartIcon className="size-4 text-primary" />
            主要レートの推移
            <span className="text-xs font-normal text-muted-foreground">
              直近{last8.length}週
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sparkSeries.map((s, i) => {
            const last = s.points[s.points.length - 1]?.value ?? null;
            const prev = s.points[s.points.length - 2]?.value ?? null;
            return (
              <div key={s.key} className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">
                    {s.label}
                  </span>
                  <DeltaText
                    delta={
                      prev !== null && last !== null ? last - prev : null
                    }
                  />
                </div>
                <div className="text-xl font-bold tabular mb-2">
                  {pct(last)}
                </div>
                <Sparkline
                  data={s.points}
                  color={SPARK_COLORS[i % SPARK_COLORS.length]}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ホーム率トレンド */}
      {last8.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>ホーム率のトレンド</CardTitle>
          </CardHeader>
          <CardContent>
            <RateLineChart
              data={rateSeries(last8, "homeRate")}
              benchmark={settings.benchmarks.homeRate.good}
              benchmarkLabel={`目安 ${pct(settings.benchmarks.homeRate.good, 0)}`}
            />
          </CardContent>
        </Card>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CategoryBadge category="新規" />
        シェア率（送信）と視聴時間は現アルゴリズムの重要シグナル。絶対値より前週比・投稿間の相対比較を優先してください。
      </p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted animate-pulse" />
    </div>
  );
}
