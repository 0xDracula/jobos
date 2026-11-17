"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Heart } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Failed, Loading, PlayBar } from "@/components/common";
import { Artwork, CardGrid, CardRow, LevelMeter, MediaCard } from "@/components/media";
import { TrackList, TrackMenu, unavailableLabel } from "@/components/tracks";
import { Button, SectionTitle, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { keys, useArtist, useLikedIds } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Artist, TopTrack, Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { playable, selectCurrent, usePlayer } from "@/player/store";

export default function ArtistPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ArtistView />
    </Suspense>
  );
}

function ArtistView() {
  const id = useSearchParams().get("id");
  const q = useArtist(id);
  if (!id) return <Failed what="Artist" />;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed what="Artist" />;
  return <ArtistBody artist={q.data} />;
}

const TOP = 10;
const BIO_SOURCES: Record<string, string> = { wikipedia: "Wikipedia", lastfm: "Last.fm" };

function ArtistBody({ artist: a }: { artist: Artist }) {
  const [all, setAll] = useState(false);
  const context = { type: "artist" as const, id: a.id, name: a.name };
  return (
    <>
      <header className="mb-6 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:text-start">
        <Artwork src={a.image_url} alt={a.name} eager className="size-44 shrink-0 rounded-full shadow-soft lg:size-52" />
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-wider text-muted">Artist</div>
          <h1 dir="auto" className="font-display text-[32px] font-semibold leading-tight lg:text-[44px]">
            {a.name}
          </h1>
          <p className="mt-1 text-sm font-bold text-muted">
            {a.tracks.length} songs · {a.albums.length} albums
          </p>
          {a.tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {a.tags.map((tag) => (
                <li key={tag} className="rounded-full border border-line px-2.5 py-0.5 text-xs font-bold text-muted">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>
      {a.bio && (
        <section className="mb-6 max-w-2xl">
          <p dir="auto" className="font-semibold leading-relaxed text-muted">
            {a.bio}
          </p>
          {a.bio_url && (
            <a
              href={a.bio_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-accent-strong hover:underline"
            >
              {BIO_SOURCES[a.bio_source ?? ""] ?? "Source"}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
        </section>
      )}
      <div className="mb-6">
        <PlayBar tracks={a.tracks} context={context} />
      </div>
      {a.top_tracks.length > 0 && (
        <section className="mb-10">
          <SectionTitle>Top songs</SectionTitle>
          <TopSongs artist={a} />
        </section>
      )}
      {a.tracks.length > 0 && (
        <section className="mb-10">
          <SectionTitle>Songs</SectionTitle>
          <TrackList tracks={all ? a.tracks : a.tracks.slice(0, TOP)} context={context} showAlbum />
          {a.tracks.length > TOP && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
              {all ? "Fewer" : `All ${a.tracks.length} songs`}
            </Button>
          )}
        </section>
      )}
      {a.albums.length > 0 && (
        <section className="mb-10">
          <SectionTitle>Albums</SectionTitle>
          <CardGrid>
            {a.albums.map((al) => (
              <MediaCard
                key={al.id}
                href={`/album/?id=${al.id}`}
                image={<Artwork src={al.artwork_url} className="size-full" />}
                title={al.title}
                subtitle={`${al.tracks} songs`}
              />
            ))}
          </CardGrid>
        </section>
      )}
      {a.similar.length > 0 && (
        <section>
          <SectionTitle>Similar artists</SectionTitle>
          <CardRow>
            {a.similar.map((s) => (
              <MediaCard
                key={s.name}
                href={s.artist_id ? `/artist/?id=${s.artist_id}` : undefined}
                round
                image={<Artwork src={s.image_url} className="size-full" />}
                title={s.name}
              />
            ))}
          </CardRow>
        </section>
      )}
    </>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function whenPlayable(track: Track, tries = 40): Promise<Track | null> {
  let t = track;
  for (let i = 0; i < tries && !playable(t); i++) {
    if (t.status === "failed" || t.match_status === "unmatched") return null;
    await sleep(3000);
    t = await api.track(t.id);
  }
  return playable(t) ? t : null;
}

function TopSongs({ artist }: { artist: Artist }) {
  const qc = useQueryClient();
  const liked = useLikedIds();
  const currentId = usePlayer((s) => selectCurrent(s)?.track.id);
  const playing = usePlayer((s) => s.playing);
  const [busy, setBusy] = useState<number | null>(null);
  const context = { type: "artist" as const, id: artist.id, name: artist.name };

  const play = async (top: TopTrack) => {
    const ready = artist.top_tracks.map((t) => t.track).filter((t): t is Track => !!t && playable(t));
    if (top.track && playable(top.track)) return playTracks(ready, ready.indexOf(top.track), context);
    setBusy(top.rank);
    try {
      const added = await api.artistTopTrack(artist.id, top.rank);
      void qc.invalidateQueries({ queryKey: keys.artist(artist.id) });
      if (!playable(added)) toast("Matching");
      const t = playable(added) ? added : await whenPlayable(added);
      if (t) playTracks([t], 0, context);
      else toast(`Unavailable: ${top.title}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Unavailable: ${top.title}`);
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: keys.artist(artist.id) });
    }
  };

  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {artist.top_tracks.map((top) => (
        <TopSongRow
          key={top.rank}
          top={top}
          current={!!top.track && top.track.id === currentId}
          playing={playing}
          liked={!!top.track && liked.has(top.track.id)}
          busy={busy === top.rank}
          onPlay={() => void play(top)}
        />
      ))}
    </ul>
  );
}

function TopSongRow({
  top,
  current,
  playing,
  liked,
  busy,
  onPlay,
}: {
  top: TopTrack;
  current: boolean;
  playing: boolean;
  liked: boolean;
  busy: boolean;
  onPlay: () => void;
}) {
  const t = top.track;
  const unavailable = t && t.match_status !== "pending" ? unavailableLabel(t) : null;
  return (
    <li
      className={cn(
        "row-auto group relative flex items-center gap-3 rounded-button py-1.5 pe-1 ps-2 transition-colors hover:bg-accent-soft/35",
        current && "bg-accent-soft/45",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        disabled={busy}
        aria-label={`Play ${top.title}`}
        aria-current={current ? "true" : undefined}
        className="absolute inset-0 rounded-button"
      />
      <span className="tabular hidden w-6 shrink-0 text-end text-sm font-bold text-muted sm:block">{top.rank}</span>
      <div className={cn("pointer-events-none relative size-12 shrink-0", unavailable && "opacity-45")}>
        <Artwork src={t?.artwork_thumb_url ?? top.artwork_url} className="size-12 rounded-chip" />
        {(current || busy) && (
          <span className="absolute inset-0 grid place-items-center rounded-chip bg-[#1e1b3a]/40 text-white">
            {busy ? <Spinner className="size-5" /> : <LevelMeter playing={playing} />}
          </span>
        )}
      </div>
      <div className={cn("pointer-events-none min-w-0 flex-1", unavailable && "opacity-55")}>
        <div dir="auto" className={cn("truncate font-bold leading-snug", current && "text-accent-strong")}>
          {top.title}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-muted">
          {liked && <Heart aria-label="Liked" className="size-3.5 shrink-0 fill-accent text-accent" />}
          <span dir="auto" className="truncate">
            {top.album ?? t?.album ?? ""}
          </span>
        </div>
      </div>
      <div className="pointer-events-none flex shrink-0 items-center gap-2">
        {unavailable && <span className="rounded-full bg-butter/80 px-2 py-0.5 text-xs font-bold text-[#5b4a1f]">{unavailable}</span>}
        <span className="tabular hidden w-11 text-end text-sm font-semibold text-muted sm:block">
          {fmtMs(top.duration_ms ?? t?.duration_ms ?? null)}
        </span>
      </div>
      {t ? <TrackMenu track={t} /> : <span aria-hidden className="size-10 shrink-0" />}
    </li>
  );
}
