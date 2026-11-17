"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const ENVELOPE_TINTS = ["#fbf0de", "#fbe1e7", "#e9e2fa", "#fdf0c4", "#e1eedb", "#dfeaf6"];

export function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ENVELOPE_TINTS[h % ENVELOPE_TINTS.length];
}

export type EnvelopeStage = "sealed" | "open" | "rise";

function shade(tint: string, pct: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [rgb(tint), rgb("#8d6644")];
  return `#${a.map((v, i) => Math.round((v * pct + b[i] * (100 - pct)) / 100).toString(16).padStart(2, "0")).join("")}`;
}

function Seal({ locked }: { locked?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
      <circle cx={12} cy={12} r={11} fill="#b8475f" />
      <circle cx={12} cy={12} r={8.2} fill="none" stroke="#d9707f" strokeWidth={1.2} strokeDasharray="2 1.6" />
      {locked ? (
        <g fill="#fbe1e7">
          <rect x={8} y={11} width={8} height={6} rx={1.2} />
          <path d="M9.6 11V9.4a2.4 2.4 0 0 1 4.8 0V11" fill="none" stroke="#fbe1e7" strokeWidth={1.4} />
        </g>
      ) : (
        <path d="M12 17.2s-4.6-2.8-4.6-6a2.5 2.5 0 0 1 4.6-1.4 2.5 2.5 0 0 1 4.6 1.4c0 3.2-4.6 6-4.6 6z" fill="#fbe1e7" />
      )}
      <ellipse cx={8.6} cy={7.4} rx={2.2} ry={1.2} fill="#ffffff" opacity={0.35} />
    </svg>
  );
}

export function Envelope({
  stage = "sealed",
  tint = ENVELOPE_TINTS[0],
  locked,
  ajar,
  label,
  className,
  onOpened,
  onRisen,
}: {
  stage?: EnvelopeStage;
  tint?: string;
  locked?: boolean;
  ajar?: boolean;
  label?: ReactNode;
  className?: string;
  onOpened?: () => void;
  onRisen?: () => void;
}) {
  const open = stage !== "sealed";
  const flapEase = [0.4, 0, 0.2, 1] as const;
  return (
    <div className={cn("relative aspect-[3/2] w-full select-none [container-type:inline-size]", className)}>
      <div className="absolute inset-0 rounded-[10px]" style={{ background: shade(tint, 82), boxShadow: "0 10px 22px rgba(30, 27, 58, 0.18)" }} />
      <motion.div
        className="absolute inset-x-[8%] top-[7%] h-[84%] rounded-[4px] bg-[#fff8ec] shadow-[0_1px_3px_rgba(59,47,42,0.2)]"
        style={{ zIndex: 1, backgroundImage: "repeating-linear-gradient(transparent 0 13px, rgba(168, 68, 94, 0.12) 13px 14px)", backgroundPosition: "0 18px" }}
        initial={false}
        animate={{ y: stage === "rise" ? "-58%" : open ? "-8%" : "0%" }}
        transition={{ duration: stage === "rise" ? 0.7 : 0.35, ease: [0.3, 0.7, 0.4, 1] }}
        onAnimationComplete={() => stage === "rise" && onRisen?.()}
      />
      <div className="absolute inset-0 rounded-[10px]" style={{ zIndex: 2, background: shade(tint, 93), clipPath: "polygon(0 0, 52% 54%, 0 100%)" }} />
      <div className="absolute inset-0 rounded-[10px]" style={{ zIndex: 2, background: shade(tint, 93), clipPath: "polygon(100% 0, 48% 54%, 100% 100%)" }} />
      <div className="absolute inset-0 rounded-[10px]" style={{ zIndex: 2, background: shade(tint, 97), clipPath: "polygon(0 100%, 50% 46%, 100% 100%)" }} />
      <motion.div
        className="absolute inset-x-0 top-0 h-[50%] origin-top"
        style={{ zIndex: open ? 0 : 3, clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
        initial={false}
        animate={{ scaleY: open ? (ajar ? -0.5 : -1) : 1, backgroundColor: open ? shade(tint, 86) : tint }}
        transition={{ duration: 0.45, ease: flapEase }}
        onAnimationComplete={() => open && onOpened?.()}
      />
      {label != null && (
        <motion.div
          className="absolute inset-x-[9%] bottom-[4%] flex h-[34%] items-center justify-center overflow-hidden text-center leading-tight text-[#3b2f2a]"
          style={{ zIndex: 4 }}
          animate={{ opacity: stage === "rise" ? 0 : 1 }}
        >
          {label}
        </motion.div>
      )}
      <motion.div
        className="absolute left-1/2 top-[50%] w-[14%] -translate-x-1/2 -translate-y-1/2"
        style={{ zIndex: 5 }}
        initial={false}
        animate={open ? { scale: 0.4, opacity: 0 } : { scale: 1, opacity: 1 }}
        transition={{ duration: 0.18 }}
      >
        <Seal locked={locked} />
      </motion.div>
    </div>
  );
}
