import type { AnchorHTMLAttributes, ReactNode } from "react";
import { LINE_URL } from "@/lib/site";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
  children: ReactNode;
};

/** 公式LINEを新規タブで開くリンク */
export function LineLink({ children, ...rest }: Props) {
  return (
    <a href={LINE_URL} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}
