"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import { PlaceholderMark } from "@/components/PlaceholderMark";
import { cn } from "@/lib/cn";
import type { Letter, Note } from "@/lib/letters";
import { formatDay } from "@/lib/paper";

import { Handwriting } from "./Handwriting";

export function letterDate(l: Letter): string {
  if (l.unlock_date) return formatDay(l.unlock_date);
  return new Date(l.created_at).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

export const RULED = { backgroundImage: "repeating-linear-gradient(transparent 0 33px, rgba(168, 68, 94, 0.13) 33px 34px)", backgroundPosition: "0 -6px" };

export const PAPER_FIELD = "block w-full rounded-[6px] border border-line bg-[#fff8ec] px-4 py-3 text-[#3b2f2a] outline-none focus:border-accent";

export const ruledField = (fontFamily: string) => ({
  fontFamily,
  fontSize: 22,
  lineHeight: "34px",
  backgroundImage: RULED.backgroundImage,
  backgroundPosition: "0 6px",
  backgroundAttachment: "local" as const,
});

export function PaperMark({ className }: { className?: string }) {
  return (
    <span className={cn("absolute end-3 top-3", className)} style={{ "--text-muted": "#7a6a5e" } as CSSProperties}>
      <PlaceholderMark />
    </span>
  );
}

export function LetterPaper({ letter, authorName, className, children }: { letter: Letter; authorName: string; className?: string; children?: ReactNode }) {
  return (
    <article className={cn("relative mx-auto w-full max-w-xl rounded-[6px] bg-[#fff8ec] px-6 pb-7 pt-6 text-[#3b2f2a] shadow-[0_14px_34px_rgba(30,27,58,0.2)] sm:px-9", className)}>
      {letter.placeholder && <PaperMark />}
      {letter.occasion && (
        <Handwriting authorId={letter.author_id} className={cn("text-xl text-[#a8445e]", letter.placeholder && "pr-28")}>
          {letter.occasion}
        </Handwriting>
      )}
      {letter.title && (
        <Handwriting authorId={letter.author_id} as="h2" className="mt-1 text-[32px] leading-tight">
          {letter.title}
        </Handwriting>
      )}
      <div style={RULED} className="mt-2">
        <Handwriting authorId={letter.author_id} className="whitespace-pre-wrap break-words text-[23px] leading-[34px]">
          {letter.body}
        </Handwriting>
      </div>
      <Handwriting authorId={letter.author_id} className="mt-4 text-end text-[26px] leading-tight">
        {authorName}
      </Handwriting>
      <p className="mt-1 text-end text-xs font-bold text-[#7a6a5e]">{letterDate(letter)}</p>
      {children}
    </article>
  );
}

export function NotePaper({
  note,
  authorName,
  unfold,
  label,
  className,
  children,
}: {
  note: Note;
  authorName: string;
  unfold?: boolean;
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  const play = unfold && !reduced;
  return (
    <motion.article
      className={cn("relative mx-auto w-full max-w-md rounded-[4px] bg-[#fffaf0] px-6 pb-6 pt-7 text-[#3b2f2a] shadow-[0_12px_28px_rgba(30,27,58,0.2)]", className)}
      initial={play ? { scaleX: 0.34, scaleY: 0.5, rotate: -5 } : unfold ? { opacity: 0 } : false}
      animate={play ? { scaleX: [0.34, 1, 1], scaleY: [0.5, 0.5, 1], rotate: [-5, -3, -1] } : { opacity: 1, rotate: -1 }}
      transition={play ? { duration: 1.1, times: [0, 0.45, 1], ease: "easeOut" } : { duration: 0.12 }}
    >
      <span aria-hidden className="absolute -top-2.5 left-1/2 h-5 w-20 -translate-x-1/2 -rotate-2 rounded-[2px] bg-[#f2a7b8]/70" />
      {play && (
        <>
          {[33.3, 66.6].map((x) => (
            <motion.span key={x} aria-hidden className="absolute inset-y-0 w-px bg-[#3b2f2a]/15" style={{ left: `${x}%` }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: 1.6, times: [0, 0.6, 1] }} />
          ))}
          <motion.span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-[#3b2f2a]/15" animate={{ opacity: [1, 1, 0] }} transition={{ duration: 1.6, times: [0, 0.7, 1] }} />
        </>
      )}
      {note.placeholder && <PaperMark />}
      <motion.div initial={play ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: play ? 0.85 : 0, duration: 0.35 }}>
        {label && <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-[#a8445e]">{label}</p>}
        <Handwriting authorId={note.author_id} className="whitespace-pre-wrap break-words text-[24px] leading-[1.35]">
          {note.body}
        </Handwriting>
        <Handwriting authorId={note.author_id} className="mt-3 text-end text-[22px] leading-tight">
          {authorName}
        </Handwriting>
        {children}
      </motion.div>
    </motion.article>
  );
}
