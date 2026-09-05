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

export type ModalKind = "seminar" | "line";

interface UiContextValue {
  /** ドロワーメニュー開閉 */
  menuOpen: boolean;
  /** モーダル種別（null = 非表示） */
  modal: ModalKind | null;
  /** 申込フォーム送信完了 */
  submitted: boolean;
  /** FV を抜けたか（固定ヘッダー / トップへ戻るボタンの表示制御） */
  scrolled: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
  openModal: (kind: ModalKind) => void;
  closeModal: () => void;
  markSubmitted: () => void;
  setScrolled: (value: boolean) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const toggleMenu = useCallback(() => setMenuOpen((v) => !v), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const openModal = useCallback((kind: ModalKind) => {
    setModal(kind);
    setSubmitted(false);
    setMenuOpen(false);
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const markSubmitted = useCallback(() => setSubmitted(true), []);

  // Esc でメニュー・モーダルを同時に閉じる
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // オーバーレイ表示中は背面のスクロールを止める
  useEffect(() => {
    const locked = menuOpen || modal !== null;
    document.body.style.overflow = locked ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen, modal]);

  const value = useMemo<UiContextValue>(
    () => ({
      menuOpen,
      modal,
      submitted,
      scrolled,
      toggleMenu,
      closeMenu,
      openModal,
      closeModal,
      markSubmitted,
      setScrolled,
    }),
    [menuOpen, modal, submitted, scrolled, toggleMenu, closeMenu, openModal, closeModal, markSubmitted],
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
