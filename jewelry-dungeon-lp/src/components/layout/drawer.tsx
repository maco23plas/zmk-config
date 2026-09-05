"use client";

import { useEffect, useRef } from "react";
import { drawerNavItems } from "@/lib/content";
import { useUi } from "@/components/ui/ui-context";
import { SeminarCtaButton } from "@/components/ui/cta-button";
import styles from "./drawer.module.css";

/** 右スライドインのドロワーメニュー */
export function Drawer() {
  const { menuOpen, closeMenu } = useUi();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 開いたら閉じるボタンへフォーカス、閉じたら元の要素へ戻す
  useEffect(() => {
    if (menuOpen) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      closeButtonRef.current?.focus();
    } else {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    }
  }, [menuOpen]);

  return (
    <>
      <div
        className={styles.overlay}
        data-open={menuOpen}
        onClick={closeMenu}
        aria-hidden="true"
      />
      <aside
        className={styles.drawer}
        data-open={menuOpen}
        role="dialog"
        aria-modal="true"
        aria-label="メニュー"
        inert={!menuOpen}
      >
        <div className={styles.head}>
          <span className={styles.title}>MENU</span>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.close}
            onClick={closeMenu}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
        <nav className={styles.nav} aria-label="メニュー">
          {drawerNavItems.map((item) => (
            <a key={item.href} href={item.href} className={styles.item} onClick={closeMenu}>
              <span className={styles.itemNo}>{item.no}</span>
              <span className={styles.itemLabel}>{item.label}</span>
              <span className={styles.itemChevron} aria-hidden="true">
                ›
              </span>
            </a>
          ))}
        </nav>
        <div className={styles.foot}>
          <SeminarCtaButton className={styles.primary}>無料説明会に参加する</SeminarCtaButton>
          <a href="#registration-guide" className={styles.secondary} onClick={closeMenu}>
            会員登録のご案内
          </a>
        </div>
      </aside>
    </>
  );
}
