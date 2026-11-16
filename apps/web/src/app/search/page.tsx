"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, Link2, ListEnd, ListPlus, ListStart, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useDebounced } from "@/components/common";
import { openAddToPlaylist, providerLabel } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { Button, inputClass, Menu, MenuContent, MenuItem, MenuTrigger, PageTitle, SectionTitle, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { keys } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { SearchResult, Track } from "@/lib/types";
import { addToQueue, playNext, playTracks } from "@/player/controls";
import { playable } from "@/player/store";

const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function whenPlayable(track: Track, tries = 60): Promise<Track | null> {
  let t = track;
  for (let i = 0; i < tries && !playable(t); i++) {
    if (t.status === "failed") return null;
    await sleep(3000);
    t = await api.track(t.id);
  }
  return playable(t) ? t : null;
}

const resultKey = (r: SearchResult) => `${r.provider}:${r.external_id}`;

export default function SearchPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const link = isLink(q);
  const ready = q.length > 1 && !link;

  const library = useQuery({
    queryKey: keys.librarySearch(q),
    queryFn: async () => (await api.searchLibrary(q)).tracks,
    enabled: ready,
  });
  const songs = useQuery({
    queryKey: keys.search(q, "ytmusic"),
    queryFn: async () => (await api.search(q, "ytmusic")).results,
    enabled: ready,
    staleTime: 10 * 60_000,
  });
  const more = useQuery({
    queryKey: keys.search(q, "youtube,soundcloud"),
    queryFn: async () => (await api.search(q, "youtube,soundcloud")).results,
    enabled: ready,
    staleTime: 10 * 60_000,
  });
  const online = useMemo(() => {
    const seen = new Set<string>();
    return [...(songs.data ?? []), ...(more.data ?? [])].filter((r) => {
      const k = resultKey(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [songs.data, more.data]);

  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const withTrack = async (r: SearchResult, then: (t: Track) => void) => {
    setBusy(resultKey(r));
    try {
      const t = await api.addTrack(r);
      void qc.invalidateQueries({ queryKey: ["library-search"] });
      if (playable(t)) return then(t);
      toast("Downloading");
      const ready = await whenPlayable(t);
      if (ready) then(ready);
      else toast(`Unavailable: ${t.title}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Add failed");
    } finally {
      setBusy(null);
    }
  };

  const importLink = async () => {
    setImporting(true);
    try {
      const res = await api.importLink(q);
      if (res.track) {
        const t = res.track;
        const ready = playable(t) ? t : (toast("Downloading"), await whenPlayable(t));
        if (ready) playTracks([ready], 0, { type: "search", name: ready.title });
        else toast(`Unavailable: ${t.title}`);
      } else if (res.playlist) {
        void qc.invalidateQueries({ queryKey: keys.playlists });
        toast(res.truncated ? `Imported ${res.playlist.tracks} songs (first page only)` : `Imported ${res.playlist.tracks} songs`);
        router.push(`/playlist/?id=${res.playlist.playlist_id}`);
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <PageTitle>Search</PageTitle>
      <div className="relative mb-8">
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Songs, artists, links"
          aria-label="Search"
          autoFocus
          dir="auto"
          className={cn(inputClass, "min-h-14 rounded-card ps-12 text-[17px] shadow-soft")}
        />
      </div>

      {link && (
        <section className="mb-10 flex items-center gap-3 rounded-card bg-surface-solid/70 p-4 shadow-soft">
          <Link2 className="size-6 shrink-0 text-accent-strong" />
          <span className="min-w-0 flex-1 truncate font-semibold">{q}</span>
          <Button variant="primary" onClick={() => void importLink()} disabled={importing} className="shrink-0">
            {importing && <Spinner className="size-5" />} Import link
          </Button>
        </section>
      )}

      {ready && (
        <>
          <section className="mb-10">
            <SectionTitle>Library</SectionTitle>
            {library.isLoading ? (
              <Spinner className="size-6 text-muted" />
            ) : library.data?.length ? (
              <TrackList tracks={library.data.slice(0, 20)} context={{ type: "search", name: q }} showAlbum />
            ) : (
              <p className="font-semibold text-muted">No matches</p>
            )}
          </section>
          <section>
            <SectionTitle action={(songs.isFetching || more.isFetching) && <Spinner className="size-5 text-muted" />}>Everywhere</SectionTitle>
            <ul className="grid grid-cols-1 gap-0.5">
              {online.map((r) => (
                <OnlineRow
                  key={resultKey(r)}
                  result={r}
                  busy={busy === resultKey(r)}
                  onPlay={() => void withTrack(r, (t) => playTracks([t], 0, { type: "search", name: q }))}
                  onNext={() => void withTrack(r, (t) => playNext([t]))}
                  onQueue={() => void withTrack(r, (t) => addToQueue([t]))}
                  onPlaylist={() => void withTrack(r, (t) => openAddToPlaylist([t]))}
                />
              ))}
            </ul>
            {!online.length && !songs.isFetching && !more.isFetching && <p className="font-semibold text-muted">No results</p>}
          </section>
        </>
      )}
    </>
  );
}

function OnlineRow({
  result: r,
  busy,
  onPlay,
  onNext,
  onQueue,
  onPlaylist,
}: {
  result: SearchResult;
  busy: boolean;
  onPlay: () => void;
  onNext: () => void;
  onQueue: () => void;
  onPlaylist: () => void;
}) {
  return (
    <li className="row-auto relative flex items-center gap-3 rounded-button py-1.5 pe-1 ps-2 hover:bg-accent-soft/35">
      <button type="button" onClick={onPlay} aria-label={`Play ${r.title}`} className="absolute inset-0 rounded-button" />
      <div className="pointer-events-none relative size-12 shrink-0">
        <Artwork src={r.thumbnail} className="size-12 rounded-chip" />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-chip bg-[#1e1b3a]/40 text-white">
            <Spinner className="size-5" />
          </span>
        )}
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        <div dir="auto" className="truncate font-bold">
          {r.title}
        </div>
        <div dir="auto" className="truncate text-sm font-semibold text-muted">
          {[r.artists.map((a) => a.name).join(", "), r.album?.name].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span className="pointer-events-none rounded-full border border-line px-2 py-0.5 text-xs font-bold text-muted">
        {providerLabel(r.provider)}
      </span>
      <span className="tabular pointer-events-none hidden w-11 text-end text-sm font-semibold text-muted sm:block">{fmtMs(r.duration_ms)}</span>
      <Menu modal={false}>
        <MenuTrigger
          aria-label={`More for ${r.title}`}
          className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-accent-soft/60 hover:text-ink"
        >
          <Ellipsis className="size-5" />
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem icon={<ListStart />} onSelect={onNext}>
            Play next
          </MenuItem>
          <MenuItem icon={<ListEnd />} onSelect={onQueue}>
            Add to queue
          </MenuItem>
          <MenuItem icon={<ListPlus />} onSelect={onPlaylist}>
            Add to playlist
          </MenuItem>
        </MenuContent>
      </Menu>
    </li>
  );
}
