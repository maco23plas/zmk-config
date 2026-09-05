"use client";

import { SeminarCtaButton } from "@/components/ui/cta-button";
import styles from "./bottom-bar.module.css";

/** 下部固定CTAバー（ゴールドボタン1本のみ） */
export function BottomBar() {
  return (
    <div className={styles.bar}>
      <div className={styles.inner}>
        <SeminarCtaButton className={styles.button}>無料説明会に参加する</SeminarCtaButton>
      </div>
    </div>
  );
}
