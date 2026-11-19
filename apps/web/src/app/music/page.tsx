"use client";

import { Heart, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { NamePromptDialog } from "@/components/dialogs";
import { useNames } from "@/components/letters/Letters";
import { Artwork, Cover } from "@/components/media";
import { HolidaySection, RadioSection } from "@/components/mixes/DiscoverSections";
import { MixShelf, ReleasesShelf, TimeMixShelf } from "@/components/mixes/Mixes";
import { NewForYou } from "@/components/friends/Previews";
import { PageHero } from "@/components/sky/PageHero";
import { IconButton, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtMs, plural } from "@/lib/format";
import { usePicks } from "@/lib/letters";
import { MADE_FOR_YOU, MOOD_MIXES, TIME_MIXES } from "@/lib/mixes";
import { useCreatePlaylist, useLikedIds, usePlaylists, useRecent } from "@/lib/queries";
import type { Track } from "@/lib/types";
import type { PlayContext } from "@/player/store";
import { playTracks } from "@/player/controls";

type View = "for-you" | "library";

const more = "text-[13px] font-bold text-muted hover:text-ink";

function Row({ art, title, sub, trail, onClick, href }: { art: ReactNode; title: string; sub: string; trail?: ReactNode; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      {art}
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[14.5px] font-extrabold">
          {title}
        </span>
        <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
          {sub}
        </span>
      </span>
      {trail}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-[12px] px-1.5 py-1.5 text-start transition-colors hover:bg-surface-2";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

function TrackRows({ tracks, context, trail }: { tracks: Track[]; context: PlayContext; trail?: (t: Track) => ReactNode }) {
  return (
    <ul className="grid gap-0.5">
      {tracks.map((t, i) => (
        <li key={`${t.id}-${i}`}>
          <Row
            art={<Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-[46px] shrink-0 rounded-[8px]" />}
            title={t.title}
            sub={t.artists.join(", ")}
            trail={trail ? trail(t) : <span className="tabular shrink-0 text-[12.5px] font-semibold text-muted">{fmtMs(t.duration_ms)}</span>}
            onClick={() => playTracks(tracks, i, context)}
          />
        </li>
      ))}
    </ul>
  );
}

function Picks() {
  const picks = usePicks().data?.for_me ?? [];
  const names = useNames();
  if (!picks.length) return null;
  const name = `Picks from ${names(picks[0].author_id)}`;
  return (
    <section>
      <SectionTitle>{name}</SectionTitle>
      <div className="lg:[&>ul]:grid-cols-2 lg:[&>ul]:gap-x-6">
        <TrackRows tracks={picks.slice(0, 6).map((p) => p.track)} context={{ type: "queue", id: "picks", name }} />
      </div>
    </section>
  );
}

function ForYou() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
      <NewForYou />
      <HolidaySection />
      <MixShelf title="Made for you" kinds={MADE_FOR_YOU} />
      <Picks />
      <TimeMixShelf kinds={TIME_MIXES} />
      <MixShelf title="Moods" kinds={MOOD_MIXES} />
      <ReleasesShelf />
      <RadioSection />
      <Link href="/discover/" className={cn(more, "justify-self-start")}>
        Weather mix and all mixes
      </Link>
    </div>
  );
}

function LibraryColumn() {
  const playlists = usePlaylists().data ?? [];
  const liked = useLikedIds();
  const recent = useRecent().data?.slice(0, 6) ?? [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-10">
      <section>
        <SectionTitle action={<Link href="/library/?tab=playlists" className={more}>All</Link>}>Library</SectionTitle>
        <ul className="grid gap-0.5">
          {playlists.slice(0, 6).map((p) => (
            <li key={p.id}>
              <Row
                href={`/playlist/?id=${p.id}`}
                art={<Cover cover={p.cover_url} collage={p.collage} className="size-[52px] shrink-0 rounded-[9px]" />}
                title={p.name}
                sub={`Playlist · ${plural(p.counts.total, "song")}`}
              />
            </li>
          ))}
          <li>
            <Row
              href="/library/?tab=likes"
              art={
                <span className="grid size-[52px] shrink-0 place-items-center rounded-[9px] bg-accent text-on-accent">
                  <Heart className="size-5 fill-current" />
                </span>
              }
              title="Likes"
              sub={plural(liked.size, "song")}
            />
          </li>
        </ul>
      </section>
      {recent.length > 0 && (
        <section>
          <SectionTitle action={<Link href="/library/?tab=recent" className={more}>All</Link>}>Recently played</SectionTitle>
          <TrackRows tracks={recent} context={{ type: "history", name: "Recently played" }} />
        </section>
      )}
    </div>
  );
}

export default function MusicPage() {
  const router = useRouter();
  const create = useCreatePlaylist();
  const [view, setView] = useState<View>("for-you");
  const [naming, setNaming] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "library") setView("library");
  }, []);
  const choose = (v: View) => {
    setView(v);
    window.history.replaceState(null, "", v === "library" ? "?view=library" : window.location.pathname);
  };
  return (
    <>
      <PageHero
        title="Music"
        actions={
          <IconButton label="New playlist" onClick={() => setNaming(true)}>
            <Plus />
          </IconButton>
        }
      >
        <Link
          href="/search/"
          className="flex h-[46px] max-w-xl items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 text-[15px] font-semibold text-muted transition-colors hover:border-line-strong"
        >
          <Search className="size-[18px]" />
          Songs, artists, links
        </Link>
        <div role="tablist" aria-label="Music" className="mt-4 flex gap-1.5 lg:hidden">
          {(
            [
              ["for-you", "For you"],
              ["library", "Library"],
            ] as [View, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => choose(v)}
              className={cn(
                "h-9 rounded-full border px-4 text-sm font-extrabold transition-colors",
                view === v ? "border-transparent bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHero>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
        <div className={cn(view !== "for-you" && "max-lg:hidden")}>
          <ForYou />
        </div>
        <div className={cn(view !== "library" && "max-lg:hidden")}>
          <LibraryColumn />
        </div>
      </div>
      <NamePromptDialog
        open={naming}
        onOpenChange={setNaming}
        title="New playlist"
        initial=""
        action="Create"
        onSubmit={(name) => create.mutate({ name }, { onSuccess: (p) => router.push(`/playlist/?id=${p.id}`) })}
      />
    </>
  );
}
