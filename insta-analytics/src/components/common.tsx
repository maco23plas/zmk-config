import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";
import type { RateStatus } from "@/lib/calc";

/** ページ共通のヘッダー（タイトル・説明・任意のアクション）。 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const CATEGORY_VARIANT: Record<Category, "keep" | "update" | "new"> = {
  継続: "keep",
  更新: "update",
  新規: "new",
};

/** 継続=グレー / 更新=青 / 新規=アンバー のカテゴリバッジ。 */
export function CategoryBadge({ category }: { category: Category }) {
  return <Badge variant={CATEGORY_VARIANT[category]}>{category}</Badge>;
}

const STATUS_VARIANT: Record<
  Exclude<RateStatus, "none">,
  "ok" | "warn" | "bad"
> = {
  good: "ok",
  warn: "warn",
  bad: "bad",
};

const STATUS_LABEL: Record<Exclude<RateStatus, "none">, string> = {
  good: "達成",
  warn: "注意",
  bad: "未達",
};

/** レートの3色ステータスバッジ。 */
export function StatusBadge({ status }: { status: RateStatus }) {
  if (status === "none") {
    return <Badge variant="outline">—</Badge>;
  }
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

const STATUS_DOT: Record<RateStatus, string> = {
  good: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  none: "bg-muted-foreground/40",
};

/** レートステータスの小さなドット。 */
export function StatusDot({ status }: { status: RateStatus }) {
  return (
    <span
      className={cn("inline-block size-2 rounded-full", STATUS_DOT[status])}
    />
  );
}

/** 空状態 UI。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground mb-4">
        <Icon className="size-7" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}

/** 「診断フローを見る →」等の内部リンクボタン。 */
export function LinkButton({
  href,
  children,
  variant = "outline",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "secondary";
}) {
  return (
    <Button asChild variant={variant} size="sm">
      <Link href={href}>
        {children}
        <ArrowUpRight className="size-4" />
      </Link>
    </Button>
  );
}
