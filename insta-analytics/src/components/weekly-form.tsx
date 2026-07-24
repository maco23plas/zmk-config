"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computeWeeklyRates } from "@/lib/calc";
import { WEEKLY_RATE_META } from "@/lib/metrics";
import { numStr, parseNum, todayIso } from "@/lib/forms";
import { pct } from "@/lib/format";
import { makeId } from "@/lib/utils";
import type { WeeklyEntry } from "@/lib/types";

type NumKey = Exclude<
  keyof WeeklyEntry,
  "id" | "weekStart" | "createdAt" | "updatedAt"
>;

const FIELDS: { key: NumKey; label: string; hint?: string }[] = [
  { key: "followersStart", label: "週初フォロワー数" },
  { key: "newFollowers", label: "新規フォロワー数（純増）" },
  { key: "posts", label: "投稿数" },
  { key: "stories", label: "ストーリーズ本数" },
  { key: "views", label: "ビュー数" },
  { key: "reach", label: "リーチ" },
  { key: "followerReach", label: "うちフォロワーリーチ" },
  { key: "profileVisits", label: "プロフィールアクセス" },
  { key: "saves", label: "保存" },
  { key: "shares", label: "シェア（送信）" },
  { key: "linkClicks", label: "外部リンククリック" },
  { key: "storyViews", label: "ストーリーズ閲覧（平均）" },
  { key: "conversions", label: "CV数" },
];

type FormState = Record<NumKey, string>;

function emptyState(): FormState {
  return FIELDS.reduce((acc, f) => {
    acc[f.key] = "";
    return acc;
  }, {} as FormState);
}

function stateFromEntry(e: WeeklyEntry): FormState {
  return FIELDS.reduce((acc, f) => {
    acc[f.key] = numStr(e[f.key]);
    return acc;
  }, {} as FormState);
}

export function WeeklyForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: WeeklyEntry | null;
  onSubmit: (entry: WeeklyEntry) => void;
  onCancel?: () => void;
}) {
  // 親が key={editing?.id ?? "new"} で再マウントするため、
  // 初期化子で editing から一度だけ復元すれば十分（prop→state 同期の effect は不要）。
  const [weekStart, setWeekStart] = React.useState<string>(
    () => editing?.weekStart ?? todayIso(),
  );
  const [values, setValues] = React.useState<FormState>(() =>
    editing ? stateFromEntry(editing) : emptyState(),
  );

  const draft: WeeklyEntry = React.useMemo(() => {
    const now = new Date().toISOString();
    const base: WeeklyEntry = {
      id: editing?.id ?? "preview",
      weekStart,
      followersStart: null,
      newFollowers: null,
      posts: null,
      stories: null,
      views: null,
      reach: null,
      followerReach: null,
      profileVisits: null,
      saves: null,
      shares: null,
      linkClicks: null,
      storyViews: null,
      conversions: null,
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };
    for (const f of FIELDS) {
      base[f.key] = parseNum(values[f.key]);
    }
    return base;
  }, [values, weekStart, editing]);

  const rates = React.useMemo(() => computeWeeklyRates(draft), [draft]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...draft, id: editing?.id ?? makeId() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? "週次データを編集" : "週次データを追加"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label htmlFor="weekStart">週開始日</Label>
              <Input
                id="weekStart"
                type="date"
                required
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            </div>
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="any"
                  placeholder="—"
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          {/* 自動計算プレビュー */}
          <div className="rounded-xl bg-muted/60 p-4">
            <div className="text-xs font-medium text-muted-foreground mb-3">
              自動計算レート（プレビュー）
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3">
              {WEEKLY_RATE_META.map((m) => (
                <div key={m.key}>
                  <div className="text-[11px] text-muted-foreground">
                    {m.label}
                  </div>
                  <div className="text-sm font-semibold tabular">
                    {pct(rates[m.key])}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                キャンセル
              </Button>
            ) : null}
            <Button type="submit">{editing ? "更新する" : "追加する"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
