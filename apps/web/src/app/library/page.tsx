"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { FilterInput, filterTracks, Loading, PlayBar } from "@/components/common";
import { NamePromptDialog } from "@/components/dialogs";
import { CardGrid, Cover, MediaCard } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { Button, Chip, Empty, PageTitle, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOffline } from "@/lib/offline";
import { useCreatePlaylist, useLikes, usePlaylists, useRecent, useTop, type LikeSort } from "@/lib/queries";
import { load, save } from "@/lib/storage";
import type { Track } from "@/lib/types";

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

const TAB_KEY = "jobbos.library-tab";

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
      <PageTitle>Library</PageTitle>
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
