import { Section, SectionHead } from "@/components/ui/section";
import styles from "./registration-guide.module.css";

/** 14 REGISTRATION GUIDE */
export function RegistrationGuide() {
  return (
    <Section id="registration-guide" className={styles.section}>
      <SectionHead label="REGISTRATION" title="会員登録は招待リンクから" />
      <div className={styles.card}>
        <p className={styles.text}>
          ジュエリーダンジョンの会員登録は、紹介者からお送りする招待リンクからのみお進みいただけます。
          招待リンクをお持ちの方は、届いたリンクから登録ください。
        </p>
      </div>
    </Section>
  );
}
