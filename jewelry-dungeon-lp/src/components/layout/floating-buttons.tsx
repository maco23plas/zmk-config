"use client";

import { useUi } from "@/components/ui/ui-context";
import styles from "./floating-buttons.module.css";

/** 右下のフローティングボタン（メニュー / トップへ戻る） */
export function FloatingButtons() {
  const { scrolled, toggleMenu } = useUi();

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <>
      <button
        type="button"
        className={styles.menu}
        onClick={toggleMenu}
        aria-label="メニューを開く"
        aria-haspopup="dialog"
      >
        <span className={styles.line} />
        <span className={styles.line} />
        <span className={styles.line} />
      </button>
      <button
        type="button"
        className={styles.top}
        data-visible={scrolled}
        onClick={toTop}
        aria-label="ページ上部へ"
        inert={!scrolled}
      >
        ↑
      </button>
    </>
  );
}
