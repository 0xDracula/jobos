"use client";

import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { soft } from "@/lib/motion";
import { seek, seekBy } from "@/player/controls";

import { usePlaybackClock } from "./clock";

function barCount(width: number, compact?: boolean): number {
  if (compact) return Math.max(16, Math.min(100, Math.round(width / 5)));
  if (!width) return 54;
  return width < 480 ? 54 : Math.min(120, Math.round(width / 6));
}

export function resample(peaks: number[] | undefined, n: number): number[] {
  if (!peaks?.length) return Array.from({ length: n }, (_, i) => 0.3 + 0.08 * Math.sin(i * 0.7) * Math.sin(i * 0.23));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * peaks.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / n));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, peaks[j] ?? 0);
    out.push(m);
  }
  const sorted = [...out].sort((x, y) => x - y);
  const lo = sorted[Math.floor(n * 0.05)];
  const hi = sorted[n - 1];
  const span = hi - lo || 1;
  return out.map((v) => 0.14 + 0.86 * Math.max(0, Math.min(1, (v - lo) / span)));
}

export function Waveform({
  peaks,
  duration,
  className,
  compact,
}: {
  peaks?: number[];
  duration: number;
  className?: string;
  compact?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<number | null>(null);
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [second, setSecond] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = useMemo(() => resample(peaks, barCount(width, compact)), [peaks, width, compact]);

  const show = (fraction: number) => {
    if (played.current) played.current.style.clipPath = `inset(0 ${(1 - fraction) * 100}% 0 0)`;
  };

  usePlaybackClock((t) => {
    if (scrubbing.current != null) return;
    show(duration > 0 ? Math.min(1, t / duration) : 0);
    const s = Math.floor(t);
    setSecond((prev) => (prev === s ? prev : s));
  });

  const fractionAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fractionAt(e);
    scrubbing.current = f;
    setScrub(f);
    show(f);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current == null) return;
    const f = fractionAt(e);
    scrubbing.current = f;
    setScrub(f);
    show(f);
  };
  const end = (commit: boolean) => {
    const f = scrubbing.current;
    scrubbing.current = null;
    setScrub(null);
    if (commit && f != null) seek(f * duration);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    if (e.key in steps) seekBy(steps[e.key]);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(Math.max(0, duration - 1));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const shown = scrub != null ? scrub * duration : second;
  const valueText = `${fmtTime(shown)} of ${fmtTime(duration)}`;

  return (
    <div className={cn("w-full", className)}>
      <div
        ref={box}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onLostPointerCapture={() => scrubbing.current != null && end(true)}
        onKeyDown={onKeyDown}
        className={cn("relative cursor-pointer touch-none rounded-chip outline-offset-4", compact ? "h-8" : "h-14")}
      >
        <motion.div
          className="absolute inset-0"
          animate={{ scaleY: scrub != null ? 1.18 : 1 }}
          transition={soft}
        >
          <Bars bars={bars} className="text-ink/18" />
          <div ref={played} className="absolute inset-0" style={{ clipPath: "inset(0 100% 0 0)" }}>
            <Bars bars={bars} className="text-tint" />
          </div>
        </motion.div>
      </div>
      {!compact && (
        <div className="tabular mt-1.5 flex justify-between text-[13px] font-bold text-muted" aria-hidden>
          <span>{fmtTime(shown)}</span>
          <span>{fmtTime(duration)}</span>
        </div>
      )}
    </div>
  );
}

function Bars({ bars, className }: { bars: number[]; className: string }) {
  return (
    <div className={cn("absolute inset-0 flex items-center gap-[2px] overflow-hidden", className)}>
      {bars.map((h, i) => (
        <span key={i} className="min-w-[2px] flex-1 rounded-full bg-current" style={{ height: `${h * 100}%` }} />
      ))}
    </div>
  );
}

export function ProgressLine({ duration, className }: { duration: number; className?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  usePlaybackClock((t) => {
    if (bar.current) bar.current.style.transform = `scaleX(${duration > 0 ? Math.min(1, t / duration) : 0})`;
  });
  return (
    <div aria-hidden className={cn("h-[3px] bg-line", className)}>
      <div ref={bar} className="h-full origin-left bg-tint" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}
