"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Images,
  Pencil,
  Plus,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/confirm";
import { PostForm } from "@/components/post-form";
import { useHydrated, usePosts, postsRepo } from "@/lib/store";
import { computePostRates } from "@/lib/calc";
import { intFmt, pct, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  PostEntry,
  PostFormat,
  PostRateKey,
  PostVerdict,
} from "@/lib/types";

const FORMAT_OPTIONS: (PostFormat | "all")[] = [
  "all",
  "リール",
  "カルーセル",
  "フィード単枚",
  "ストーリーズ",
  "ライブ",
];
const VERDICT_OPTIONS: (PostVerdict | "all")[] = ["all", "勝ち", "普通", "負け"];

type SortKey = "date" | "views" | PostRateKey;
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

const RATE_COLS: { key: PostRateKey; label: string }[] = [
  { key: "retentionRate", label: "維持率" },
  { key: "likeRate", label: "いいね率" },
  { key: "saveRate", label: "保存率" },
  { key: "shareRate", label: "シェア率" },
  { key: "profileVisitRate", label: "プロフ率" },
];

function verdictBadge(v: PostVerdict) {
  if (v === "勝ち") return <Badge variant="ok">勝ち</Badge>;
  if (v === "負け") return <Badge variant="bad">負け</Badge>;
  return <Badge variant="outline">普通</Badge>;
}

function compareNullable(
  a: number | null,
  b: number | null,
  dir: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // null は常に末尾
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function SortHead({
  label,
  sortKey,
  align = "right",
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  align?: "left" | "right";
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        {sort.key === sortKey ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

export default function PostsPage() {
  const posts = usePosts();
  const hydrated = useHydrated();

  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<PostEntry | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [formatFilter, setFormatFilter] = React.useState<PostFormat | "all">(
    "all",
  );
  const [verdictFilter, setVerdictFilter] = React.useState<
    PostVerdict | "all"
  >("all");
  const [sort, setSort] = React.useState<SortState>({
    key: "date",
    dir: "desc",
  });

  const rows = React.useMemo(() => {
    const withRates = posts.map((p) => ({ post: p, rates: computePostRates(p) }));
    const filtered = withRates.filter(
      ({ post }) =>
        (formatFilter === "all" || post.format === formatFilter) &&
        (verdictFilter === "all" || post.verdict === verdictFilter),
    );
    filtered.sort((x, y) => {
      const { key, dir } = sort;
      if (key === "date") {
        return dir === "asc"
          ? x.post.date.localeCompare(y.post.date)
          : y.post.date.localeCompare(x.post.date);
      }
      if (key === "views") {
        return compareNullable(x.post.views, y.post.views, dir);
      }
      return compareNullable(x.rates[key], y.rates[key], dir);
    });
    return filtered;
  }, [posts, formatFilter, verdictFilter, sort]);

  const wins = React.useMemo(
    () => posts.filter((p) => p.verdict === "勝ち"),
    [posts],
  );

  const toggleSort = (key: SortKey) => {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  };

  const startNew = () => {
    setEditing(null);
    setShowForm(true);
  };
  const startEdit = (p: PostEntry) => {
    setEditing(p);
    setShowForm(true);
    if (typeof window !== "undefined")
      window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handleSubmit = (p: PostEntry) => {
    postsRepo.upsert(p);
    setShowForm(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="投稿別分析"
        description="投稿ごとの数値からレートを自動計算。勝ち／負けをサジェストし、勝ちパターンをネタ帳として蓄積します。"
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
              投稿を追加
            </Button>
          )
        }
      />

      {showForm ? (
        <PostForm
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
      ) : posts.length === 0 && !showForm ? (
        <EmptyState
          icon={Images}
          title="投稿データがありません"
          description="「投稿を追加」から最初の投稿を記録してください。"
        >
          <Button onClick={startNew}>
            <Plus className="size-4" />
            投稿を追加
          </Button>
        </EmptyState>
      ) : posts.length > 0 ? (
        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">一覧</TabsTrigger>
            <TabsTrigger value="wins">
              勝ちパターン
              {wins.length > 0 ? (
                <span className="ml-1.5 tabular">({wins.length})</span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-36">
                    <Select
                      value={formatFilter}
                      onValueChange={(v) =>
                        setFormatFilter(v as PostFormat | "all")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FORMAT_OPTIONS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f === "all" ? "全形式" : f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <Select
                      value={verdictFilter}
                      onValueChange={(v) =>
                        setVerdictFilter(v as PostVerdict | "all")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VERDICT_OPTIONS.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v === "all" ? "全判定" : v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="text-xs text-muted-foreground tabular">
                    {rows.length}件
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortHead
                        label="投稿日"
                        sortKey="date"
                        align="left"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      <TableHead>企画 / 形式</TableHead>
                      <SortHead
                        label="ビュー"
                        sortKey="views"
                        sort={sort}
                        onSort={toggleSort}
                      />
                      {RATE_COLS.map((c) => (
                        <SortHead
                          key={c.key}
                          label={c.label}
                          sortKey={c.key}
                          sort={sort}
                          onSort={toggleSort}
                        />
                      ))}
                      <TableHead>判定</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ post, rates }) => (
                      <TableRow
                        key={post.id}
                        className={cn(
                          post.verdict === "勝ち" && "bg-ok-bg/40",
                          post.verdict === "負け" && "bg-bad-bg/40",
                        )}
                      >
                        <TableCell className="whitespace-nowrap font-medium">
                          {shortDate(post.date)}
                        </TableCell>
                        <TableCell className="min-w-40">
                          <div className="font-medium truncate max-w-52">
                            {post.title || "（無題）"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {post.format}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {intFmt(post.views)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(rates.retentionRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(rates.likeRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(rates.saveRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(rates.shareRate)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {pct(rates.profileVisitRate)}
                        </TableCell>
                        <TableCell>{verdictBadge(post.verdict)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              onClick={() => startEdit(post)}
                              aria-label="編集"
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-bad"
                              onClick={() => setDeleteId(post.id)}
                              aria-label="削除"
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wins">
            {wins.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="勝ち投稿がまだありません"
                description="判定を「勝ち」にした投稿が、横展開用のネタ帳としてここに並びます。"
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {wins.map((p) => {
                  const r = computePostRates(p);
                  return (
                    <Card key={p.id}>
                      <CardContent className="p-5 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="ok">勝ち</Badge>
                          <span className="text-xs text-muted-foreground">
                            {p.format}・{shortDate(p.date)}
                          </span>
                        </div>
                        <div>
                          <div className="font-semibold">
                            {p.title || "（無題）"}
                          </div>
                          {p.hook ? (
                            <div className="text-sm text-muted-foreground mt-0.5">
                              フック：{p.hook}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
                          <span>保存 {pct(r.saveRate)}</span>
                          <span>シェア {pct(r.shareRate)}</span>
                          <span>維持 {pct(r.retentionRate)}</span>
                          <span>いいね {pct(r.likeRate)}</span>
                        </div>
                        {p.memo ? (
                          <p className="text-sm leading-relaxed rounded-lg bg-muted/60 p-3">
                            {p.memo}
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      ) : null}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteId(null);
        }}
        title="この投稿を削除しますか？"
        description="削除すると元に戻せません。"
        onConfirm={() => {
          if (deleteId) postsRepo.remove(deleteId);
          setDeleteId(null);
        }}
      />
    </div>
  );
}
