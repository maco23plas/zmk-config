"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface UiContextValue {
  /** ドロワーメニュー開閉 */
  menuOpen: boolean;
  /** FV を抜けたか（固定ヘッダーの表示制御） */
  scrolled: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
  setScrolled: (value: boolean) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Esc でメニューを閉じる
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ドロワー表示中は背面のスクロールを止める
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const value = useMemo<UiContextValue>(
    () => ({ menuOpen, scrolled, toggleMenu, closeMenu, setScrolled }),
    [menuOpen, scrolled, toggleMenu, closeMenu],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) {
    throw new Error("useUi は UiProvider の内側で使用してください");
  }
  return ctx;
}
