"use client";

import { ArrowDownToLine, CircleArrowDown, Headphones, Play, Radio, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { downloadTracks, useOffline } from "@/lib/offline";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { startRadio } from "@/player/radio";
import { playable, type PlayContext } from "@/player/store";

import { SessionForm } from "./together/SessionForm";
import { Button, IconButton, inputClass, Spinner } from "./ui";

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

export function filterTracks(tracks: Track[], needle: string): Track[] {
  const n = fold(needle.trim());
  if (!n) return tracks;
  return tracks.filter((t) => fold([t.title, ...t.artists, t.album ?? ""].join(" ")).includes(n));
}

export function totalDuration(tracks: Track[]): string {
  const minutes = Math.round(tracks.reduce((sum, t) => sum + (t.duration_ms ?? 0), 0) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function FilterInput({ value, onChange, label = "Filter" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={label}
      aria-label={label}
      className={cn(inputClass, "max-w-xs")}
    />
  );
}

export function PlayBar({ tracks, context, download = true }: { tracks: Track[]; context: PlayContext; download?: boolean }) {
  const playableCount = tracks.filter(playable).length;
  const [planning, setPlanning] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled={!playableCount} onClick={() => playTracks(tracks, -1, context, { shuffle: false })}>
        <Play className="size-5 fill-current" /> Play
      </Button>
      <Button disabled={!playableCount} onClick={() => playTracks(tracks, -1, context, { shuffle: true })}>
        <Shuffle className="size-5" /> Shuffle
      </Button>
      {(context.type === "artist" || context.type === "playlist") && context.id && (
        <Button disabled={!playableCount} onClick={() => void startRadio({ type: context.type as "artist" | "playlist", id: context.id, name: context.name })}>
          <Radio className="size-5" /> Radio
        </Button>
      )}
      {(context.type === "artist" || context.type === "playlist" || context.type === "album") && (
        <Button disabled={!playableCount} onClick={() => setPlanning(true)}>
          <Headphones className="size-5" /> Together
        </Button>
      )}
      {download && <DownloadButton tracks={tracks} />}
      {planning && <SessionForm open onOpenChange={setPlanning} trackIds={tracks.filter(playable).map((t) => t.id)} defaultTitle={context.name} />}
    </div>
  );
}

export function DownloadButton({ tracks }: { tracks: Track[] }) {
  const entries = useOffline((s) => s.entries);
  const progress = useOffline((s) => s.progress);
  const candidates = tracks.filter((t) => t.audio || t.source);
  const done = candidates.filter((t) => entries[t.id]).length;
  const running = candidates.some((t) => progress[t.id] !== undefined);
  const complete = candidates.length > 0 && done === candidates.length;
  const label = complete ? "Downloaded" : running ? `Downloading ${done}/${candidates.length}` : "Download";
  return (
    <IconButton
      label={label}
      disabled={!candidates.length || complete || running}
      onClick={() => void downloadTracks(candidates)}
      className={cn(complete && "text-accent-strong")}
    >
      {running ? <Spinner /> : complete ? <CircleArrowDown /> : <ArrowDownToLine />}
      {running && (
        <span className="tabular absolute -bottom-1 rounded-full bg-ink px-1 text-[10px] font-bold text-bg">
          {done}/{candidates.length}
        </span>
      )}
    </IconButton>
  );
}

export function Loading() {
  return (
    <div className="grid place-items-center py-16">
      <Spinner className="size-8 text-muted" />
    </div>
  );
}

export function Failed({ what }: { what: string }) {
  return <p className="py-16 text-center font-semibold text-muted">{what} unavailable</p>;
}
