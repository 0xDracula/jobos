"use client";

import Link from "next/link";

import { PixelIcon } from "@/components/pixel/PixelIcon";
import { cn } from "@/lib/cn";
import { useRecaps, type RecapEntry } from "@/lib/dates";

import { fmtMonthName } from "./parts";

export const recapHref = (r: Pick<RecapEntry, "period" | "starts_on">) => `/recaps/?period=${r.period}&start=${r.starts_on}`;

export const recapName = (r: Pick<RecapEntry, "period" | "starts_on" | "ends_on">) =>
  r.period === "month" ? `${fmtMonthName(r.starts_on)} recap` : `Year recap ${r.starts_on.slice(0, 4)}–${r.ends_on.slice(0, 4)}`;

export function RecapPrompt({ compact, className }: { compact?: boolean; className?: string }) {
  const q = useRecaps();
  const latest = q.data?.latest;
  if (!latest) return null;
  return (
    <Link
      href={recapHref(latest)}
      className={cn(
        "flex items-center gap-3 rounded-card border border-panel-line bg-panel transition-transform duration-150 hover:-translate-y-0.5",
        compact ? "p-2.5" : "p-4",
        className,
      )}
    >
      <PixelIcon name="recap" size={compact ? 36 : 48} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-extrabold text-muted">New</span>
        <span className={cn("block truncate font-extrabold", compact ? "text-base" : "text-lg")}>{recapName(latest)}</span>
      </span>
      <span className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-bold text-on-accent">Open</span>
    </Link>
  );
}
