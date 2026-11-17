"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FilterInput, filterTracks, Loading, PlayBar } from "@/components/common";
import { NamePromptDialog } from "@/components/dialogs";
import { Artwork, CardGrid, Cover, MediaCard } from "@/components/media";
import { CoverShelf, KeepsakeTiles } from "@/components/Shelf";
import { PageHero } from "@/components/sky/PageHero";
import { TrackList } from "@/components/tracks";
import { Button, Chip, Empty, SectionTitle, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useMixtapes } from "@/lib/gift";
import { MOOD_LABELS, WEATHER_CONDITIONS, useWeatherMix } from "@/lib/mixes";
import { useOffline } from "@/lib/offline";
import { useCreatePlaylist, useLikedIds, useLikes, usePlaylists, useRecent, useTop, type LikeSort } from "@/lib/queries";
import { load, save } from "@/lib/storage";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

type Tab = "likes" | "playlists" | "recent" | "top";
const TABS: [Tab, string][] = [
  ["likes", "Likes"],
  ["playlists", "Playlists"],
  ["recent", "Recently played"],
  ["top", "Most played"],
];

function useSongFilter(tracks: Track[] | undefined) {
  const [text, setText] = useState("");
  const [downloaded, setDownloaded] = useState(false);
  const entries = useOffline((s) => s.entries);
  const shown = useMemo(() => {
    const list = filterTracks(tracks ?? [], text);
    return downloaded ? list.filter((t) => entries[t.id]) : list;
  }, [tracks, text, downloaded, entries]);
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <FilterInput value={text} onChange={setText} />
      <Chip selected={downloaded} onClick={() => setDownloaded((d) => !d)}>
        Downloaded
      </Chip>
    </div>
  );
  return { shown, controls };
}

function Likes() {
  const [sort, setSort] = useState<LikeSort>("added");
  const likes = useLikes(sort);
  const { shown, controls } = useSongFilter(likes.data);
  if (likes.isLoading) return <Loading />;
  if (!likes.data?.length) return <Empty>No likes yet</Empty>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <PlayBar tracks={likes.data} context={{ type: "likes", name: "Likes" }} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            ["added", "Date added"],
            ["title", "Title"],
            ["artist", "Artist"],
          ]}
        />
        {controls}
      </div>
      <TrackList tracks={shown} context={{ type: "likes", name: "Likes" }} showAlbum />
    </div>
  );
}

function Playlists() {
  const playlists = usePlaylists();
  const create = useCreatePlaylist();
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <Button variant="primary" onClick={() => setNaming(true)}>
          <Plus className="size-5" /> New playlist
        </Button>
      </div>
      {playlists.isLoading ? (
        <Loading />
      ) : playlists.data?.length ? (
        <CardGrid>
          {playlists.data.map((p) => (
            <MediaCard
              key={p.id}
              href={`/playlist/?id=${p.id}`}
              image={<Cover cover={p.cover_url} collage={p.collage} className="size-full" />}
              title={p.name}
              subtitle={`${p.counts.total} songs`}
            />
          ))}
        </CardGrid>
      ) : (
        <Empty>No playlists</Empty>
      )}
      <NamePromptDialog
        open={naming}
        onOpenChange={setNaming}
        title="New playlist"
        initial=""
        action="Create"
        onSubmit={(name) => create.mutate({ name }, { onSuccess: (p) => router.push(`/playlist/?id=${p.id}`) })}
      />
    </div>
  );
}

function History({ which }: { which: "recent" | "top" }) {
  const recent = useRecent();
  const top = useTop();
  const q = which === "recent" ? recent : top;
  const name = which === "recent" ? "Recently played" : "Most played";
  const { shown, controls } = useSongFilter(q.data);
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Empty>No plays yet</Empty>;
  return (
    <div className="grid grid-cols-1 gap-4">
      <PlayBar tracks={q.data} context={{ type: "history", name }} download={false} />
      {controls}
      <TrackList tracks={shown} context={{ type: "history", name }} showAlbum />
    </div>
  );
}

