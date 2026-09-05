"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useUi } from "./ui-context";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & {
  children: ReactNode;
};

/** 無料説明会の申込モーダルを開く主CTA */
export function SeminarCtaButton({ children, ...rest }: Props) {
  const { openModal } = useUi();
  return (
    <button type="button" onClick={() => openModal("seminar")} {...rest}>
      {children}
    </button>
  );
}
