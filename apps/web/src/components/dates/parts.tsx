"use client";

import type { ReactNode } from "react";

import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { cn } from "@/lib/cn";
import { dayDate } from "@/lib/dateMath";
import type { CalendarEvent } from "@/lib/dates";

const KIND_ICONS: Record<string, PixelIconName> = {
  birthday: "cake",
  anniversary: "rings",
  plan: "flag",
  countdown: "hourglass",
  other: "calendar",
  milestone: "star",
  holiday: "lantern",
  letter_unlock: "seal",
  listening_date: "headphones",
};

export const kindIcon = (kind: string): PixelIconName => KIND_ICONS[kind] ?? "calendar";

export const isHiddenSurprise = (e: Pick<CalendarEvent, "surprise" | "title">) => !!e.surprise && !e.title;

export function EventIcon({ event, size = 24, className }: { event: Pick<CalendarEvent, "kind" | "surprise" | "title">; size?: number; className?: string }) {
  return <PixelIcon name={isHiddenSurprise(event) ? "present" : kindIcon(event.kind)} size={size} className={className} />;
}

export function fmtDay(day: string, style: "long" | "full" | "short" | "weekday" = "full"): string {
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long" }
      : style === "short"
        ? { day: "numeric", month: "short" }
        : style === "weekday"
          ? { weekday: "short", day: "numeric", month: "short" }
          : { day: "numeric", month: "long", year: "numeric" };
  return dayDate(day).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

export const fmtMonth = (day: string) => dayDate(day).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export const fmtMonthName = (day: string) => dayDate(day).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });

export function DatePanel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-xl font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Figure({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[8px] border-2 border-panel-line bg-panel px-3 py-2.5", className)}>
      <div className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-2xl font-extrabold leading-tight">{value}</div>
      {sub && <div className="text-sm font-semibold text-muted">{sub}</div>}
    </div>
  );
}
