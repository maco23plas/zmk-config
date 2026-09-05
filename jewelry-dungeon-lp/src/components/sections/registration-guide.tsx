import { cx } from "@/lib/cx";
import { Section, SectionHead } from "@/components/ui/section";
import { LineLink } from "@/components/ui/line-link";
import styles from "./registration-guide.module.css";

/** 14 REGISTRATION GUIDE */
export function RegistrationGuide() {
  return (
    <Section id="registration-guide" className={styles.section}>
      <SectionHead
        label="REGISTRATION"
        title="会員登録は招待リンクから"
        lead={
          <>
            ジュエリーダンジョンの会員登録は、
            <br />
            紹介者からお送りする招待リンクからお進みいただきます。
          </>
        }
        leadVariant="alt"
      />
      <div className={styles.grid}>
        <div className={styles.card}>
          <h3 className={styles.title}>紹介者がいる方</h3>
          <p className={styles.text}>
            紹介者からの招待リンクをお持ちの方は、届いたリンクから登録ください。
          </p>
        </div>
        <div className={cx(styles.card, styles.cardGold)}>
          <h3 className={styles.title}>紹介者がいない方</h3>
          <p className={cx(styles.text, styles.textCenter)}>
            紹介者がいない場合は、公式LINEに「ダンジョン」と送ってください。ご案内をお送りします。
          </p>
          <LineLink className={styles.lineBtn}>LINEで「ダンジョン」と送る</LineLink>
        </div>
      </div>
    </Section>
  );
}
