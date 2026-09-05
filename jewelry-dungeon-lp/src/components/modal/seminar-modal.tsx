"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useUi } from "@/components/ui/ui-context";
import { submitSeminarForm } from "@/lib/seminar-form";
import styles from "./seminar-modal.module.css";

/**
 * モーダル（3状態）
 * 1. 申込フォーム（modal = "seminar", submitted = false）
 * 2. 送信完了（modal = "seminar", submitted = true）
 * 3. 公式LINE案内（modal = "line"）
 */
export function SeminarModal() {
  const { modal, submitted, closeModal, markSubmitted } = useUi();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [sending, setSending] = useState(false);

  const open = modal !== null;

  // 開いたときの要素を記憶し、閉じたら元の要素へフォーカスを戻す
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open]);

  // 表示内容（フォーム / 完了 / LINE案内）が変わるたびに最初のフォーカス可能要素へ
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(
      "input, button:not([data-close]), [href], select, textarea",
    );
    (first ?? panel)?.focus();
  }, [open, modal, submitted]);

  // Tab のフォーカスをモーダル内に閉じ込める
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        "input, button, [href], select, textarea, [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    try {
      // TODO(送信先未定): submitSeminarForm は現状空実装。接続後はエラー表示も追加する
      await submitSeminarForm({
        name: String(data.get("name") ?? ""),
        email: String(data.get("email") ?? ""),
      });
      markSubmitted();
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const isLine = modal === "line";
  const eyebrow = isLine ? "OFFICIAL LINE" : "FREE SESSION";
  const title = isLine ? "公式LINEのご案内" : "無料説明会のお申し込み";

  return (
    <div className={styles.root} onKeyDown={onKeyDown}>
      <div className={styles.backdrop} onClick={closeModal} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.close}
          onClick={closeModal}
          aria-label="閉じる"
          data-close
        >
          ✕
        </button>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h3 id={titleId} className={styles.title}>
          {title}
        </h3>

        {isLine ? (
          <div className={styles.line}>
            <p className={styles.lineText}>
              公式LINEに「<strong>ダンジョン</strong>」と送ってください。ご案内をお送りします。
            </p>
            <div className={styles.lineCard}>
              <p className={styles.lineCardLabel}>送信するメッセージ</p>
              <p className={styles.lineCardValue}>ダンジョン</p>
            </div>
            <button type="button" className={styles.primaryWide} onClick={closeModal}>
              閉じる
            </button>
          </div>
        ) : submitted ? (
          <div className={styles.done} role="status">
            <div className={styles.doneIcon} aria-hidden="true">
              ✓
            </div>
            <p className={styles.doneTitle}>送信が完了しました</p>
            <p className={styles.doneText}>
              通常1営業日以内にご連絡いたします。
              <br />
              お気軽にお待ちください。
            </p>
            <button type="button" className={styles.primary} onClick={closeModal}>
              閉じる
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={onSubmit} noValidate={false}>
            <label className={styles.field}>
              お名前
              <input
                type="text"
                name="name"
                placeholder="山田 太郎"
                autoComplete="name"
                className={styles.input}
              />
            </label>
            <label className={styles.field}>
              メールアドレス
              <input
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                className={styles.input}
              />
            </label>
            <button type="submit" className={styles.submit} disabled={sending}>
              無料説明会に申し込む
            </button>
            <p className={styles.formNote}>
              無理な勧誘は一切ありません。
              <br />
              ご入力内容はプライバシーポリシーに基づき取り扱います。
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
