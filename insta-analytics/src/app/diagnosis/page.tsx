"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, RotateCcw, Stethoscope } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryBadge, PageHeader } from "@/components/common";
import {
  DIAGNOSIS_KPIS,
  diagnosisFor,
  statesForKpi,
} from "@/lib/data";
import { useChecks, checksRepo } from "@/lib/store";
import { shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Diagnosis } from "@/lib/types";

function StepBadge({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
        {n}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

function DiagnosisCard({ d }: { d: Diagnosis }) {
  const checks = useChecks();
  const check = checks.find((c) => c.diagnosisId === d.id);
  const checked = Boolean(check);

  return (
    <Card className={cn(checked && "border-ok/40 bg-ok-bg/30")}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold leading-snug">{d.checkpoint}</h3>
            <CategoryBadge category={d.category} />
          </div>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
          {d.action}
        </p>
        {d.criteria ? (
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            {d.criteria}
          </p>
        ) : null}
        <label className="mt-4 flex items-center gap-2.5 cursor-pointer select-none w-fit">
          <Checkbox
            checked={checked}
            onCheckedChange={() =>
              checksRepo.toggle(d.id, new Date().toISOString())
            }
          />
          <span className="text-sm">
            {checked ? (
              <span className="text-ok font-medium">
                ✓ 試した（{check ? shortDate(check.checkedAt.slice(0, 10)) : ""}）
              </span>
            ) : (
              <span className="text-muted-foreground">試した施策にする</span>
            )}
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function DiagnosisInner() {
  const params = useSearchParams();
  const initialKpi = params.get("kpi");
  const initialState = params.get("state");

  const [kpi, setKpi] = React.useState<string | null>(
    initialKpi && DIAGNOSIS_KPIS.includes(initialKpi as never)
      ? initialKpi
      : null,
  );
  const [state, setState] = React.useState<string | null>(() => {
    if (
      initialKpi &&
      initialState &&
      statesForKpi(initialKpi).includes(initialState)
    ) {
      return initialState;
    }
    return null;
  });

  const states = kpi ? statesForKpi(kpi) : [];
  const cards = kpi && state ? diagnosisFor(kpi, state) : [];

  const selectKpi = (k: string) => {
    setKpi(k);
    setState(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="診断フロー"
        description="① KPIを選ぶ → ② 状態を選ぶ → ③ 該当する打ち手を確認。試した施策はチェックして記録できます。"
        action={
          kpi ? (
            <Button
              variant="ghost"
              onClick={() => {
                setKpi(null);
                setState(null);
              }}
            >
              <RotateCcw className="size-4" />
              最初から
            </Button>
          ) : undefined
        }
      />

      {/* ① KPI */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <StepBadge n={1} label="KPIを選ぶ" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DIAGNOSIS_KPIS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => selectKpi(k)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-sm font-medium text-center transition-colors",
                  kpi === k
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ② 状態 */}
      {kpi ? (
        <Card>
          <CardContent className="p-5 space-y-4">
            <StepBadge n={2} label="状態を選ぶ" />
            <div className="flex flex-wrap gap-2">
              {states.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(s)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                    state === s
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ③ カード */}
      {kpi && state ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{kpi}</span>
            <ChevronRight className="size-4" />
            <span className="font-medium text-foreground">{state}</span>
            <span className="tabular">・{cards.length}件</span>
          </div>
          {cards.map((d) => (
            <DiagnosisCard key={d.id} d={d} />
          ))}
        </div>
      ) : kpi ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          状態を選ぶと打ち手が表示されます。
        </p>
      ) : (
        <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
          <Stethoscope className="size-8 mb-2" />
          <p className="text-sm">まずは詰まっているKPIを選んでください。</p>
        </div>
      )}
    </div>
  );
}

export default function DiagnosisPage() {
  return (
    <React.Suspense
      fallback={<div className="h-64 rounded-xl bg-muted animate-pulse" />}
    >
      <DiagnosisInner />
    </React.Suspense>
  );
}
