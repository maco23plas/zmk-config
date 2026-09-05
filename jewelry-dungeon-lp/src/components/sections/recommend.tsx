import Image from "next/image";
import { asset } from "@/lib/asset";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./recommend.module.css";

/** 02 RECOMMEND */
export function Recommend() {
  return (
    <Section id="recommend" className={styles.section}>
      <SectionHead
        label="RECOMMEND"
        title="こんな方におすすめです"
        lead="新しい収入の選択肢として、幅広い方に選ばれています。"
      />
      <div className={styles.grid}>
        <div className={styles.card}>
          <Image
            src={asset("/parts/p-invest.png")}
            alt="資産運用に興味がある方"
            width={299}
            height={120}
            className={styles.img}
          />
          <div className={styles.body}>
            <h3 className={styles.title}>貯金を賢く運用し資産を増やしたい</h3>
            <p className={styles.text}>即金性が高く、利益が見えやすい運用を手軽に始めたい方</p>
          </div>
        </div>
        <div className={styles.card}>
          <Image
            src={asset("/parts/p-work.png")}
            alt="副業で新しい収入源を作りたい方"
            width={299}
            height={120}
            className={styles.img}
          />
          <div className={styles.body}>
            <h3 className={styles.title}>
              スキルがなくても
              <br className={styles.brPc} />
              隙間時間に
              <br className={styles.brPc} />
              稼ぎたい人
            </h3>
            <p className={styles.text}>1日5分、スマホだけで副業をしてみたい初心者の方</p>
          </div>
        </div>
      </div>
    </Section>
  );
}
