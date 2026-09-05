import Image from "next/image";
import { choiceA, choiceB } from "@/lib/content";
import { cx } from "@/lib/cx";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./your-choice.module.css";

/** 13 YOUR CHOICE */
export function YourChoice() {
  return (
    <Section id="choice" className={styles.section}>
      <SectionHead
        label="YOUR CHOICE"
        title="あなたはどっち？"
        lead={
          <>
            同じ時間を使うなら、ただ貯金するだけでなく
            <br />
            楽しみながら資産を増やす選択を。
          </>
        }
      />
      <div className={styles.grid}>
        {/* A: ただ貯金するだけ */}
        <div className={cx(styles.card, styles.cardA)}>
          <div className={styles.head}>
            <span className={cx(styles.badge, styles.badgeA)} aria-hidden="true">
              A
            </span>
            <h3 className={styles.title}>銀行口座に貯金するだけ</h3>
          </div>
          <div className={styles.visual}>
            <Image
              src="/parts/p-manA.png"
              alt="貯金するだけの毎日"
              width={262}
              height={300}
              sizes="(min-width: 1024px) 548px, 50vw"
              className={styles.img}
            />
            <ul className={styles.checks}>
              {choiceA.map((text) => (
                <li key={text} className={styles.check}>
                  <span className={cx(styles.checkIcon, styles.checkIconA)} aria-hidden="true">
                    ✓
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.body}>
            <p className={styles.text}>コツコツ貯金しても、お金の増え方はわずかです。</p>
            <div className={cx(styles.example, styles.exampleA)}>
              <span className={cx(styles.pill, styles.pillA)}>例えば…</span>
              <p className={styles.exampleText}>100万円を銀行に預けても、増えるのは金利のみ</p>
              <p className={styles.exampleValue}>
                1年で増えるのは{" "}
                <span className={styles.nowrap}>
                  <span className={styles.num}>200</span>円
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* B: 遊び感覚で資産を増やす */}
        <div className={cx(styles.card, styles.cardB)}>
          <div className={styles.head}>
            <span className={cx(styles.badge, styles.badgeB)} aria-hidden="true">
              B
            </span>
            <h3 className={cx(styles.title, styles.titleB)}>遊び感覚で資産を増やす</h3>
          </div>
          <div className={styles.visual}>
            <Image
              src="/parts/p-womanB.png"
              alt="遊びながら資産を増やす毎日"
              width={262}
              height={300}
              sizes="(min-width: 1024px) 548px, 50vw"
              className={styles.img}
            />
            <ul className={styles.checks}>
              {choiceB.map((text) => (
                <li key={text} className={styles.check}>
                  <span className={cx(styles.checkIcon, styles.checkIconB)} aria-hidden="true">
                    ✓
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.body}>
            <p className={cx(styles.text, styles.textB)}>
              ジュエリーダンジョンなら、遊びながら資産形成が可能です。
            </p>
            <div className={cx(styles.example, styles.exampleB)}>
              <span className={cx(styles.pill, styles.pillB)}>例えば…</span>
              <p className={cx(styles.exampleText, styles.exampleTextB)}>
                同じ100万円でも運用次第で1年後には
              </p>
              <p className={cx(styles.exampleValue, styles.exampleValueB)}>
                <span className={styles.num}>120</span>万円以上を目指せる!
              </p>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
