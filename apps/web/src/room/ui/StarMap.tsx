"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Spinner } from "@/components/ui";
import { useStars, type Star } from "@/lib/gift";
import { useMembers } from "@/lib/session";

import { layoutStars, hash } from "../starmap";
import { StarDialog, STAR_KINDS } from "./StarCard";

const MONTH_WIDTH = 240;

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
}

function Dust({ width }: { width: number }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number; r: number; o: number }[] = [];
    for (let i = 0; i < Math.round(width / 2.5); i++) {
      const h = hash(`dust${i}`);
      out.push({ x: (h % 10000) / 100, y: ((h >> 8) % 10000) / 100, r: h % 7 === 0 ? 1.4 : 0.8, o: 0.25 + ((h >> 4) % 50) / 100 });
    }
    return out;
  }, [width]);
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full">
      {dots.map((d, i) => (
        <circle key={i} cx={`${d.x}%`} cy={`${d.y}%`} r={d.r} fill="#fffbea" opacity={d.o} />
      ))}
    </svg>
  );
}

export function StarMap() {
  const stars = useStars();
  const members = useMembers();
  const [open, setOpen] = useState<Star | null>(null);
  const list = useMemo(() => stars.data ?? [], [stars.data]);
  const layout = useMemo(() => layoutStars(list.map((s) => ({ id: s.id, at: s.at })), { aspect: 1 }), [list]);
  const byId = useMemo(() => new Map(list.map((s) => [s.id, s])), [list]);
  const months = Math.max(1, layout.months.length);
  const width = months * MONTH_WIDTH;
  const nameOf = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";

  return (
    <div className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] flex flex-col overflow-hidden bg-[linear-gradient(180deg,#0b1029_0%,#141a40_55%,#2e3466_100%)] pb-20 text-[#f5eef8] lg:bottom-0 lg:left-64 lg:pb-24">
      <header className="relative z-10 flex items-center gap-3 p-3 pt-[max(env(safe-area-inset-top),12px)] lg:p-5">
        <Link
          href="/"
          aria-label="Room"
          className="grid size-11 place-items-center rounded-full border border-white/15 bg-[#1e1b3a]/70 backdrop-blur-md"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="font-display text-2xl font-semibold">Star map</h1>
        <span className="tabular ms-auto text-sm font-semibold opacity-75">{list.length}</span>
      </header>
      {stars.isLoading && (
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-6" />
        </div>
      )}
      {!stars.isLoading && !list.length && <p className="grid flex-1 place-items-center font-semibold opacity-75">No stars yet</p>}
      {list.length > 0 && (
        <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative h-full" style={{ width: `max(100%, ${width}px)` }}>
            <Dust width={width} />
            <svg aria-hidden className="pointer-events-none absolute inset-x-0 top-[12%] h-[70%] w-full" preserveAspectRatio="none" viewBox="0 0 1000 1000">
              {layout.lines.map(([a, b]) => (
                <line
                  key={`${a}-${b}`}
                  x1={layout.stars[a].x * 1000}
                  y1={layout.stars[a].y * 1000}
                  x2={layout.stars[b].x * 1000}
                  y2={layout.stars[b].y * 1000}
                  stroke="#ffd6e8"
                  strokeOpacity={0.4}
                  strokeWidth={2}
                  strokeDasharray="4 6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className="absolute inset-x-0 top-[12%] h-[70%]">
              {layout.stars.map((p) => {
                const s = byId.get(p.id);
                if (!s) return null;
                const date = new Date(s.at).toLocaleDateString([], { day: "numeric", month: "long" });
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpen(s)}
                    aria-label={`${s.track.title}, ${STAR_KINDS[s.kind] ?? s.kind}, ${nameOf(s.user_id)}, ${date}`}
                    title={s.track.title}
                    className="group absolute grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-offset-0"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  >
                    <span aria-hidden className="relative grid size-6 place-items-center transition-transform group-hover:scale-125 group-focus-visible:scale-125">
                      <span className="absolute size-4 rounded-full bg-[#ffd6e8]/35 blur-[5px]" />
                      <span className="relative block size-5 bg-[#ffe9f2] [clip-path:polygon(50%_0,60%_40%,100%_50%,60%_60%,50%_100%,40%_60%,0_50%,40%_40%)]" />
                    </span>
                  </button>
                );
              })}
            </div>
            {layout.months.map((m, i) => (
              <span
                key={m.month}
                className="absolute bottom-[6%] -translate-x-1/2 whitespace-nowrap text-sm font-bold opacity-70"
                style={{ left: `${((i + 0.5) / months) * 100}%` }}
              >
                {monthLabel(m.month)}
              </span>
            ))}
          </div>
        </div>
      )}
      <StarDialog star={open} onClose={() => setOpen(null)} />
    </div>
  );
}
