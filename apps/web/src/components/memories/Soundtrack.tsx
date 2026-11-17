"use client";

import { BookOpen, Heart, Image as ImageIcon, MapPin, Mic, Play, Shuffle } from "lucide-react";
import Link from "next/link";

import { totalDuration } from "@/components/common";
import { Artwork, LevelMeter } from "@/components/media";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/days";
import { useMemoriesLive, useSoundtrack, type Moment, type MomentKind } from "@/lib/memories";
import { playTracks } from "@/player/controls";
import { playable, selectCurrent, usePlayer, type PlayContext } from "@/player/store";

const CONTEXT: PlayContext = { type: "playlist", id: "soundtrack", name: "Soundtrack of you two" };

const KINDS: Record<MomentKind, { label: string; icon: typeof Heart }> = {
  our_song: { label: "Our song", icon: Heart },
  chapter: { label: "Chapter", icon: BookOpen },
  memory: { label: "Memory", icon: ImageIcon },
  place: { label: "Place", icon: MapPin },
  dedication: { label: "Dedication", icon: Mic },
};

function hrefOf(m: Moment): string {
  switch (m.kind) {
    case "our_song":
      return "/song/";
    case "chapter":
      return `/story/?chapter=${m.id}`;
    case "memory":
      return `/memories/?id=${m.id}`;
    case "place":
      return `/places/?id=${m.id}`;
    default:
      return "/dedications/";
  }
}

function MomentLine({ m }: { m: Moment }) {
  const { label, icon: Icon } = KINDS[m.kind];
  return (
    <Link href={hrefOf(m)} className="flex min-h-7 min-w-0 items-center gap-1.5 text-sm font-semibold text-muted hover:text-accent-strong">
      <Icon aria-hidden className="size-3.5 shrink-0 text-accent-strong" />
      <span className="sr-only">{label}: </span>
      <span dir="auto" className="truncate">
        {m.kind === "our_song" ? label : m.label}
      </span>
    </Link>
  );
}

export function Soundtrack() {
  useMemoriesLive();
  const q = useSoundtrack();
  const currentId = usePlayer((s) => selectCurrent(s)?.track.id);
  const playing = usePlayer((s) => s.playing && s.context?.id === CONTEXT.id);
  const items = q.data ?? [];
  const tracks = items.map((i) => i.track);
  const canPlay = tracks.some(playable);
  return (
    <>
      <PageHero title="Soundtrack of you two" meta={q.data ? `${items.length} ${items.length === 1 ? "song" : "songs"} · ${totalDuration(tracks)}` : undefined}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!canPlay} onClick={() => playTracks(tracks, -1, CONTEXT, { shuffle: false })}>
            <Play className="size-5 fill-current" /> Play
          </Button>
          <Button disabled={!canPlay} onClick={() => playTracks(tracks, -1, CONTEXT, { shuffle: true })}>
            <Shuffle className="size-5" /> Shuffle
          </Button>
        </div>
      </PageHero>
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      {q.data && !items.length && <Empty>No songs</Empty>}
      <ol className="relative grid gap-1 before:absolute before:inset-y-3 before:start-[19px] before:w-0.5 before:rounded-full before:bg-line sm:before:start-[127px]">
        {items.map((item, i) => {
          const first = item.moments[0];
          const current = item.track.id === currentId;
          return (
            <li key={item.track.id} className="relative grid grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[116px_24px_minmax(0,1fr)]">
              <span className="hidden pt-4 text-end text-sm font-extrabold text-muted sm:block">{first.kind === "our_song" ? "" : fmtDay(first.date, { short: false })}</span>
              <span aria-hidden className="mt-[22px] grid size-[14px] place-self-start justify-self-center rounded-full border-[3px] border-bg bg-accent sm:mt-[20px]" />
              <div className={cn("flex min-w-0 items-start gap-3 rounded-[12px] p-2 transition-colors", current ? "bg-accent-soft/60" : "hover:bg-accent-soft/30")}>
                <button
                  type="button"
                  onClick={() => playTracks(tracks, i, CONTEXT)}
                  aria-label={`Play ${item.track.title}`}
                  className="relative size-14 shrink-0 overflow-hidden rounded-[8px] shadow-[0_6px_14px_rgba(10,8,30,0.25)]"
                >
                  <Artwork src={item.track.artwork_thumb_url} className="size-full" />
                  {current && (
                    <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
                      <LevelMeter playing={playing} />
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => playTracks(tracks, i, CONTEXT)} className="block w-full min-w-0 text-start">
                    <span dir="auto" className={cn("block truncate font-bold", current && "text-accent-strong")}>
                      {item.track.title}
                    </span>
                    <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                      {item.track.artists.join(", ")}
                      <span className="sm:hidden">{first.date && first.kind !== "our_song" ? ` · ${fmtDay(first.date)}` : ""}</span>
                    </span>
                  </button>
                  <div className="mt-0.5 grid">
                    {item.moments.slice(0, 3).map((m, k) => (
                      <MomentLine key={`${m.kind}-${m.id ?? k}`} m={m} />
                    ))}
                    {item.moments.length > 3 && <span className="text-xs font-bold text-muted">+{item.moments.length - 3}</span>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
