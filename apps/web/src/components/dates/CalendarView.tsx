"use client";

import { ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { addDays, addMonths, dateIdOf, dayKey, daysBetween, isDay, monthGrid, monthStart, relativeDays, WEEKDAYS } from "@/lib/dateMath";
import { KIND_LABELS, useCalendar, useCountdowns, useDates, type CalendarEvent, type DateItem } from "@/lib/dates";

import { CountdownCard, CountdownFace } from "./CountdownCard";
import { DateDialog } from "./DateDialog";
import { OccasionCard } from "./OccasionCard";
import { DatePanel, EventIcon, fmtDay, fmtMonth, isHiddenSurprise } from "./parts";

const localToday = () => {
  const d = new Date();
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

function EventRow({ e, date, onEdit, showDay }: { e: CalendarEvent; date?: DateItem; onEdit: (d: DateItem) => void; showDay?: string }) {
  const hidden = isHiddenSurprise(e);
  const body = (
    <>
      <EventIcon event={e} size={36} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="line-clamp-2 font-extrabold leading-snug">
          {hidden ? "Surprise" : e.title}
        </p>
        <p className="text-sm font-semibold text-muted">
          {[showDay, hidden ? null : KIND_LABELS[e.kind] ?? e.kind, e.time, e.surprise && !hidden ? "Surprise" : null].filter(Boolean).join(" · ")}
        </p>
        {date?.note && !hidden && (
          <p dir="auto" className="mt-0.5 line-clamp-2 text-sm font-semibold">
            {date.note}
          </p>
        )}
        {e.placeholder && <PlaceholderMark className="mt-1" />}
      </div>
    </>
  );
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-[8px] px-1 py-1.5">
      {e.link && !e.link.startsWith("/calendar/") ? (
        <Link href={e.link} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {date?.editable && (
        <IconButton label="Edit" size="sm" onClick={() => onEdit(date)}>
          <Pencil />
        </IconButton>
      )}
    </li>
  );
}

function MonthGrid({
  month,
  today,
  selected,
  byDay,
  onPick,
}: {
  month: string;
  today: string;
  selected: string | null;
  byDay: Map<string, CalendarEvent[]>;
  onPick: (day: string) => void;
}) {
  const cells = useMemo(() => monthGrid(month), [month]);
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-extrabold text-muted" aria-hidden>
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ day, inMonth }) => {
          const events = byDay.get(day) ?? [];
          const first = events[0];
          const isToday = day === today;
          const picked = day === selected;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-pressed={picked}
              aria-label={`${fmtDay(day, "long")}${events.length ? `, ${events.length} ${events.length === 1 ? "event" : "events"}` : ""}`}
              className={cn(
                "flex min-h-[58px] flex-col items-center gap-0.5 rounded-[8px] pb-1 pt-1.5 transition-colors",
                picked ? "bg-accent-soft" : "hover:bg-accent-soft/50",
                !inMonth && "opacity-45",
              )}
            >
              <span
                className={cn(
                  "tabular grid size-6 place-items-center rounded-full text-[13px] font-extrabold",
                  isToday && "bg-accent text-on-accent",
                )}
              >
                {Number(day.slice(8))}
              </span>
              {first && (
                <span className="flex items-center">
                  <EventIcon event={first} size={24} />
                  {events.length > 1 && <span className="text-[11px] font-extrabold text-muted">+{events.length - 1}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarView() {
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("date");
  const asked = raw && isDay(raw) ? raw : null;
  const [month, setMonth] = useState(() => monthStart(asked ?? localToday()));
  const [selected, setSelected] = useState<string | null>(asked);
  const [editing, setEditing] = useState<DateItem | { new: string } | null>(null);

  const cells = useMemo(() => monthGrid(month), [month]);
  const fallback = localToday();
  const grid = useCalendar(cells[0]?.day ?? fallback, cells.at(-1)?.day ?? fallback, cells.length > 0);
  const upcomingFrom = grid.data?.today ?? localToday();
  const upcoming = useCalendar(upcomingFrom, addDays(upcomingFrom, 60));
  const dates = useDates();
  const countdowns = useCountdowns();
  const today = upcoming.data?.today ?? grid.data?.today ?? localToday();

  useEffect(() => {
    if (asked) {
      setSelected(asked);
      setMonth(monthStart(asked));
    }
  }, [asked]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of grid.data?.events ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [grid.data]);
  const dateOf = (e: CalendarEvent) => dates.data?.find((d) => d.id === dateIdOf(e.id));
  const day = selected ?? today;
  const inGrid = cells.some((c) => c.day === day);
  const single = useCalendar(day, day, !inGrid);
  const dayEvents = inGrid ? (byDay.get(day) ?? []) : (single.data?.events.filter((e) => e.date === day) ?? []);
  const todayEvents = upcoming.data?.events.filter((e) => e.date === today) ?? [];
  const later = (upcoming.data?.events ?? []).filter((e) => e.date > today).slice(0, 12);
  const otherCountdowns = countdowns.data?.countdowns.slice(1) ?? [];

  const pick = (d: string) => {
    setSelected(d);
    router.replace(`/calendar/?date=${d}`, { scroll: false });
  };

  return (
    <>
      <PageHero title="Calendar" meta={fmtDay(today, "long")}>
        <Button variant="primary" onClick={() => setEditing({ new: day })}>
          <Plus className="size-5" /> Add date
        </Button>
      </PageHero>
      <div className="grid grid-cols-1 gap-6">
        <OccasionCard events={todayEvents} dates={dates.data ?? []} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:grid-rows-[auto_1fr] lg:items-start">
          {countdowns.data && countdowns.data.countdowns.length > 0 && (
            <section aria-label="Countdowns" className="grid grid-cols-1 gap-3 lg:col-start-2 lg:row-start-1">
              <CountdownCard link={false} />
              {otherCountdowns.length > 0 && (
                <DatePanel title="Countdowns">
                  <ul className="grid grid-cols-1 gap-3">
                    {otherCountdowns.map((c) => (
                      <li key={c.id}>
                        <CountdownFace c={c} compact />
                      </li>
                    ))}
                  </ul>
                </DatePanel>
              )}
            </section>
          )}
          <div className="grid grid-cols-1 gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <DatePanel
              title={fmtMonth(month)}
              action={
                <div className="flex items-center gap-1">
                  <IconButton label="Previous month" size="sm" onClick={() => setMonth(addMonths(month, -1))}>
                    <ChevronLeft />
                  </IconButton>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setMonth(monthStart(today));
                      pick(today);
                    }}
                  >
                    Today
                  </Button>
                  <IconButton label="Next month" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
                    <ChevronRight />
                  </IconButton>
                </div>
              }
            >
              <MonthGrid month={month} today={today} selected={day} byDay={byDay} onPick={pick} />
            </DatePanel>
            <DatePanel
              title={fmtDay(day, "long")}
              action={
                <Button size="sm" variant="soft" onClick={() => setEditing({ new: day })}>
                  <Plus className="size-4" /> Add
                </Button>
              }
            >
              {dayEvents.length ? (
                <ul className="grid grid-cols-1 gap-1">
                  {dayEvents.map((e) => (
                    <EventRow key={e.id} e={e} date={dateOf(e)} onEdit={setEditing} />
                  ))}
                </ul>
              ) : (
                <Empty>No events</Empty>
              )}
            </DatePanel>
          </div>
          <DatePanel title="Upcoming" className="lg:col-start-2 lg:row-start-2">
            {upcoming.data && !later.length ? (
              <Empty>No events</Empty>
            ) : (
              <ul className="grid grid-cols-1 gap-1">
                {later.map((e) => (
                  <EventRow
                    key={e.id}
                    e={e}
                    date={dateOf(e)}
                    onEdit={setEditing}
                    showDay={`${fmtDay(e.date, "weekday")} · ${relativeDays(daysBetween(today, e.date))}`}
                  />
                ))}
              </ul>
            )}
          </DatePanel>
        </div>
      </div>
      <DateDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  );
}
