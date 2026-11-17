"use client";

import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Play } from "lucide-react";
import { useMemo, useState } from "react";

import { Loading } from "@/components/common";
import { Artwork } from "@/components/media";
import { Button, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useOurSong, useTrackNotes, type SongNote } from "@/lib/keepsakes";
import { keys } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { useAlbumColors } from "@/lib/theme";
import type { Track } from "@/lib/types";
import { playFrom } from "@/player/playFrom";

function Lyrics({ track }: { track: Track }) {
  const lyrics = useQuery({ queryKey: keys.lyrics(track.id), queryFn: () => api.lyrics(track.id), retry: false });
  const notes = useTrackNotes(track.id);
  const members = useMembers();
  const [open, setOpen] = useState<number | null>(null);
  const byLine = useMemo(() => {
    const m = new Map<number, SongNote[]>();
    for (const n of notes.data ?? []) if (n.line_index != null) m.set(n.line_index, [...(m.get(n.line_index) ?? []), n]);
    return m;
  }, [notes.data]);
  const v = lyrics.data;
  const lines = v?.status === "synced" ? (v.lines ?? []).map((l) => ({ text: l.text, ms: l.time_ms + v.offset_ms })) : v?.status === "plain" ? (v.plain ?? "").split("\n").map((text) => ({ text, ms: null as number | null })) : [];
  if (!lines.length) return null;
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  return (
    <section className="mt-10">
      <h2 className="mb-3 font-display text-xl font-semibold">Lyrics</h2>
      <div className="grid gap-0.5">
        {lines.map((l, i) => {
          const lineNotes = byLine.get(i);
          return (
            <div key={i}>
              <button
                type="button"
                dir="auto"
                onClick={() => (lineNotes ? setOpen(open === i ? null : i) : void playFrom(track.id, l.ms, "Our song"))}
                aria-expanded={lineNotes ? open === i : undefined}
                className={cn(
                  "block w-full rounded-button px-3 py-1.5 text-start text-xl font-extrabold leading-snug",
                  lineNotes ? "bg-accent-soft/70 text-ink" : "text-ink/70 hover:bg-accent-soft/30",
                )}
              >
                {l.text || "♪"}
                {lineNotes && <NotebookPen aria-label="Note" className="ms-2 inline size-4 text-accent-strong" />}
              </button>
              {open === i &&
                lineNotes?.map((n) => (
                  <div key={n.id} className="mx-3 my-1.5 rounded-[14px] bg-surface-solid/80 px-3 py-2 shadow-soft">
                    <p dir="auto" className="whitespace-pre-wrap font-hand text-xl leading-snug">
                      {n.body}
                    </p>
                    <p className="text-xs font-bold text-muted">{name(n.author_id)}</p>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function OurSongPage() {
  const q = useOurSong();
  const members = useMembers();
  const track = q.data?.track ?? null;
  const { wash } = useAlbumColors(track?.palette);
  if (q.isLoading) return <Loading />;
  if (!track) return <Empty>No song chosen</Empty>;
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  return (
    <div
      className="-mx-4 -mt-4 px-4 pb-10 pt-6 sm:rounded-sheet"
      style={wash ? { background: `linear-gradient(180deg, color-mix(in oklab, ${wash} 30%, transparent), transparent 60%)` } : undefined}
    >
      <div className="grid items-end gap-6 sm:grid-cols-[minmax(0,320px)_1fr]">
        <Artwork src={track.artwork_url ?? track.artwork_thumb_url} className="aspect-square w-full max-w-[320px] rounded-[28px] shadow-soft" eager />
        <div className="min-w-0">
          <h1 dir="auto" className="font-display text-[34px] font-semibold leading-tight lg:text-[44px]">
            {track.title}
          </h1>
          <p dir="auto" className="text-lg font-bold text-muted">
            Our song · {track.artists.join(", ")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void playFrom(track.id, null, "Our song")}>
              <Play className="size-5" /> Play
            </Button>
            {q.data?.plays.map((p) => (
              <span key={p.user_id} className="tabular rounded-full bg-surface-solid/70 px-3 py-1.5 text-sm font-bold">
                {name(p.user_id)} · {p.plays} {p.plays === 1 ? "play" : "plays"}
              </span>
            ))}
          </div>
        </div>
      </div>
      {q.data?.story && (
        <section className="mt-10">
          <h2 className="mb-3 font-display text-xl font-semibold">Story</h2>
          <p dir="auto" className="whitespace-pre-wrap font-hand text-2xl leading-relaxed">
            {q.data.story}
          </p>
        </section>
      )}
      <Lyrics track={track} />
    </div>
  );
}
