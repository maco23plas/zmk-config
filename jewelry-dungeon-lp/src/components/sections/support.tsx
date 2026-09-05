import Image from "next/image";
import { asset } from "@/lib/asset";
import { cx } from "@/lib/cx";
import { Section } from "@/components/ui/section";
import { SeminarCtaButton } from "@/components/ui/cta-button";
import { LineLink } from "@/components/ui/line-link";
import styles from "./support.module.css";

/** 10 SUPPORT */
export function Support() {
  return (
    <Section id="support" className={styles.section}>
      <div className={styles.split}>
        <div className={styles.splitText}>
          <p className={styles.label}>SUPPORT</p>
          <h2 className={styles.title}>
            不安なことは
            <br />
            全て聞いてください
          </h2>
          <p className={styles.lead}>専門スタッフがあなたの疑問や不安に丁寧にお答えします。</p>
          <p className={styles.lead}>お気軽にご相談ください。</p>
        </div>
        <div className={styles.splitImg}>
          <Image
            src={asset("/parts/p-operator.png")}
            alt="サポートスタッフ"
            width={420}
            height={444}
            sizes="(min-width: 1024px) 520px, 50vw"
            className={styles.operator}
          />
        </div>
      </div>

      <div className={styles.cards}>
        <LineLink className={cx(styles.card, styles.cardLine)}>
          <span className={cx(styles.icon, styles.iconLine)} aria-hidden="true">
            LINE
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>LINEで相談する</span>
            <span className={styles.cardSub}>気軽にすぐに質問可能</span>
          </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
        </LineLink>
        <SeminarCtaButton className={cx(styles.card, styles.cardSeminar)}>
          <span className={cx(styles.icon, styles.iconSeminar)} aria-hidden="true">
            ▤
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>無料説明会に参加</span>
            <span className={styles.cardSub}>仕組みと初め方を知る</span>
          </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
        </SeminarCtaButton>
        <a href="#registration-guide" className={cx(styles.card, styles.cardRegister)}>
          <span className={cx(styles.icon, styles.iconRegister)} aria-hidden="true">
            ◇
          </span>
          <span className={styles.cardBody}>
            <span className={styles.cardTitle}>会員登録をする</span>
            <span className={styles.cardSub}>1分で登録が完了</span>
          </span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
        </a>
      </div>

      <div className={styles.consult}>
        <p className={styles.consultTitle}>まずは気軽に相談してみませんか？</p>
        <LineLink className={styles.lineBtn}>
          <span className={styles.lineIcon} aria-hidden="true">
            LINE
          </span>
          公式LINEで相談する
        </LineLink>
        <p className={styles.consultNote}>通常1営業日以内にご返信いたします。</p>
      </div>
    </Section>
  );
}
