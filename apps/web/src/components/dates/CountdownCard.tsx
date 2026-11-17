"use client";

import { motion } from "motion/react";
import Link from "next/link";

import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { cn } from "@/lib/cn";
import { useCountdowns, type Countdown } from "@/lib/dates";
import { bouncy } from "@/lib/motion";

import { fmtDay } from "./parts";

export function CountdownFace({ c, compact }: { c: Countdown; compact?: boolean }) {
  const hidden = c.surprise && !c.title;
  return (
    <div className="flex items-center gap-3">
      <motion.span
        className="shrink-0"
        initial={{ scale: 0.7, rotate: hidden ? -8 : 0 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={bouncy}
        aria-hidden
      >
        <PixelIcon name={hidden ? "present" : "hourglass"} size={compact ? 36 : 48} />
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          {c.days === 0 ? (
            <span className={cn("font-extrabold leading-none", compact ? "text-2xl" : "text-[40px]")}>Today</span>
          ) : (
            <>
              <span className={cn("font-extrabold leading-none", compact ? "text-3xl" : "text-[48px]")}>{c.days}</span>
              <span className="font-bold text-muted">{c.days === 1 ? "day" : "days"}</span>
            </>
          )}
        </div>
        <p dir="auto" className={cn("truncate font-extrabold", compact ? "text-sm" : "mt-1")}>
          {hidden ? "Surprise" : c.title}
        </p>
        <p className="text-sm font-semibold text-muted">
          {fmtDay(c.date)}
          {c.time ? ` · ${c.time}` : ""}
        </p>
      </div>
      {c.placeholder && <PlaceholderMark />}
    </div>
  );
}

export function CountdownCard({ compact, link = true, className }: { compact?: boolean; link?: boolean; className?: string }) {
  const q = useCountdowns();
  const next = q.data?.countdowns[0];
  if (!next) return null;
  const face = <CountdownFace c={next} compact={compact} />;
  const box = cn(
    "block rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel transition-transform duration-150",
    compact ? "p-2.5" : "p-4",
    link && "hover:-translate-y-0.5",
    className,
  );
  return link ? (
    <Link href={`/calendar/?date=${next.date}`} className={box} aria-label={`Countdown: ${next.surprise && !next.title ? "surprise" : next.title}, ${fmtDay(next.date)}`}>
      {face}
    </Link>
  ) : (
    <div className={box}>{face}</div>
  );
}
