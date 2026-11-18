"use client";

import { Play, Settings } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/avatar";
import { DATE_KEEPSAKES } from "@/components/keepsakes/dates";
import { LETTER_KEEPSAKES } from "@/components/keepsakes/letters";
import { MEMORY_KEEPSAKES } from "@/components/keepsakes/memories";
import { TOGETHER_KEEPSAKES } from "@/components/keepsakes/together";
import { Artwork } from "@/components/media";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { KEEPSAKES, type Keepsake } from "@/components/Shelf";
import { PageHero } from "@/components/sky/PageHero";
import { ComingUp } from "@/components/today/Today";
import { LinkRow } from "@/components/today/SoloToday";
import { SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useCountdowns } from "@/lib/dates";
import { useOurSong } from "@/lib/keepsakes";
import { useJar, useLetterCounts } from "@/lib/letters";
import { useMode } from "@/lib/pair";
import { playTracks } from "@/player/controls";

const main = (href: string) => KEEPSAKES.filter((k) => k.href === href);

const GROUPS: { title: string; items: Keepsake[] }[] = [
  { title: "Letters and notes", items: [...LETTER_KEEPSAKES, ...main("/notes/")] },
  { title: "Memories", items: MEMORY_KEEPSAKES },
  { title: "Dates", items: DATE_KEEPSAKES },
  { title: "Together", items: [...TOGETHER_KEEPSAKES, ...["/dedications/", "/mixtapes/", "/scrapbook/", "/favorites/", "/stars/"].flatMap(main)] },
];

const PARTNER_ONLY = new Set(["/letters/", "/jar/", "/promises/", "/story/", "/reminds/", "/stars/", "/song/"]);

function OurSong() {
  const q = useOurSong().data;
  const t = q?.track;
  if (!t) return null;
  const plays = [...(q.plays ?? [])].sort((a, b) => a.plays - b.plays);
  return (
    <section>
      <SectionTitle action={<Link href="/song/" className="text-[13px] font-bold text-muted hover:text-ink">Story</Link>}>Our song</SectionTitle>
      <article className="relative flex items-center gap-3.5 rounded-card border border-line bg-surface p-3 lg:grid lg:gap-3.5 lg:p-3.5">
        <Artwork src={t.artwork_url ?? t.artwork_thumb_url} className="size-[84px] shrink-0 rounded-[12px] lg:aspect-square lg:size-auto lg:w-full" />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-xl font-extrabold tracking-[-0.01em]">
            {t.title}
          </p>
          <p dir="auto" className="truncate text-sm font-semibold text-muted">
            {t.artists.join(", ")}
          </p>
          {plays.length > 0 && (
            <p className="mt-2 flex items-center gap-3 text-[13.5px] font-extrabold">
              {plays.map((p) => (
                <span key={p.user_id} className="tabular inline-flex items-center gap-1.5">
                  <span className="overflow-hidden rounded-full bg-surface-2">
                    <Avatar userId={p.user_id} size={20} />
                  </span>
                  {p.plays}
                </span>
              ))}
              <span className="text-[12.5px] font-semibold text-muted">plays</span>
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Play ${t.title}`}
          onClick={() => playTracks([t], 0, { type: "queue", name: "Our song" })}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-95 lg:absolute lg:end-7 lg:top-[calc(100%-9.5rem)] lg:size-14"
        >
          <Play className="ms-0.5 size-5 fill-current" />
        </button>
      </article>
    </section>
  );
}

function Tiles({ items }: { items: Keepsake[] }) {
  const letters = useLetterCounts();
  const jar = useJar().data;
  const badge = (href: string) => (href === "/letters/" ? letters.unopened : href === "/jar/" && jar?.waiting ? 1 : 0);
  return (
    <nav className="grid grid-cols-4 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(124px,1fr))] sm:gap-2.5">
      {items.map((k) => {
        const n = badge(k.href);
        return (
          <Link
            key={k.href}
            href={k.href}
            className="relative grid min-h-[100px] min-w-0 content-start justify-items-center gap-2 rounded-card border border-line bg-surface px-1 pb-2.5 pt-3.5 text-center text-xs font-bold leading-tight text-ink-2 transition-colors hover:border-line-strong hover:text-ink sm:min-h-[108px] sm:text-[12.5px]"
          >
            <PixelIcon name={k.icon} size={36} />
            <span className="text-balance">{k.label}</span>
            {n > 0 && (
              <span className="absolute end-2 top-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-extrabold text-on-accent">
                {k.href === "/jar/" ? "" : n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default function UsPage() {
  const hasCountdown = !!useCountdowns().data?.countdowns.length;
  const mode = useMode();
  if (mode === "solo") {
    return (
      <>
        <PageHero title="Us" />
        <div className="max-w-xl">
          <LinkRow />
        </div>
      </>
    );
  }
  const friend = mode === "friend";
  const groups = GROUPS.map((g) =>
    friend ? { title: g.title === "Letters and notes" ? "Songs and notes" : g.title, items: g.items.filter((k) => !PARTNER_ONLY.has(k.href)) } : g,
  ).filter((g) => g.items.length);
  return (
    <>
      <PageHero
        title="Us"
        actions={
          <Link href="/settings/" aria-label="Settings" className="grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2">
            <Settings className="size-[22px]" />
          </Link>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-12">
        <div className={cn("grid grid-cols-[minmax(0,1fr)] content-start gap-8 lg:sticky lg:top-10")}>
          {!friend && <OurSong />}
          {hasCountdown && (
            <section>
              <SectionTitle action={<Link href="/calendar/" className="text-[13px] font-bold text-muted hover:text-ink">Calendar</Link>}>Coming up</SectionTitle>
              <ComingUp />
            </section>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-8">
          {groups.map((g) => (
            <section key={g.title}>
              <SectionTitle>{g.title}</SectionTitle>
              <Tiles items={g.items} />
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
