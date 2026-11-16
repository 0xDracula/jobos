"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Failed, Loading, PlayBar } from "@/components/common";
import { Artwork, CardGrid, MediaCard } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { Button, SectionTitle } from "@/components/ui";
import { useArtist } from "@/lib/queries";
import type { Artist } from "@/lib/types";

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
        </div>
      </header>
      {a.bio && (
        <p dir="auto" className="mb-6 max-w-2xl font-semibold leading-relaxed text-muted">
          {a.bio}
        </p>
      )}
      <div className="mb-6">
        <PlayBar tracks={a.tracks} context={context} />
      </div>
      <section className="mb-10">
        <SectionTitle>Songs</SectionTitle>
        <TrackList tracks={all ? a.tracks : a.tracks.slice(0, TOP)} context={context} showAlbum />
        {a.tracks.length > TOP && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
            {all ? "Fewer" : `All ${a.tracks.length} songs`}
          </Button>
        )}
      </section>
      {a.albums.length > 0 && (
        <section>
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
    </>
  );
}
