import { riskItems } from "@/lib/content";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./risk.module.css";

/** 09 RISK */
export function Risk() {
  return (
    <Section id="risk" className={styles.section}>
      <SectionHead
        label="RISK"
        title="リスクについて"
        lead="ご参加の前に、次の3点をご確認ください。"
        leadVariant="alt"
        align="left"
      />
      <div className={styles.card}>
        {riskItems.map((item) => (
          <div key={item.title} className={styles.row}>
            <h3 className={styles.rowTitle}>{item.title}</h3>
            <p className={styles.rowText}>{item.text}</p>
          </div>
        ))}
      </div>
      {/* TODO(公開前必須): ジュエリーダンジョンの正規リスク告知と照合し、本文と注記を確定する */}
      <p className={styles.note}>
        ※ 上記は公開前にジュエリーダンジョンの正規リスク告知と照合し、確定してください。【要確認】
      </p>
    </Section>
  );
}
