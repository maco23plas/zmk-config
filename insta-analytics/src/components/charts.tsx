"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { pct } from "@/lib/format";

export interface RatePoint {
  label: string; // X 軸ラベル（例: 7/20）
  value: number | null; // レート（0〜1）
}

/** ダッシュボードのスパークライン（軸なし・小型）。 */
export function Sparkline({
  data,
  color = "var(--chart-1)",
}: {
  data: RatePoint[];
  color?: string;
}) {
  const points = data.map((d) => ({ ...d, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={44}>
      <LineChart data={points} margin={{ top: 4, bottom: 4, left: 2, right: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface TooltipEntry {
  value: number | null;
  name?: string;
}

function RateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0]?.value ?? null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-soft">
      <div className="text-muted-foreground mb-0.5">{label}</div>
      <div className="font-semibold tabular">{pct(v)}</div>
    </div>
  );
}

/** レートの折れ線グラフ。benchmark を渡すと点線で目安ラインを重ねる。 */
export function RateLineChart({
  data,
  color = "var(--chart-1)",
  benchmark,
  benchmarkLabel = "目安",
  height = 260,
}: {
  data: RatePoint[];
  color?: string;
  benchmark?: number | null;
  benchmarkLabel?: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip content={<RateTooltip />} />
        {typeof benchmark === "number" ? (
          <ReferenceLine
            y={benchmark}
            stroke="var(--warn)"
            strokeDasharray="5 4"
            label={{
              value: benchmarkLabel,
              position: "right",
              fill: "var(--warn)",
              fontSize: 11,
            }}
          />
        ) : null}
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2.5}
          dot={{ r: 3, fill: color, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
