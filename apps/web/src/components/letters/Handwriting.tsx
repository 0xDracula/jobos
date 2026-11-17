"use client";

import { useEffect, useMemo, type CSSProperties, type ElementType, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { fontFaceCss, handFontFamily, readyFonts } from "@/lib/handwriting";
import { useHandwritingFonts } from "@/lib/letters";

const STYLE_ID = "jobbos-hand-fonts";

function useFontFaces(css: string) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }, [css]);
}

export function useHandFont(authorId: string | null | undefined): string {
  const fonts = useHandwritingFonts().data;
  const css = useMemo(() => fontFaceCss(fonts), [fonts]);
  useFontFaces(css);
  const ready = useMemo(() => readyFonts(fonts), [fonts]);
  return handFontFamily(authorId, ready);
}

export function HandwritingFonts() {
  useHandFont(null);
  return null;
}

export function Handwriting({
  authorId,
  as: Tag = "p",
  className,
  style,
  children,
}: {
  authorId: string | null | undefined;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const fontFamily = useHandFont(authorId);
  return (
    <Tag dir="auto" className={cn("font-hand", className)} style={{ ...style, fontFamily }}>
      {children}
    </Tag>
  );
}
