import Image from "next/image";
import { asset } from "@/lib/asset";
import { Section, SectionHead } from "@/components/ui/section";
import styles from "./pricing.module.css";

/** 06 PRICING */
export function Pricing() {
  return (
    <Section id="pricing" className={styles.section}>
      <SectionHead label="PRICING" title="販売価格の考え方" />
      <div className={styles.figureWrap}>
        <Image
          src={asset("/assets/price-example-2.png")}
          alt="購入価格100,000円＋加算例17%＝販売成立時の価格例117,000円、購入価格との差額は17,000円"
          width={1774}
          height={887}
          sizes="(min-width: 1024px) 1120px, (min-width: 600px) 720px, 100vw"
          className={styles.figure}
        />
      </div>
      <p className={styles.note}>
        ※ 上記は仕組みを説明するための一例です。
        <br />
        実際の価格や条件はオーブによって異なります。
      </p>
    </Section>
  );
}
