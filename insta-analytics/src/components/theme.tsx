"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";
const THEME_KEY = "insta-analytics-2026:theme";

/* テーマは <html> の .dark クラス（＋localStorage）を唯一の情報源とし、
   useSyncExternalStore で購読する（effect 内 setState を避け、SSR セーフ）。
   初回描画前の .dark 付与は layout.tsx の head スクリプトが担当する。 */

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setTheme(next: Theme): void {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** ThemeProvider は互換のためのパススルー（状態は外部ストアで保持）。 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStoreTheme();
  return {
    theme,
    toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
  };
}

function useSyncExternalStoreTheme(): Theme {
  return React.useSyncExternalStore(
    subscribe,
    currentTheme,
    () => "light" as Theme,
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="テーマを切り替え"
      title="ライト / ダーク切り替え"
    >
      {theme === "dark" ? (
        <Sun className="size-5" />
      ) : (
        <Moon className="size-5" />
      )}
    </Button>
  );
}
