"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { hourLabel } from "@/lib/dateMath";
import { useResolvedTheme } from "@/lib/theme";

const BAR = { day: "#a8445e", night: "#d96a8b" } as const;

export function HourBars({ hours, color, className, height = 128 }: { hours: number[]; color?: string; className?: string; height?: number }) {
  const theme = useResolvedTheme();
  const fill = color ?? BAR[theme];
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...hours);
  const top = hours.some((m) => m > 0) ? hours.indexOf(Math.max(...hours)) : -1;
  const shown = hover ?? top;
  return (
    <figure className={cn("relative", className)} aria-label={top >= 0 ? `Listening by hour, most at ${hourLabel(top)}` : "Listening by hour"}>
      <div className="relative flex items-end gap-[2px] border-b border-line" style={{ height }} onPointerLeave={() => setHover(null)}>
        {hours.map((m, h) => (
          <div key={h} className="relative flex h-full min-w-0 flex-1 items-end justify-center" onPointerEnter={() => setHover(h)}>
            <span
              className="block w-full max-w-[24px] rounded-t-[4px] transition-opacity"
              style={{ height: m ? `max(3px, ${(m / max) * 100}%)` : 0, background: fill, opacity: hover == null || hover === h ? 1 : 0.55 }}
            />
          </div>
        ))}
        {shown >= 0 && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[8px] border border-panel-line bg-panel px-2 py-1 text-xs font-bold shadow-soft"
            style={{ left: `clamp(40px, ${((shown + 0.5) / 24) * 100}%, calc(100% - 40px))` }}
          >
            <span className="font-extrabold">{hours[shown]} min</span> <span className="text-muted">{hourLabel(shown)}</span>
          </div>
        )}
      </div>
      <div aria-hidden className="tabular mt-1 grid grid-cols-4 text-[11px] font-bold text-muted">
        {[0, 6, 12, 18].map((h) => (
          <span key={h}>{hourLabel(h)}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Minutes listened by hour</caption>
        <tbody>
          {hours.map((m, h) => (
            <tr key={h}>
              <th scope="row">{hourLabel(h)}</th>
              <td>{m}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
