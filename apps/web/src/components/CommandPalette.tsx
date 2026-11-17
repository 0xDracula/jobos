"use client";

import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  BookHeart,
  CassetteTape,
  Compass,
  Disc3,
  Flower2,
  Headphones,
  Heart,
  House,
  Library,
  ListMusic,
  MessageCircleHeart,
  Mic,
  MicVocal,
  NotebookPen,
  Pause,
  Play,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { keys, usePlaylists } from "@/lib/queries";
import type { Track } from "@/lib/types";
import * as controls from "@/player/controls";
import { toggleLikeCurrent, usePalette } from "@/player/shortcuts";
import { usePlayer } from "@/player/store";

import { Artwork } from "./media";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Action = { id: string; label: string; icon: ReactNode; run: () => void };

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-chip px-3 text-[15px] font-semibold data-[selected=true]:bg-accent-soft/70 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted";

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const setOpen = (o: boolean) => usePalette.setState({ open: o });
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const q = useDebounced(query.trim(), 180);
  const playing = usePlayer((s) => s.playing);
  const loaded = usePlayer((s) => s.index >= 0);
  const shuffle = usePlayer((s) => s.shuffle);
  const playlists = usePlaylists();
  const songs = useQuery({
    queryKey: keys.librarySearch(q),
    queryFn: async () => (await api.searchLibrary(q)).tracks,
    enabled: open && q.length > 1,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const close = () => setOpen(false);
  const go = (href: string) => () => router.push(href);
  const actions: Action[] = [
    ...(loaded
      ? [
          { id: "toggle", label: playing ? "Pause" : "Play", icon: playing ? <Pause /> : <Play />, run: controls.toggle },
          { id: "next", label: "Next", icon: <SkipForward />, run: controls.next },
          { id: "previous", label: "Previous", icon: <SkipBack />, run: controls.previous },
          { id: "shuffle", label: shuffle ? "Shuffle off" : "Shuffle on", icon: <Shuffle />, run: () => controls.setShuffle(!shuffle) },
          { id: "repeat", label: "Repeat", icon: <Repeat />, run: controls.cycleRepeat },
          { id: "like", label: "Like", icon: <Heart />, run: toggleLikeCurrent },
          { id: "queue", label: "Queue", icon: <ListMusic />, run: () => controls.expand("queue") },
          { id: "lyrics", label: "Lyrics", icon: <MicVocal />, run: () => controls.expand("lyrics") },
          { id: "sound", label: "Sound", icon: <SlidersHorizontal />, run: () => controls.expand("sound") },
        ]
      : []),
    { id: "home", label: "Home", icon: <House />, run: go("/") },
    { id: "search", label: "Search", icon: <Search />, run: go("/search/") },
    { id: "library", label: "Library", icon: <Library />, run: go("/library/") },
    { id: "chat", label: "Chat", icon: <MessageCircleHeart />, run: go("/chat/") },
    { id: "discover", label: "Discover", icon: <Compass />, run: go("/discover/") },
    { id: "together", label: "Listen together", icon: <Headphones />, run: go("/together/") },
    { id: "our-song", label: "Our song", icon: <Disc3 />, run: go("/song/") },
    { id: "notes", label: "Song notes", icon: <NotebookPen />, run: go("/notes/") },
    { id: "scrapbook", label: "Scrapbook", icon: <BookHeart />, run: go("/scrapbook/") },
    { id: "dedications", label: "Dedications", icon: <Mic />, run: go("/dedications/") },
    { id: "mixtapes", label: "Mixtapes", icon: <CassetteTape />, run: go("/mixtapes/") },
    { id: "favorites", label: "Favorite things", icon: <Flower2 />, run: go("/favorites/") },
    { id: "stars", label: "Star map", icon: <Sparkles />, run: go("/stars/") },
    { id: "settings", label: "Settings", icon: <Settings />, run: go("/settings/") },
    ...(playlists.data ?? []).map((p) => ({
      id: `playlist-${p.id}`,
      label: p.name,
      icon: <ListMusic />,
      run: go(`/playlist/?id=${p.id}`),
    })),
  ];
  const needle = query.trim().toLowerCase();
  const shownActions = needle ? actions.filter((a) => a.label.toLowerCase().includes(needle)) : actions;
  const tracks: Track[] = q.length > 1 ? (songs.data ?? []).slice(0, 8) : [];

  const playSong = (i: number) => controls.playTracks(tracks, i, { type: "search", name: query.trim() });

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      shouldFilter={false}
      value={selected}
      onValueChange={setSelected}
      overlayClassName="fixed inset-0 z-[95] bg-[#1e1b3a]/30 backdrop-blur-[2px]"
      contentClassName="fixed left-1/2 top-[12dvh] z-[96] w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-sheet shadow-soft [background:var(--surface-solid)]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.shiftKey && selected.startsWith("song-")) {
          e.preventDefault();
          const t = tracks[Number(selected.slice(5))];
          if (t) controls.addToQueue([t]);
          close();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="size-5 shrink-0 text-muted" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Songs, actions, playlists"
          className="min-h-14 w-full bg-transparent text-[17px] font-semibold text-ink outline-none placeholder:text-muted focus-visible:outline-none"
        />
      </div>
      <Command.List className="max-h-[min(60dvh,460px)] overflow-y-auto overscroll-contain p-2">
        <Command.Empty className="px-3 py-6 text-center font-semibold text-muted">No results</Command.Empty>
        {tracks.length > 0 && (
          <Command.Group heading="Songs" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-extrabold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
            {tracks.map((t, i) => (
              <Command.Item
                key={t.id}
                value={`song-${i}`}
                onSelect={() => {
                  playSong(i);
                  close();
                }}
                className={itemClass}
              >
                <Artwork src={t.artwork_thumb_url} className="size-9 shrink-0 rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate font-bold">
                    {t.title}
                  </span>
                  <span dir="auto" className="block truncate text-sm text-muted">
                    {t.artists.join(", ")}
                  </span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        {shownActions.length > 0 && (
          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-extrabold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
            {shownActions.map((a) => (
              <Command.Item
                key={a.id}
                value={a.id}
                onSelect={() => {
                  a.run();
                  close();
                }}
                className={itemClass}
              >
                {a.icon}
                <span dir="auto" className="truncate">
                  {a.label}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
      <div className="flex gap-4 border-t border-line px-4 py-2 text-xs font-bold text-muted">
        <span>
          <kbd>Enter</kbd> Play
        </span>
        <span>
          <kbd>Shift Enter</kbd> Add to queue
        </span>
        <span className="ms-auto">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </Command.Dialog>
  );
}
