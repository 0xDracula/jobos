"use client";

import { Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button } from "@/components/ui";
import { dateIdOf } from "@/lib/dateMath";
import type { CalendarEvent, DateItem } from "@/lib/dates";
import { usePlaylist } from "@/lib/queries";
import { useIsAdmin } from "@/lib/session";
import { playTracks } from "@/player/controls";

import { EventIcon, isHiddenSurprise } from "./parts";

const CONFETTI = ["#f2a7b8", "#ffd98a", "#c9b8f0", "#c8dcc0", "#8fc8ec", "#e88fa3"];

function Confetti() {
  const reduced = useReducedMotion();
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((c, i) => (
        <motion.span
          key={c}
          className="absolute size-2"
          style={{ background: c, left: `${8 + i * 16}%`, top: 6 + (i % 3) * 10 }}
          animate={reduced ? undefined : { y: [0, 10, 0], rotate: [0, 90, 180] }}
          transition={{ duration: 3 + i * 0.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function OccasionPlaylist({ date }: { date: DateItem | undefined }) {
  const admin = useIsAdmin();
  const list = usePlaylist(date?.playlist_id ?? null);
  if (!date?.playlist_id) {
    return admin ? (
      <span className="inline-flex items-center gap-2 font-bold text-muted">
        Playlist <PlaceholderMark />
      </span>
    ) : null;
  }
  const p = list.data;
  return (
    <Button
      variant="primary"
      className="max-w-full"
      disabled={!p?.tracks.length}
      onClick={() => p && playTracks(p.tracks, -1, { type: "playlist", id: p.id, name: p.name }, { shuffle: true })}
    >
      <Play className="size-4 shrink-0 fill-current" />
      <span dir="auto" className="truncate">
        {p?.name ?? "Playlist"}
      </span>
    </Button>
  );
}

export function OccasionCard({ events, dates }: { events: CalendarEvent[]; dates: DateItem[] }) {
  const occasions = events.filter((e) => (e.kind === "birthday" || e.kind === "anniversary") && !isHiddenSurprise(e));
  if (!occasions.length) return null;
  const letters = events.filter((e) => e.kind === "letter_unlock");
  return (
    <section className="relative overflow-hidden rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel p-4 sm:p-5">
      <Confetti />
      <div className="relative grid gap-4">
        {occasions.map((o) => {
          const date = dates.find((d) => d.id === dateIdOf(o.id));
          return (
            <div key={o.id} className="flex flex-wrap items-center gap-4">
              <motion.span initial={{ scale: 0.6, y: 8 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 18 }}>
                <EventIcon event={o} size={72} />
              </motion.span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold uppercase tracking-wide text-muted">Today</p>
                <h2 dir="auto" className="font-display text-2xl font-semibold leading-tight sm:text-3xl">
                  {o.title}
                </h2>
              </div>
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                <OccasionPlaylist date={date} />
              </div>
            </div>
          );
        })}
        {letters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {letters.map((l) =>
              l.link ? (
                <Link key={l.id} href={l.link} className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-soft/70 px-4 font-semibold hover:bg-accent-soft">
                  <PixelIcon name="seal" size={24} />
                  <span dir="auto">{l.title || "Letter"}</span>
                </Link>
              ) : (
                <span key={l.id} className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-soft/50 px-4 font-semibold">
                  <PixelIcon name="seal" size={24} />
                  <span dir="auto">{l.title || "Letter"}</span>
                </span>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}
