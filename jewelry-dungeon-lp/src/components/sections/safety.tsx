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
            <svg viewBox="0 0 24 24" className={styles.iconSvg}>
              <rect x="5" y="2" width="14" height="20" rx="2.5" />
              <path d="M11 18h2" />
            </svg>
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
            <svg viewBox="0 0 24 24" className={styles.iconSvg}>
              <path d="m11 17 2 2a1 1 0 1 0 3-3" />
              <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
              <path d="m21 3 1 11h-2" />
              <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
              <path d="M3 4h8" />
            </svg>
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
