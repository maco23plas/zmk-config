import { Section, SectionHead } from "@/components/ui/section";
import styles from "./why-now.module.css";

const items = [
  {
    no: "01",
    title: "スマホで完結",
    text: "保管や発送はゼロ。全ての操作をスマホで完結できます。",
  },
  {
    no: "02",
    title: "個人間での取引",
    text: "運営のサポートのもとユーザー同士で取引します",
  },
  {
    no: "03",
    title: "ガイド・サポート",
    text: "初心者から収益を出せるよう、サポートが充実しています。",
  },
];

/** 03 WHY NOW */
export function WhyNow() {
  return (
    <Section id="whynow" className={styles.section}>
      <SectionHead
        label="WHY DIGITAL RESALE"
        title={
          <>
            在庫を持たない
            <br />
            新しいデジタル物販
          </>
        }
        lead="ジュエリーダンジョンは、会員同士で「オーブ」を売買できるサービスです。"
        leadVariant="alt"
      />
      <div className={styles.grid}>
        {items.map((item) => (
          <div key={item.no} className={styles.card}>
            <span className={styles.no}>{item.no}</span>
            <h4 className={styles.title}>{item.title}</h4>
            <p className={styles.text}>{item.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
