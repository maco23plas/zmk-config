import { SeminarCtaButton } from "@/components/ui/cta-button";
import styles from "./free-session.module.css";

/** 15 FREE SESSION */
export function FreeSession() {
  return (
    <section id="session" className={styles.section}>
      <div className={styles.card}>
        <p className={styles.label}>FREE SESSION</p>
        <h2 className={styles.title}>まずは無料説明会で、仕組みを詳しく聞く。</h2>
        <p className={styles.text}>
          抽選予約、オーブの種類、P2P取引、石盤の仕組みまで。
          <br />
          はじめる前に知っておきたい内容を
          <br />
          無料説明会でわかりやすくご案内します。
        </p>
        <SeminarCtaButton className={styles.cta}>無料説明会に参加する　→</SeminarCtaButton>
        <div className={styles.rule} aria-hidden="true" />
      </div>
    </section>
  );
}
