import type { AnchorHTMLAttributes, ReactNode } from "react";
import { LINE_URL } from "@/lib/site";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
  children: ReactNode;
};

/**
 * 無料説明会の主CTA。
 * 説明会のスケジュールは公式LINEで配信するため、公式LINEを新規タブで開く。
 */
export function SeminarCtaButton({ children, ...rest }: Props) {
  return (
    <a href={LINE_URL} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
