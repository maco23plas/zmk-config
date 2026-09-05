import Image from "next/image";
import { asset } from "@/lib/asset";
import { howToPlaySteps } from "@/lib/content";
import { Section, SectionHead } from "@/components/ui/section";
import { SeminarCtaButton } from "@/components/ui/cta-button";
import styles from "./how-to-play.module.css";

/** 04 HOW TO PLAY */
export function HowToPlay() {
  return (
    <Section id="howtoplay" className={styles.section}>
      <SectionHead
        label="HOW TO PLAY"
        title="実際の取引の仕組み"
        lead="4つのステップで、実際の取引の流れを体験してみましょう。"
      />
      <div className={styles.grid}>
        {howToPlaySteps.map((step) => (
          <div key={step.no} className={styles.card}>
            <div className={styles.head}>
              <span className={styles.no}>{step.no}</span>
              <h3 className={styles.title}>{step.title}</h3>
            </div>
            <p className={styles.text}>{step.text}</p>
            <Image
              src={asset(step.image)}
              alt={step.alt}
              width={step.imageWidth}
              height={step.imageHeight}
              className={styles.shot}
            />
          </div>
        ))}
      </div>
      <p className={styles.note}>※購入・マッチング・売却・利益を保証するものではありません</p>
      <div className={styles.ctaWrap}>
        <SeminarCtaButton className={styles.cta}>無料説明会で仕組みを聞く　→</SeminarCtaButton>
      </div>
    </Section>
  );
}
