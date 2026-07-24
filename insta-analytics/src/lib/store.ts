"use client";

/* =========================================================================
   データアクセス層（localStorage 実装）
   - v1 は localStorage のみ。将来 Supabase 等へ差し替えやすいよう、
     「Store（購読可能な単一キー）」という薄い抽象に閉じ込める。
   - React 連携は useSyncExternalStore ベース（SSR セーフ）。
   ========================================================================= */

import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS } from "./defaults";
import type {
  DiagnosisCheck,
  ExportBundle,
  PostEntry,
  Settings,
  WeeklyEntry,
} from "./types";

const NS = "insta-analytics-2026";

export const STORAGE_KEYS = {
  weekly: `${NS}:weekly`,
  posts: `${NS}:posts`,
  settings: `${NS}:settings`,
  checks: `${NS}:checks`,
} as const;

type Listener = () => void;

/** 購読可能な単一キーのストア。localStorage を裏に持つ。 */
export interface Store<T> {
  get(): T;
  getServer(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: Listener): () => void;
}

function createStore<T>(key: string, initial: T): Store<T> {
  const listeners = new Set<Listener>();
  let cache: T = initial;
  let loaded = false;

  const read = (): T => {
    if (typeof window === "undefined") return initial;
    if (!loaded) {
      try {
        const raw = window.localStorage.getItem(key);
        cache = raw === null ? initial : (JSON.parse(raw) as T);
      } catch {
        cache = initial;
      }
      loaded = true;
    }
    return cache;
  };

  const write = (value: T): void => {
    cache = value;
    loaded = true;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 容量オーバー等は握りつぶす（UI 側で通知しても良い） */
    }
    listeners.forEach((l) => l());
  };

  // 別タブでの変更にも追随
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === key) {
        loaded = false;
        listeners.forEach((l) => l());
      }
    });
  }

  return {
    get: read,
    getServer: () => initial,
    set: (next) => {
      const prev = read();
      const value =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      write(value);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ---------- ストア実体 ---------- */

const weeklyStore = createStore<WeeklyEntry[]>(STORAGE_KEYS.weekly, []);
const postsStore = createStore<PostEntry[]>(STORAGE_KEYS.posts, []);
const settingsStore = createStore<Settings>(
  STORAGE_KEYS.settings,
  DEFAULT_SETTINGS,
);
const checksStore = createStore<DiagnosisCheck[]>(STORAGE_KEYS.checks, []);

/* ---------- 汎用フック ---------- */

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** ハイドレーション完了フラグ（空状態とローディングの出し分けに使う）。 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/* ---------- 公開 API：週次 ---------- */

export function useWeekly(): WeeklyEntry[] {
  return useStore(weeklyStore);
}
export const weeklyRepo = {
  all: () => weeklyStore.get(),
  set: (entries: WeeklyEntry[]) => weeklyStore.set(entries),
  upsert: (entry: WeeklyEntry) =>
    weeklyStore.set((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx === -1) return [...prev, entry];
      const copy = [...prev];
      copy[idx] = entry;
      return copy;
    }),
  remove: (id: string) =>
    weeklyStore.set((prev) => prev.filter((e) => e.id !== id)),
};

/* ---------- 公開 API：投稿別 ---------- */

export function usePosts(): PostEntry[] {
  return useStore(postsStore);
}
export const postsRepo = {
  all: () => postsStore.get(),
  set: (entries: PostEntry[]) => postsStore.set(entries),
  upsert: (entry: PostEntry) =>
    postsStore.set((prev) => {
      const idx = prev.findIndex((e) => e.id === entry.id);
      if (idx === -1) return [...prev, entry];
      const copy = [...prev];
      copy[idx] = entry;
      return copy;
    }),
  remove: (id: string) =>
    postsStore.set((prev) => prev.filter((e) => e.id !== id)),
};

/* ---------- 公開 API：設定 ---------- */

export function useSettings(): Settings {
  return useStore(settingsStore);
}
export const settingsRepo = {
  get: () => settingsStore.get(),
  set: (s: Settings) => settingsStore.set(s),
  reset: () => settingsStore.set(DEFAULT_SETTINGS),
};

/* ---------- 公開 API：診断チェック ---------- */

export function useChecks(): DiagnosisCheck[] {
  return useStore(checksStore);
}
export const checksRepo = {
  all: () => checksStore.get(),
  isChecked: (diagnosisId: number) =>
    checksStore.get().some((c) => c.diagnosisId === diagnosisId),
  toggle: (diagnosisId: number, isoDate: string) =>
    checksStore.set((prev) => {
      const exists = prev.some((c) => c.diagnosisId === diagnosisId);
      if (exists) return prev.filter((c) => c.diagnosisId !== diagnosisId);
      return [...prev, { diagnosisId, checkedAt: isoDate }];
    }),
};

/* ---------- エクスポート / インポート / 全削除 ---------- */

export function buildExportBundle(exportedAt: string): ExportBundle {
  return {
    app: "インスタ分析思考2026",
    version: 1,
    exportedAt,
    weekly: weeklyStore.get(),
    posts: postsStore.get(),
    settings: settingsStore.get(),
    checks: checksStore.get(),
  };
}

export function importBundle(bundle: ExportBundle): void {
  if (Array.isArray(bundle.weekly)) weeklyStore.set(bundle.weekly);
  if (Array.isArray(bundle.posts)) postsStore.set(bundle.posts);
  if (bundle.settings) settingsStore.set(bundle.settings);
  if (Array.isArray(bundle.checks)) checksStore.set(bundle.checks);
}

export function clearAllData(): void {
  weeklyStore.set([]);
  postsStore.set([]);
  checksStore.set([]);
  settingsStore.set(DEFAULT_SETTINGS);
}
