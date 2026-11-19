"use client";

import { Heart, Link2 } from "lucide-react";
import Link from "next/link";

import { FriendStrip } from "@/components/friends/people";
import { PreviewsCard } from "@/components/friends/Previews";
import { ContinueHere } from "@/components/ContinueHere";
import { Artwork } from "@/components/media";
import { ReleasesShelf } from "@/components/mixes/Mixes";
import { RowLink, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { useRecent, useTop } from "@/lib/queries";
import { playTracks } from "@/player/controls";

import { NowMusic, RoomBand } from "./Today";

const more = "text-[13px] font-bold text-muted hover:text-ink";
const tile =
  "flex h-14 w-full items-center gap-2.5 overflow-hidden rounded-[10px] border border-line bg-surface pe-2 text-start transition-colors hover:border-line-strong";

function Recent() {
  const recent = useRecent().data ?? [];
  const tiles = recent.slice(0, 5);
  if (!tiles.length) return null;
  return (
    <section>
      <SectionTitle action={<Link href="/library/?tab=recent" className={more}>All</Link>}>Recently played</SectionTitle>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-2.5">
        <li>
          <Link href="/library/?tab=likes" className={tile}>
            <span className="grid size-14 shrink-0 place-items-center bg-accent text-on-accent">
              <Heart className="size-5 fill-current" />
            </span>
            <span className="text-[13px] font-extrabold">Likes</span>
          </Link>
        </li>
        {tiles.map((t, i) => (
          <li key={`${t.id}-${i}`} className={cn(i >= 3 && "max-lg:hidden")}>
            <button type="button" onClick={() => playTracks(recent, i, { type: "history", name: "Recently played" })} className={tile}>
              <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-14 shrink-0 rounded-none" />
              <span dir="auto" className="line-clamp-2 min-w-0 text-[13px] font-extrabold leading-tight">
                {t.title}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OnRepeat() {
  const rows = (useTop().data ?? []).slice(0, 5);
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle action={<Link href="/stats/" className={more}>Stats</Link>}>On repeat</SectionTitle>
      <ol className="grid gap-0.5">
        {rows.map((t, i) => (
          <li key={t.id} className={cn(i >= 3 && "max-lg:hidden")}>
            <button
              type="button"
              onClick={() => playTracks(rows, i, { type: "queue", id: "on-repeat", name: "On repeat" })}
              className="flex w-full items-center gap-3 rounded-[12px] px-1.5 py-1.5 text-start transition-colors hover:bg-surface-2"
            >
              <span className="tabular w-[18px] shrink-0 text-center text-[13px] font-extrabold text-muted">{i + 1}</span>
              <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-[46px] shrink-0 rounded-[8px]" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[14.5px] font-extrabold">
                  {t.title}
                </span>
                <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
                  {t.artists.join(", ")}
                </span>
              </span>
              <span className="tabular shrink-0 text-[12.5px] font-semibold text-muted">{fmtMs(t.duration_ms)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function LinkRow() {
  return <RowLink href="/link/" icon={<Link2 />} title="Link with someone" sub="Invite link" />;
}

export function FriendsSection() {
  return (
    <section>
      <SectionTitle action={<Link href="/friends/?tab=activity" className={more}>All</Link>}>Friends</SectionTitle>
      <FriendStrip />
    </section>
  );
}

export function SoloToday() {
  return (
    <div>
      <RoomBand search={false} />
      <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-8 px-4 pt-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-12 lg:px-6 lg:pt-6">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-8">
          <FriendsSection />
          <ContinueHere className="w-full" />
          <PreviewsCard />
          <NowMusic />
          <Recent />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-8">
          <OnRepeat />
          <ReleasesShelf />
          <LinkRow />
        </div>
      </div>
    </div>
  );
}
