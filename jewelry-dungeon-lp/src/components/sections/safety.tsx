import Image from "next/image";
import { safetyChecks } from "@/lib/content";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./safety.module.css";

/** 12 SAFETY */
export function Safety() {
  return (
    <Section id="safety" className={styles.section}>
      <SectionHead
        label="SAFETY"
        title={
          <>
            <span className={styles.accent}>安心</span>して楽しめる環境のために
          </>
        }
        lead={
          <>
            ジュエリーダンジョンは、初心者の方でも安心してご利用いただけるよう
            <br />
            さまざまな取り組みを行っています。
          </>
        }
      />
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.icon} aria-hidden="true">
            ▧
          </span>
          <div className={styles.cardBody}>
            <h3 className={styles.title}>わかりやすい情報提供</h3>
            <p className={styles.text}>
              取引の仕組み・リスク・手数料などを、わかりやすく丁寧にご説明しています。
            </p>
          </div>
        </div>
        <div className={styles.card}>
          <span className={styles.icon} aria-hidden="true">
            ◍
          </span>
          <div className={styles.cardBody}>
            <h3 className={styles.title}>健全なコミュニティ</h3>
            <p className={styles.text}>取引の不正防止のため、運営による監視体制もあります。</p>
          </div>
        </div>
      </div>

      <div className={styles.trust}>
        <Image
          src="/parts/shield.png"
          alt="信頼の証"
          width={213}
          height={175}
          className={styles.trustImg}
        />
        <div className={styles.trustText}>
          <h3 className={styles.trustTitle}>信頼されるサービスであり続けるために</h3>
          <p className={styles.trustBody}>
            ジュエリーダンジョンは、法令を遵守し、お客様に長くご利用いただける健全なサービス運営を徹底しています。
          </p>
        </div>
        <ul className={styles.trustList}>
          {safetyChecks.map((text) => (
            <li key={text} className={styles.trustItem}>
              <span className={styles.trustCheck} aria-hidden="true">
                ✓
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
