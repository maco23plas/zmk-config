"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  LayoutDashboard,
  Images,
  Settings,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "ダッシュボード", icon: LayoutDashboard },
  { href: "/weekly", label: "週次分析", icon: CalendarDays },
  { href: "/posts", label: "投稿別分析", icon: Images },
  { href: "/diagnosis", label: "診断フロー", icon: Stethoscope },
  { href: "/kpis", label: "KPI辞典", icon: BookOpen },
  { href: "/settings", label: "設定", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground font-bold shadow-sm">
        イ
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold">インスタ分析思考</div>
        <div className="text-[11px] text-muted-foreground tabular">2026</div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      {/* デスクトップ：左サイドバー */}
      <aside className="hidden md:flex md:flex-col md:sticky md:top-0 md:h-dvh border-r border-border bg-card/60 backdrop-blur">
        <div className="px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon className="size-[18px]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border flex items-center justify-between">
          <span className="px-2 text-xs text-muted-foreground">
            ローカル保存のみ
          </span>
          <ThemeToggle />
        </div>
      </aside>

      {/* メイン */}
      <div className="flex min-w-0 flex-col">
        {/* モバイル：上部バー */}
        <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 border-b border-border bg-card/80 backdrop-blur">
          <Logo />
          <ThemeToggle />
        </header>

        <main className="flex-1 min-w-0 px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>

      {/* モバイル：ボトムナビ */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/90 backdrop-blur">
        <div className="grid grid-cols-6">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <item.icon className="size-5" />
                <span className="leading-none">{item.label.replace("分析", "")}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
