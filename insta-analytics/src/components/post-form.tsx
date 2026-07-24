"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { computePostRates, suggestVerdict } from "@/lib/calc";
import { useSettings } from "@/lib/store";
import { numStr, parseNum, todayIso } from "@/lib/forms";
import { pct } from "@/lib/format";
import { makeId } from "@/lib/utils";
import type { PostEntry, PostFormat, PostVerdict } from "@/lib/types";

const FORMATS: PostFormat[] = [
  "リール",
  "カルーセル",
  "フィード単枚",
  "ストーリーズ",
  "ライブ",
];
const VERDICTS: PostVerdict[] = ["勝ち", "普通", "負け"];

type NumKey =
  | "views"
  | "reach"
  | "nonFollowerReachPct"
  | "videoSec"
  | "avgWatchSec"
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "profileVisits"
  | "follows";

const NUM_FIELDS: { key: NumKey; label: string }[] = [
  { key: "views", label: "ビュー数" },
  { key: "reach", label: "リーチ" },
  { key: "nonFollowerReachPct", label: "フォロワー外リーチ率（%）" },
  { key: "videoSec", label: "動画尺（秒）" },
  { key: "avgWatchSec", label: "平均視聴時間（秒）" },
  { key: "likes", label: "いいね" },
  { key: "comments", label: "コメント" },
  { key: "saves", label: "保存" },
  { key: "shares", label: "シェア" },
  { key: "profileVisits", label: "プロフィールアクセス" },
  { key: "follows", label: "フォロー数" },
];

type NumState = Record<NumKey, string>;

function emptyNums(): NumState {
  return NUM_FIELDS.reduce((acc, f) => {
    acc[f.key] = "";
    return acc;
  }, {} as NumState);
}

function numsFromEntry(e: PostEntry): NumState {
  return NUM_FIELDS.reduce((acc, f) => {
    acc[f.key] = numStr(e[f.key]);
    return acc;
  }, {} as NumState);
}

export function PostForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: PostEntry | null;
  onSubmit: (entry: PostEntry) => void;
  onCancel?: () => void;
}) {
  const settings = useSettings();
  // 親が key={editing?.id ?? "new"} で再マウントするため、初期化子で一度だけ復元する。
  const [date, setDate] = React.useState(() => editing?.date ?? todayIso());
  const [format, setFormat] = React.useState<PostFormat>(
    () => editing?.format ?? "リール",
  );
  const [title, setTitle] = React.useState(() => editing?.title ?? "");
  const [hook, setHook] = React.useState(() => editing?.hook ?? "");
  const [memo, setMemo] = React.useState(() => editing?.memo ?? "");
  const [verdict, setVerdict] = React.useState<PostVerdict>(
    () => editing?.verdict ?? "普通",
  );
  const [nums, setNums] = React.useState<NumState>(() =>
    editing ? numsFromEntry(editing) : emptyNums(),
  );

  const draft: PostEntry = React.useMemo(() => {
    const now = new Date().toISOString();
    return {
      id: editing?.id ?? "preview",
      date,
      format,
      title,
      hook,
      memo,
      verdict,
      views: parseNum(nums.views),
      reach: parseNum(nums.reach),
      nonFollowerReachPct: parseNum(nums.nonFollowerReachPct),
      videoSec: parseNum(nums.videoSec),
      avgWatchSec: parseNum(nums.avgWatchSec),
      likes: parseNum(nums.likes),
      comments: parseNum(nums.comments),
      saves: parseNum(nums.saves),
      shares: parseNum(nums.shares),
      profileVisits: parseNum(nums.profileVisits),
      follows: parseNum(nums.follows),
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };
  }, [date, format, title, hook, memo, verdict, nums, editing]);

  const rates = React.useMemo(() => computePostRates(draft), [draft]);
  const suggestion = React.useMemo(
    () => suggestVerdict(rates, settings.verdict),
    [rates, settings.verdict],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...draft, id: editing?.id ?? makeId() });
  };

  const rateItems: { label: string; value: number | null }[] = [
    { label: "維持率", value: rates.retentionRate },
    { label: "いいね率", value: rates.likeRate },
    { label: "保存率", value: rates.saveRate },
    { label: "シェア率", value: rates.shareRate },
    { label: "プロフ率", value: rates.profileVisitRate },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? "投稿を編集" : "投稿を追加"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">投稿日</Label>
              <Input
                id="date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>形式</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as PostFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="title">企画名</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：朝ルーティン時短術"
              />
            </div>
            <div className="space-y-1.5 col-span-2 sm:col-span-4">
              <Label htmlFor="hook">フック（冒頭文言）</Label>
              <Input
                id="hook"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                placeholder="例：実は9割が損してる朝の3分"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {NUM_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="any"
                  placeholder="—"
                  value={nums[f.key]}
                  onChange={(e) =>
                    setNums((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          {/* 自動計算プレビュー + サジェスト */}
          <div className="rounded-xl bg-muted/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                自動計算レート（プレビュー）
              </span>
              {suggestion ? (
                <Badge variant={suggestion === "勝ち候補" ? "ok" : "bad"}>
                  サジェスト：{suggestion}
                </Badge>
              ) : null}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-2">
              {rateItems.map((it) => (
                <div key={it.label}>
                  <div className="text-[11px] text-muted-foreground">
                    {it.label}
                  </div>
                  <div className="text-sm font-semibold tabular">
                    {pct(it.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-start">
            <div className="space-y-1.5">
              <Label>判定（最終）</Label>
              <Select
                value={verdict}
                onValueChange={(v) => setVerdict(v as PostVerdict)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERDICTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memo">学びメモ</Label>
              <Textarea
                id="memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="勝ち／負けの理由、横展開のアイデアなど"
              />
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
