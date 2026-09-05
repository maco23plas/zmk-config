"use client";

import Image from "next/image";
import { asset } from "@/lib/asset";
import { headerNavItems } from "@/lib/content";
import { SITE_NAME, SITE_NAME_EN } from "@/lib/site";
import { useUi } from "@/components/ui/ui-context";
import { SeminarCtaButton } from "@/components/ui/cta-button";
import styles from "./site-header.module.css";

/** 固定ヘッダー。FV の可視率が 35% 未満になったら表示 */
export function SiteHeader() {
  const { scrolled, toggleMenu } = useUi();

  return (
    <header className={styles.header} data-visible={scrolled} inert={!scrolled}>
      <div className={styles.inner}>
        <a href="#top" className={styles.brand} aria-label={`${SITE_NAME} トップへ`}>
          <Image
            src={asset("/parts/orb-gold.png")}
            alt=""
            width={34}
            height={34}
            className={styles.brandLogo}
          />
          <span className={styles.brandText}>
            <span className={styles.brandName}>{SITE_NAME_EN}</span>
            <span className={styles.brandSub}>{SITE_NAME}</span>
          </span>
        </a>
        <nav className={styles.nav} aria-label="グローバルナビゲーション">
          {headerNavItems.map((item) => (
            <a key={item.href} href={item.href} className={styles.navLink}>
              {item.label}
            </a>
          ))}
          <SeminarCtaButton className={styles.navCta}>無料説明会に参加する</SeminarCtaButton>
          <button
            type="button"
            className={styles.burger}
            onClick={toggleMenu}
            aria-label="メニュー"
            aria-haspopup="dialog"
          >
            <span className={styles.burgerLine} />
            <span className={styles.burgerLine} />
            <span className={styles.burgerLine} />
          </button>
        </nav>
      </div>
    </header>
  );
}
