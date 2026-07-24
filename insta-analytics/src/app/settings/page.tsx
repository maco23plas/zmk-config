"use client";

import * as React from "react";
import {
  Download,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm";
import {
  buildExportBundle,
  clearAllData,
  importBundle,
  settingsRepo,
  useHydrated,
  useSettings,
} from "@/lib/store";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { weeklyRepo, postsRepo } from "@/lib/store";
import { weeklyToCsv, postsToCsv, downloadText } from "@/lib/csv";
import { todayIso } from "@/lib/forms";
import type {
  BenchmarkKey,
  Settings,
  VerdictThresholds,
} from "@/lib/types";

const BENCHMARK_ROWS: { key: BenchmarkKey; label: string }[] = [
  { key: "homeRate", label: "ホーム率" },
  { key: "saveRate", label: "保存率" },
  { key: "shareRate", label: "シェア率" },
  { key: "followerConversionRate", label: "フォロワー転換率" },
  { key: "storyViewRate", label: "ストーリーズ閲覧率" },
  { key: "profileVisitRate", label: "プロフアクセス率" },
];

const VERDICT_ROWS: { key: keyof VerdictThresholds; label: string }[] = [
  { key: "winSaveRate", label: "勝ち：保存率 ≥" },
  { key: "winShareRate", label: "勝ち：シェア率 ≥" },
  { key: "loseSaveRate", label: "負け：保存率 <" },
  { key: "loseShareRate", label: "負け：シェア率 <" },
  { key: "loseLikeRate", label: "負け：いいね率 <" },
];

/** 比率(0〜1) → パーセント数（表示・編集用）。 */
function toPct(r: number): number {
  return Math.round(r * 1000) / 10;
}
/** パーセント入力 → 比率。空・不正は 0。 */
function fromPct(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n / 100 : 0;
}

export default function SettingsPage() {
  const settings = useSettings();
  const hydrated = useHydrated();
  // 未編集(!dirty)のときはストアの値をそのまま表示し、編集を始めた時点で draft を確定する。
  // これにより「外部→state 同期の effect」を持たずにハイドレーション後の値も反映できる。
  const [draft, setDraft] = React.useState<Settings>(settings);
  const [dirty, setDirty] = React.useState(false);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const effective = dirty ? draft : settings;

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(null), 2500);
  };

  const setBenchmark = (
    key: BenchmarkKey,
    field: "good" | "warn",
    value: string,
  ) => {
    const base = dirty ? draft : settings;
    setDraft({
      ...base,
      benchmarks: {
        ...base.benchmarks,
        [key]: { ...base.benchmarks[key], [field]: fromPct(value) },
      },
    });
    setDirty(true);
  };

  const setVerdict = (key: keyof VerdictThresholds, value: string) => {
    const base = dirty ? draft : settings;
    setDraft({
      ...base,
      verdict: { ...base.verdict, [key]: fromPct(value) },
    });
    setDirty(true);
  };

  const save = () => {
    settingsRepo.set(draft);
    setDirty(false);
    flash("設定を保存しました");
  };
  const resetDefaults = () => {
    setDraft(DEFAULT_SETTINGS);
    settingsRepo.set(DEFAULT_SETTINGS);
    setDirty(false);
    flash("初期値に戻しました");
  };

  const exportJson = () => {
    const bundle = buildExportBundle(new Date().toISOString());
    downloadText(
      `insta-analytics-${todayIso()}.json`,
      JSON.stringify(bundle, null, 2),
      "application/json",
    );
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        importBundle(parsed);
        flash("データを読み込みました");
      } catch {
        flash("読み込みに失敗しました（JSON形式を確認してください）");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="設定"
        description="目安値（ベンチマーク）と判定サジェストのしきい値を調整できます。すべてローカル（この端末）にのみ保存されます。"
        action={
          note ? (
            <span className="text-sm text-ok font-medium">{note}</span>
          ) : undefined
        }
      />

      {!hydrated ? (
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      ) : (
        <>
          {/* ベンチマーク */}
          <Card>
            <CardHeader>
              <CardTitle>目安値（ベンチマーク）</CardTitle>
              <CardDescription>
                達成ライン以上で「達成（緑）」、注意ライン以上〜達成未満で「注意（黄）」、それ未満で「未達（赤）」。単位は%。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-xs text-muted-foreground font-medium">
                <span>指標</span>
                <span className="w-24 text-center">達成ライン(%)</span>
                <span className="w-24 text-center">注意ライン(%)</span>
              </div>
              {BENCHMARK_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2"
                >
                  <Label className="text-sm">{row.label}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-24 text-right"
                    value={toPct(effective.benchmarks[row.key].good)}
                    onChange={(e) =>
                      setBenchmark(row.key, "good", e.target.value)
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-24 text-right"
                    value={toPct(effective.benchmarks[row.key].warn)}
                    onChange={(e) =>
                      setBenchmark(row.key, "warn", e.target.value)
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 判定しきい値 */}
          <Card>
            <CardHeader>
              <CardTitle>勝ち／負け 判定サジェストのしきい値</CardTitle>
              <CardDescription>
                投稿別分析での「勝ち候補／負け候補」バッジの判定基準。単位は%。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {VERDICT_ROWS.map((row) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4"
                >
                  <Label className="text-sm">{row.label}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-24 text-right"
                    value={toPct(effective.verdict[row.key])}
                    onChange={(e) => setVerdict(row.key, e.target.value)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={!dirty}>
              <Save className="size-4" />
              設定を保存
            </Button>
            <Button variant="outline" onClick={resetDefaults}>
              <RotateCcw className="size-4" />
              初期値に戻す
            </Button>
          </div>

          {/* データ管理 */}
          <Card>
            <CardHeader>
              <CardTitle>データ管理</CardTitle>
              <CardDescription>
                バックアップ・移行用のエクスポート／インポート、CSV出力、全削除。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={exportJson}>
                  <Download className="size-4" />
                  全データJSON書き出し
                </Button>
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-4" />
                  JSON読み込み
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImport}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      `weekly-${todayIso()}.csv`,
                      weeklyToCsv(weeklyRepo.all()),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <Download className="size-4" />
                  週次CSV
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    downloadText(
                      `posts-${todayIso()}.csv`,
                      postsToCsv(postsRepo.all()),
                      "text/csv;charset=utf-8",
                    )
                  }
                >
                  <Download className="size-4" />
                  投稿別CSV
                </Button>
              </div>
              <div className="pt-2 border-t border-border">
                <Button
                  variant="destructive"
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 className="size-4" />
                  全データを削除
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="すべてのデータを削除しますか？"
        description="週次・投稿別・診断チェックがすべて消え、設定は初期値に戻ります。この操作は元に戻せません。念のため先にJSON書き出しをおすすめします。"
        confirmLabel="すべて削除する"
        onConfirm={() => {
          clearAllData();
          setDraft(DEFAULT_SETTINGS);
          setDirty(false);
          flash("全データを削除しました");
        }}
      />
    </div>
  );
}
