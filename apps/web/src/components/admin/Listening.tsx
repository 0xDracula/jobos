"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { request } from "@/lib/api";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useMembers } from "@/lib/session";
import type { Track } from "@/lib/types";

import { Panel } from "./parts";

type DayActivity = { user_id: string; day: string; minutes: number; plays: number; skips: number };
type Played = Track & { plays: number };
type Timeline = { from: string; days: number; activity: DayActivity[]; people: { user_id: string; top_songs: Played[]; most_skipped: Played[] }[] };

const SERIES = ["var(--series-1)", "var(--series-2)"];

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString([], opts);

function niceMax(v: number): number {
  if (v <= 10) return 10;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

function Chart({ data, people, nameOf }: { data: Timeline; people: string[]; nameOf: (id: string) => string }) {
  const [hover, setHover] = useState<{ day: string; user: string } | null>(null);
  const start = new Date(`${data.from}T12:00:00`);
  const days = Array.from({ length: data.days }, (_, i) => dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  const at = (user: string, day: string) => data.activity.find((a) => a.user_id === user && a.day === day);
  const max = niceMax(Math.max(0, ...data.activity.map((a) => a.minutes)));
  const H = 160;
  const hovered = hover && at(hover.user, hover.day);
  return (
    <div className="grid gap-3 p-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold">
        {people.map((u, i) => (
          <span key={u} className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-[3px]" style={{ background: SERIES[i] }} />
            {nameOf(u)}
            <span className="font-semibold text-muted">{data.activity.filter((a) => a.user_id === u).reduce((n, a) => n + a.minutes, 0)} min</span>
          </span>
        ))}
      </div>
      <div className="relative flex gap-2" role="img" aria-label="Minutes listened per day">
        <div className="flex w-8 shrink-0 flex-col justify-between text-end text-[11px] font-semibold tabular-nums text-muted" style={{ height: H }}>
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="border-t border-line" />
            ))}
          </div>
          <div className="relative flex items-end gap-1" style={{ height: H }}>
            {days.map((day) => (
              <div key={day} className="flex h-full flex-1 items-end justify-center gap-[2px]">
                {people.map((u, i) => {
                  const a = at(u, day);
                  const h = a ? Math.max(a.minutes > 0 ? 3 : 0, (a.minutes / max) * H) : 0;
                  const active = hover?.day === day && hover.user === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      aria-label={`${nameOf(u)}, ${dayLabel(day, { weekday: "short", day: "numeric", month: "short" })}: ${a?.minutes ?? 0} minutes`}
                      onPointerEnter={() => setHover({ day, user: u })}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ day, user: u })}
                      onBlur={() => setHover(null)}
                      className="flex h-full w-full max-w-4 items-end"
                    >
                      <span
                        className={cn("block w-full rounded-t-[4px] transition-opacity", hover && !active && "opacity-50")}
                        style={{ height: h, background: SERIES[i] }}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[11px] font-semibold text-muted">
            {days.map((day, i) => (
              <span key={day} className="flex-1 text-center">
                {i % 2 === 0 || days.length <= 7 ? dayLabel(day, { day: "numeric" }) : ""}
              </span>
            ))}
          </div>
          {hover && (
            <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-[10px] bg-ink px-3 py-1.5 text-xs font-bold text-bg shadow-soft">
              {nameOf(hover.user)} · {dayLabel(hover.day, { weekday: "short", day: "numeric", month: "short" })} · {hovered?.minutes ?? 0} min · {hovered?.plays ?? 0} plays · {hovered?.skips ?? 0} skips
            </div>
          )}
        </div>
      </div>
      <table className="sr-only">
        <caption>Minutes listened per day</caption>
        <thead>
          <tr>
            <th>Day</th>
            {people.map((u) => (
              <th key={u}>{nameOf(u)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day}>
              <td>{day}</td>
              {people.map((u) => (
                <td key={u}>{at(u, day)?.minutes ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SongList({ title, list, unit }: { title: string; list: Played[]; unit: "play" | "skip" }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-muted">{title}</p>
      {list.length === 0 ? (
        <p className="text-sm font-semibold text-muted">None</p>
      ) : (
        <ol className="grid gap-0.5">
          {list.map((t) => (
            <li key={t.id} className="flex items-baseline gap-2 text-sm">
              <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">
                {t.title} · <span className="text-muted">{t.artists.join(", ")}</span>
              </span>
              <span className="shrink-0 text-xs font-bold tabular-nums text-muted">
                {plural(t.plays, unit)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ListeningTimeline() {
  const members = useMembers();
  const q = useQuery({ queryKey: ["admin", "listening", "timeline"], queryFn: () => request<Timeline>("/api/admin/listening/timeline?days=14") });
  const nameOf = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const people = (q.data?.people ?? []).map((p) => p.user_id);
  return (
    <Panel title="Listening">
      {q.data && (
        <>
          <Chart data={q.data} people={people} nameOf={nameOf} />
          <div className="grid gap-4 p-2 sm:grid-cols-2">
            {q.data.people.map((p) => (
              <div key={p.user_id} className="grid gap-3 rounded-card bg-surface p-3">
                <p className="font-bold">{nameOf(p.user_id)}</p>
                <SongList title="Top songs this week" list={p.top_songs} unit="play" />
                <SongList title="Most skipped this week" list={p.most_skipped} unit="skip" />
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