function Overview() {
  const recent = useRecent();
  const top = useTop();
  const playlists = usePlaylists();
  const mix = useWeatherMix();
  const recentTracks = recent.data?.slice(0, 16) ?? [];
  const topTracks = top.data?.slice(0, 5) ?? [];
  return (
    <div className="mb-12 grid grid-cols-1 gap-10">
      <KeepsakeTiles />
      {recentTracks.length > 0 && (
        <section>
          <SectionTitle>Recently played</SectionTitle>
          <CoverShelf tracks={recentTracks} context={{ type: "history", name: "Recently played" }} label="Recently played" />
        </section>
      )}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-8">
        <section>
          <SectionTitle>Most played</SectionTitle>
          {topTracks.length ? (
            <ol className="grid gap-0.5 rounded-[10px] border border-panel-line bg-panel p-2">
              {topTracks.map((t, i) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => playTracks(topTracks, i, { type: "history", name: "Most played" })}
                    className="flex w-full items-center gap-3 rounded-[8px] p-1.5 text-start hover:bg-accent-soft/50"
                  >
                    <span className="tabular w-5 shrink-0 text-end text-sm font-extrabold text-muted">{i + 1}</span>
                    <Artwork src={t.artwork_thumb_url} className="size-11 shrink-0 rounded-[5px]" />
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate font-extrabold">
                        {t.title}
                      </span>
                      <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                        {t.artists.join(", ")}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-bold text-muted">{plural(t.plays, "play")}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No plays yet</Empty>
          )}
        </section>
        <div className="grid content-start gap-10">
          {mix.data && mix.data.tracks.length > 0 && (
            <section>
              <SectionTitle>Weather mix</SectionTitle>
              <div className="flex items-center gap-4 rounded-[10px] border border-panel-line bg-[linear-gradient(135deg,var(--panel),color-mix(in_oklab,var(--accent-soft)_70%,var(--panel)))] p-3">
                <div className="grid size-24 shrink-0 grid-cols-2 overflow-hidden rounded-[6px]">
                  {mix.data.tracks.slice(0, 4).map((t) => (
                    <Artwork key={t.id} src={t.artwork_thumb_url} className="size-12" />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold leading-tight">
                    {WEATHER_CONDITIONS[mix.data.weather.condition] ?? mix.data.weather.condition} · {Math.round(mix.data.weather.temperature_c)}°
                  </p>
                  <p className="text-sm font-bold text-muted">
                    {MOOD_LABELS[mix.data.mood]} · {plural(mix.data.tracks.length, "song")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => playTracks(mix.data!.tracks, 0, { type: "queue", id: "weather-mix", name: "Weather mix" })}>
                      <Play className="size-4" /> Play
                    </Button>
                    <Link href="/discover/" className="inline-flex min-h-9 items-center rounded-button px-3 text-sm font-bold hover:bg-accent-soft/50">
                      Discover
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          )}
          <section>
            <SectionTitle>Playlists</SectionTitle>
            <ul className="grid gap-1">
              {playlists.data?.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link href={`/playlist/?id=${p.id}`} className="flex items-center gap-3 rounded-[8px] p-1.5 hover:bg-accent-soft/50">
                    <Cover cover={p.cover_url} collage={p.collage} className="size-12 shrink-0 rounded-[6px]" />
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate font-extrabold">
                        {p.name}
                      </span>
                      <span className="text-sm font-semibold text-muted">{plural(p.counts.total, "song")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

const TAB_KEY = "jobbos.library-tab";

function LibraryHero() {
  const playlists = usePlaylists();
  const liked = useLikedIds();
  const mixtapes = useMixtapes();
  const meta = [
    playlists.data && plural(playlists.data.length, "playlist"),
    plural(liked.size, "liked song"),
    mixtapes.data && plural(mixtapes.data.length, "mixtape"),
  ].filter(Boolean);
  return <PageHero title="Library" meta={meta.join(" · ")} />;
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("likes");
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    const initial = fromUrl ?? load<Tab | null>(TAB_KEY, null);
    if (initial && TABS.some(([t]) => t === initial)) setTab(initial);
  }, []);
  const choose = (t: string) => {
    setTab(t as Tab);
    save(TAB_KEY, t);
  };
  return (
    <>
      <LibraryHero />
      <Overview />
      <SectionTitle>Songs</SectionTitle>
      <Tabs.Root value={tab} onValueChange={choose}>
        <Tabs.List aria-label="Library" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          {TABS.map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className={cn(
                "min-h-10 shrink-0 rounded-full px-4 text-sm font-bold transition-colors",
                "data-[state=active]:bg-ink data-[state=active]:text-bg data-[state=inactive]:bg-surface-solid/60 data-[state=inactive]:hover:bg-accent-soft/60",
              )}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="likes">
          <Likes />
        </Tabs.Content>
        <Tabs.Content value="playlists">
          <Playlists />
        </Tabs.Content>
        <Tabs.Content value="recent">
          <History which="recent" />
        </Tabs.Content>
        <Tabs.Content value="top">
          <History which="top" />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}
