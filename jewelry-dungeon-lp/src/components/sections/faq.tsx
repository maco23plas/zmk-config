"use client";

import { useId, useState } from "react";
import { faqItems } from "@/lib/content";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./faq.module.css";

/** 11 FOR BEGINNERS / FAQ（単一開閉アコーディオン。初期状態は1問目が開） */
export function Faq() {
  const [openIndex, setOpenIndex] = useState(0);
  const baseId = useId();

  return (
    <Section id="faq" className={styles.section} innerClassName={styles.inner}>
      <SectionHead
        label="FOR BEGINNERS"
        title="よくあるご質問"
        lead="はじめての方からよくいただく質問や不安をまとめました。"
      />
      <div className={styles.list}>
        {faqItems.map((item, index) => {
          const isOpen = openIndex === index;
          const panelId = `${baseId}-panel-${index}`;
          const buttonId = `${baseId}-button-${index}`;
          return (
            <div key={item.question} className={styles.item}>
              <h3 className={styles.heading}>
                <button
                  type="button"
                  id={buttonId}
                  className={styles.question}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? -1 : index)}
                >
                  <span className={styles.qMark} aria-hidden="true">
                    Q
                  </span>
                  <span className={styles.qText}>{item.question}</span>
                  <span className={styles.toggle} aria-hidden="true">
                    {isOpen ? "−" : "＋"}
                  </span>
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className={styles.answer}
                hidden={!isOpen}
              >
                <p className={styles.answerText}>{item.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
