import { cx } from "@/lib/cx";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./gold-orb-entry.module.css";

/** 07 GOLD ORB ENTRY */
export function GoldOrbEntry() {
  return (
    <Section id="goldentry" className={styles.section}>
      <SectionHead
        label="GOLD ORB ENTRY"
        title="100枚~のチケットで予約。毎日 抽選販売を行います。"
        lead={
          <>
            オーブは、チケットを使って予約
            <br />
            予約者の中から抽選で購入権を確保できます。
          </>
        }
        leadVariant="alt"
      />
      <div className={styles.diagram}>
        <div className={cx(styles.card, styles.cardReserve)}>
          <p className={cx(styles.title, styles.titleReserve)}>予約</p>
          <p className={styles.big}>
            240枚
            <span className={styles.small}>チケット使用</span>
          </p>
        </div>
        <div className={cx(styles.card, styles.cardLottery)}>
          <p className={cx(styles.title, styles.titleLottery)}>抽選</p>
        </div>
        <div className={cx(styles.card, styles.cardPlain)}>
          <p className={styles.title}>当選</p>
          <div className={styles.pills}>
            <span className={styles.pill}>1口分 240枚消費</span>
            <span className={styles.pill}>2口分 480枚返還</span>
          </div>
        </div>
        <div className={cx(styles.card, styles.cardPlain)}>
          <p className={styles.title}>落選</p>
          <span className={styles.pill}>チケットの消費はありません</span>
        </div>
      </div>
    </Section>
  );
}
