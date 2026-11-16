"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Failed, Loading, PlayBar, totalDuration } from "@/components/common";
import { Artwork } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { useAlbum } from "@/lib/queries";
import type { Album } from "@/lib/types";

export default function AlbumPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AlbumView />
    </Suspense>
  );
}

function AlbumView() {
  const id = useSearchParams().get("id");
  const q = useAlbum(id);
  if (!id) return <Failed what="Album" />;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed what="Album" />;
  return <AlbumBody album={q.data} />;
}

function AlbumBody({ album: a }: { album: Album }) {
  const ids = new Map<string, string>();
  for (const t of a.tracks) t.artists.forEach((name, i) => t.artist_ids[i] && ids.set(name, t.artist_ids[i]));
  const context = { type: "album" as const, id: a.id, name: a.title };
  return (
    <>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Artwork src={a.artwork_url} alt={a.title} eager className="size-48 shrink-0 rounded-card shadow-soft lg:size-56" />
        <div className="min-w-0">
          <div className="text-xs font-extrabold uppercase tracking-wider text-muted">Album</div>
          <h1 dir="auto" className="font-display text-[30px] font-semibold leading-tight lg:text-[40px]">
            {a.title}
          </h1>
          <p className="mt-1 font-bold">
            {a.artists.map((name, i) => (
              <span key={name}>
                {i > 0 && ", "}
                {ids.get(name) ? (
                  <Link href={`/artist/?id=${ids.get(name)}`} dir="auto" className="hover:underline">
                    {name}
                  </Link>
                ) : (
                  <span dir="auto">{name}</span>
                )}
              </span>
            ))}
          </p>
          <p className="mt-1 text-sm font-bold text-muted">
            {[a.year, `${a.tracks.length} songs`, totalDuration(a.tracks)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>
      <div className="mb-5">
        <PlayBar tracks={a.tracks} context={context} />
      </div>
      <TrackList tracks={a.tracks} context={context} numbered />
    </>
  );
}
