import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./section.module.css";

type SectionProps = HTMLAttributes<HTMLElement> & {
  id: string;
  children: ReactNode;
  /** コンテナ（max-width を持つ内側の div）に追加するクラス */
  innerClassName?: string;
};

/** セクション共通ラッパー（余白・コンテナ幅・横スクロール防止） */
export function Section({ id, className, innerClassName, children, ...rest }: SectionProps) {
  return (
    <section id={id} className={cx(styles.section, className)} {...rest}>
      <div className={cx(styles.inner, innerClassName)}>{children}</div>
    </section>
  );
}

interface SectionHeadProps {
  /** 英字ラベル（SAFETY / ORB LIST 等） */
  label: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "center" | "left";
  /** alt = 行間 2.05 / #41567a / 下余白 28px のリード */
  leadVariant?: "default" | "alt";
}

/** ラベル + h2 + リード文 */
export function SectionHead({
  label,
  title,
  lead,
  align = "center",
  leadVariant = "default",
}: SectionHeadProps) {
  const left = align === "left" ? styles.left : undefined;
  return (
    <>
      <p className={cx(styles.label, left)}>{label}</p>
      <h2 className={cx(styles.title, left)}>{title}</h2>
      {lead ? (
        <p className={cx(styles.lead, leadVariant === "alt" && styles.leadAlt, left)}>{lead}</p>
      ) : null}
    </>
  );
}
