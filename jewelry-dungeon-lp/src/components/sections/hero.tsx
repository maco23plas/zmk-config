"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { useUi } from "@/components/ui/ui-context";
import styles from "./hero.module.css";

/** 01 HERO（FV）。可視率 35% 未満で固定ヘッダーを表示 */
export function Hero() {
  const { toggleMenu, setScrolled } = useUi();
  const visualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = visualRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setScrolled(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setScrolled(entry.intersectionRatio < 0.35);
        }
      },
      { threshold: [0, 0.35, 0.7, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [setScrolled]);

  return (
    <section className={styles.hero} aria-label="ファーストビュー">
      <h1 className="sr-only">隙間時間から始める、令和の新しいデジタル物販｜ジュエリーダンジョン</h1>
      <div ref={visualRef} className={styles.visual}>
        <Image
          src="/assets/fv-mobile-top.png"
          alt="隙間時間から始める、令和の新しいデジタル物販。オーブを購入し、会員同士で売買することで売却の差益を目指す、新しい収益のカタチ。スマホで完結／1日5分／在庫・仕入れなし"
          width={864}
          height={1246}
          priority
          sizes="(min-width: 560px) 560px, 100vw"
          className={styles.visualImg}
        />
        <button
          type="button"
          className={styles.menuHotspot}
          onClick={toggleMenu}
          aria-label="メニュー"
          aria-haspopup="dialog"
        />
      </div>
      <div className={styles.panel}>
        <a href="#registration-guide" className={styles.btnPrimary}>
          <span className={styles.btnSmall}>今すぐ始めたい方</span>
          <span className={styles.btnLarge}>無料会員登録</span>
          <span className={styles.btnArrow} aria-hidden="true">
            →
          </span>
        </a>
        <a href="#session" className={styles.btnSecondary}>
          <span className={styles.btnSmallSecondary}>まずは詳しく知りたい方</span>
          <span className={styles.btnLarge}>無料説明会に参加</span>
          <span className={styles.btnArrow} aria-hidden="true">
            →
          </span>
        </a>
        <p className={styles.safe}>
          <Image
            src="/parts/shield-mini.png"
            alt=""
            width={42}
            height={46}
            className={styles.safeIcon}
          />
          安心してご利用いただける環境を整えています
        </p>
        <div className={styles.rule} aria-hidden="true" />
        <p className={styles.desc}>
          ジュエリーダンジョンは、「オーブ」というデジタル商品を
          <br />
          会員同士で売買するP2Pプラットフォームです。
        </p>
      </div>
    </section>
  );
}
