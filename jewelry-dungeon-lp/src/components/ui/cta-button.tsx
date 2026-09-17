import type { AnchorHTMLAttributes, ReactNode } from "react";
import { SEMINAR_URL } from "@/lib/site";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
  children: ReactNode;
};

/** 無料説明会の主CTA。予約ページを新規タブで開く。 */
export function SeminarCtaButton({ children, ...rest }: Props) {
  return (
    <a href={SEMINAR_URL} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
