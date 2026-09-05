import Image from "next/image";
import { Fragment } from "react";
import { orbs } from "@/lib/content";
import { cx } from "@/lib/cx";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./orb-list.module.css";

const nameClass = {
  red: styles.nameRed,
  silver: styles.nameSilver,
  gold: styles.nameGold,
} as const;

/** 05 ORB LIST */
export function OrbList() {
  return (
    <Section id="orb" className={styles.section}>
      <SectionHead
        label="ORB LIST"
        title={
          <>
            3種類のオーブ
            <br />
            それぞれに異なるチャンス。
          </>
        }
        lead={
          <>
            オーブは、ジュエリーダンジョン内で取引される
            <br />
            宝石モチーフのデジタル商品です
          </>
        }
        leadVariant="alt"
      />
      <div className={styles.grid}>
        {orbs.map((orb) => {
          const isGold = orb.key === "gold";
          return (
            <div key={orb.key} className={cx(styles.card, isGold && styles.cardGold)}>
              <h3 className={cx(styles.name, nameClass[orb.key])}>{orb.nameJa}</h3>
              <Image
                src={orb.image}
                alt={orb.nameJa}
                width={orb.imageWidth}
                height={orb.imageHeight}
                className={styles.img}
              />
              <div className={cx(styles.specs, isGold && styles.specsGold)}>
                {orb.specs.map((spec, index) => (
                  <Fragment key={spec.label}>
                    {index > 0 ? <div className={styles.rule} aria-hidden="true" /> : null}
                    <div className={styles.row}>
                      <span className={styles.rowLabel}>{spec.label}</span>
                      <span
                        className={cx(styles.rowValue, spec.label === "販売価格" && styles.rowValuePrice)}
                      >
                        {spec.value}
                      </span>
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className={styles.note}>
        オーブごとに、販売価格・値上げ率・期間・チケット枚数／予約上限が設定されています
      </p>
    </Section>
  );
}
