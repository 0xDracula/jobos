"use client";

import { Disc3, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Artwork } from "@/components/media";
import { CoverShelf, Plank } from "@/components/Shelf";
import { SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { releaseTracks, useMixes, useReleases, useSimilar, type MixSummary, type Release } from "@/lib/mixes";
import { toast } from "@/lib/toast";
import { playTracks } from "@/player/controls";

export function MixCover({ src, title, className }: { src: string; title: string; className?: string }) {
  return (
    <img src={src} alt={title} loading="lazy" className={cn("block aspect-square bg-panel [image-rendering:pixelated]", className)} />
  );
}

function MixCard({ mix }: { mix: MixSummary }) {
  return (
    <Link href={`/mix/?kind=${mix.kind}`} className="group grid w-[138px] shrink-0 snap-start gap-1.5 sm:w-[156px] lg:w-[168px]">
      <span className="relative block overflow-hidden rounded-[6px] shadow-soft transition-transform duration-150 group-hover:-translate-y-1">
        <MixCover src={mix.cover_url} title="" className="w-full" />
        {mix.current && (
          <span className="absolute start-1.5 top-1.5 rounded-full bg-[#14122b]/80 px-2 py-0.5 text-[11px] font-extrabold text-white">Now</span>
        )}
      </span>
      <span className="truncate font-extrabold leading-tight">{mix.title}</span>
      <span dir="auto" className="-mt-1 line-clamp-2 text-sm font-semibold leading-snug text-muted">
        {mix.artists.join(", ")}
      </span>
    </Link>
  );
}

export function MixShelf({ title, kinds }: { title: string; kinds: string[] }) {
  const mixes = useMixes().data;
  const shown = kinds.map((k) => mixes?.find((m) => m.kind === k)).filter((m): m is MixSummary => !!m);
  if (!shown.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Plank>
        {shown.map((m) => (
          <MixCard key={m.kind} mix={m} />
        ))}
      </Plank>
    </section>
  );
}

export function TimeMixShelf({ kinds }: { kinds: string[] }) {
  const mixes = useMixes().data;
  const current = mixes?.find((m) => m.current)?.kind;
  const ordered = current ? [current, ...kinds.filter((k) => k !== current)] : kinds;
  return <MixShelf title="Times of day" kinds={ordered} />;
}

const RELEASE_KINDS: Record<string, string> = { album: "Album", ep: "EP", single: "Single", compile: "Compilation" };

function ReleaseCard({ release: r }: { release: Release }) {
  const [busy, setBusy] = useState(false);
  const play = async () => {
    setBusy(true);
    try {
      const tracks = await releaseTracks(r.id);
      if (!tracks.length) toast("Nothing to play");
      else playTracks(tracks, 0, { type: "queue", id: `release:${r.id}`, name: r.title });
    } catch {
      toast("Release unavailable");
    } finally {
      setBusy(false);
    }
  };
  const date = new Date(`${r.release_date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });
  return (
    <button type="button" onClick={() => void play()} disabled={busy} className="group grid w-[138px] shrink-0 snap-start gap-1.5 text-start sm:w-[156px]">
      <span className="relative block overflow-hidden rounded-[6px] shadow-soft transition-transform duration-150 group-hover:-translate-y-1">
        <Artwork src={r.artwork_url} alt="" className="aspect-square w-full" />
        <span className="absolute bottom-1.5 end-1.5 grid size-9 place-items-center rounded-full bg-[#14122b]/80 text-white">
          {busy ? <Disc3 className="size-5 animate-spin" /> : <Play className="size-4 fill-current" />}
        </span>
      </span>
      <span dir="auto" className="truncate font-extrabold leading-tight">
        {r.title}
      </span>
      <span dir="auto" className="-mt-1 truncate text-sm font-semibold text-muted">
        {r.artist} · {RELEASE_KINDS[r.kind] ?? r.kind} · {date}
      </span>
    </button>
  );
}

export function ReleasesShelf() {
  const releases = useReleases().data;
  if (!releases?.length) return null;
  return (
    <section>
      <SectionTitle>New releases</SectionTitle>
      <Plank>
        {releases.map((r) => (
          <ReleaseCard key={r.id} release={r} />
        ))}
      </Plank>
    </section>
  );
}

export function SoundsLike({ trackId, title }: { trackId: string; title: string }) {
  const tracks = useSimilar(trackId).data;
  if (!tracks?.length) return null;
  return (
    <section>
      <SectionTitle>Sounds like</SectionTitle>
      <CoverShelf tracks={tracks} context={{ type: "queue", id: `similar:${trackId}`, name: `Sounds like ${title}` }} label="Sounds like" />
    </section>
  );
}
