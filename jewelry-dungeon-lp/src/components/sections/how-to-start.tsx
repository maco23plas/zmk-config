import Image from "next/image";
import { asset } from "@/lib/asset";
import { howToStartSteps } from "@/lib/content";
import { cx } from "@/lib/cx";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./how-to-start.module.css";

/** 08 HOW TO START */
export function HowToStart() {
  return (
    <Section id="howtostart" className={styles.section}>
      <SectionHead
        label="HOW TO START"
        title={
          <>
            たった<span className={styles.accent}>5</span>ステップで始められます
          </>
        }
        lead="難しい手続きは不要です。スマホひとつで、今すぐ始められます。"
      />
      <ol className={styles.list}>
        {howToStartSteps.map((step) => (
          <li key={step.no} className={styles.item}>
            <span className={styles.no} aria-hidden="true">
              {step.no}
            </span>
            <Image
              src={asset(step.image)}
              alt={step.alt}
              width={step.imageWidth}
              height={step.imageHeight}
              className={cx(styles.img, step.isOrb && styles.imgOrb)}
            />
            <h3 className={styles.title}>{step.title}</h3>
            <p className={styles.text}>{step.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
