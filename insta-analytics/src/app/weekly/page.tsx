"use client";

import * as React from "react";
import { CalendarDays, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm";
import { WeeklyForm } from "@/components/weekly-form";
import { RateLineChart, type RatePoint } from "@/components/charts";
import { useHydrated, useSettings, useWeekly, weeklyRepo } from "@/lib/store";
import {
  computeWeeklyRates,
  sortByWeekAsc,
  sortByWeekDesc,
} from "@/lib/calc";
import { rateSeries } from "@/lib/dashboard";
import { WEEKLY_RATE_META } from "@/lib/metrics";
import { pct, shortDate } from "@/lib/format";
import type { WeeklyEntry, WeeklyRateKey } from "@/lib/types";

export default function WeeklyPage() {
  const weekly = useWeekly();
  const settings = useSettings();
  const hydrated = useHydrated();

  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<WeeklyEntry | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [chartKey, setChartKey] = React.useState<WeeklyRateKey>("homeRate");

  const desc = React.useMemo(() => sortByWeekDesc(weekly), [weekly]);
  const asc = React.useMemo(() => sortByWeekAsc(weekly), [weekly]);
  const chartData: RatePoint[] = React.useMemo(
    () => rateSeries(asc, chartKey),
    [asc, chartKey],
  );

  const chartMeta = WEEKLY_RATE_META.find((m) => m.key === chartKey);
  const chartBenchmark =
    chartMeta?.benchmarkKey != null
      ? settings.benchmarks[chartMeta.benchmarkKey].good
      : null;

  const startNew = () => {
    setEditing(null);
    setShowForm(true);
  };
  const startEdit = (entry: WeeklyEntry) => {
    setEditing(entry);
    setShowForm(true);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleSubmit = (entry: WeeklyEntry) => {
    weeklyRepo.upsert(entry);
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="週次分析"
        description="14項目の数値を入力すると10種のレートが自動計算されます。分母ゼロ・未入力は「—」表示です。"
        action={
          showForm ? (
            <Button
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
            >
              <X className="size-4" />
              閉じる
            </Button>
          ) : (
            <Button onClick={startNew}>
              <Plus className="size-4" />
              週を追加
            </Button>
          )
        }
      />

      {showForm ? (
        <WeeklyForm
          key={editing?.id ?? "new"}
          editing={editing}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      ) : null}

      {!hydrated ? (
        <div className="h-48 rounded-xl bg-muted animate-pulse" />
      ) : weekly.length === 0 && !showForm ? (
        <EmptyState
          icon={CalendarDays}
          title="週次データがありません"
          description="「週を追加」から最初の1週を入力してください。"
        >
          <Button onClick={startNew}>
            <Plus className="size-4" />
            週を追加
          </Button>
        </EmptyState>
      ) : weekly.length > 0 ? (
        <>
          {/* グラフ */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>レート推移</CardTitle>
              <div className="w-48">
                <Select
                  value={chartKey}
                  onValueChange={(v) => setChartKey(v as WeeklyRateKey)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKLY_RATE_META.map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {asc.length >= 2 ? (
                <RateLineChart
                  data={chartData}
                  benchmark={chartBenchmark}
                  benchmarkLabel={
                    chartBenchmark != null
                      ? `目安 ${pct(chartBenchmark, 0)}`
                      : "目安"
                  }
                />
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  2週以上のデータでグラフを表示します。
                </p>
              )}
            </CardContent>
          </Card>

          {/* テーブル */}
          <Card>
            <CardHeader>
              <CardTitle>週一覧（新しい順）</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card">週</TableHead>
                    <TableHead className="text-right">ホーム率</TableHead>
                    <TableHead className="text-right">保存率</TableHead>
                    <TableHead className="text-right">シェア率</TableHead>
                    <TableHead className="text-right">転換率</TableHead>
                    <TableHead className="text-right">プロフ率</TableHead>
                    <TableHead className="text-right">ストーリーズ</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">成約率</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {desc.map((e) => {
                    const r = computeWeeklyRates(e);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="sticky left-0 bg-card font-medium whitespace-nowrap">
                          {shortDate(e.weekStart)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.homeRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.saveRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.shareRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.followerConversionRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.profileVisitRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.storyViewRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.linkCtr)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(r.conversionRate)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => startEdit(e)}
                              aria-label="編集"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-bad"
                              onClick={() => setDeleteId(e.id)}
                              aria-label="削除"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
        title="この週のデータを削除しますか？"
        description="削除すると元に戻せません。"
        onConfirm={() => {
          if (deleteId) weeklyRepo.remove(deleteId);
          setDeleteId(null);
        }}
      />
    </div>
  );
}
