"use client";

import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState } from "react";

import { Artwork } from "@/components/media";
import { Button, Field, IconButton, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useDebounced } from "@/components/common";
import { useMe, useMembers } from "@/lib/session";
import { socialApi, socialKeys, useSwaps, type Swap } from "@/lib/social";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { Dialog } from "./dialogs";

function PickRow({ s, label }: { s: Swap; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface p-2">
      {s.track ? <Artwork src={s.track.artwork_thumb_url ?? s.track.artwork_url} className="size-12 shrink-0 rounded-[10px]" /> : <div className="size-12 shrink-0 rounded-[10px] bg-accent-soft" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</p>
        <p dir="auto" className="truncate font-bold">{s.track ? s.track.title : "Picked"}</p>
        {s.track && <p dir="auto" className="truncate text-sm text-muted">{s.track.artists.join(", ")}</p>}
        {s.note && <p dir="auto" className="mt-1 text-sm">{s.note}</p>}
      </div>
      {s.track && (
        <IconButton label={`Play ${s.track.title}`} onClick={() => playTracks([s.track as Track], 0, { type: "queue", name: "Song swap" })}>
          <Play />
        </IconButton>
      )}
    </div>
  );
}

export function SwapSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useMe().data;
  const members = useMembers();
  const swaps = useSwaps();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Track | null>(null);
  const [note, setNote] = useState("");
  const query = useDebounced(q.trim(), 250);
  const results = useQuery({ queryKey: ["library-search", query], queryFn: async () => (await api.searchLibrary(query)).tracks, enabled: open && query.length > 1 });
  const nameOf = (id: string) => (id === me?.id ? "You" : (members.data?.find((u) => u.id === id)?.display_name ?? "Them"));

  const mine = swaps.data?.current.find((s) => s.user_id === me?.id);
  const theirs = swaps.data?.current.find((s) => s.user_id !== me?.id);
  const reveal = swaps.data ? new Date(swaps.data.reveal_at) : null;

  const save = async () => {
    if (!picked) return;
    try {
      await socialApi.setSwap(picked.id, note.trim());
      setPicked(null);
      setQ("");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: socialKeys.swaps });
    } catch {
      toast("Pick not saved");
    }
  };

  const weeks = new Map<string, Swap[]>();
  for (const s of swaps.data?.history ?? []) weeks.set(s.week, [...(weeks.get(s.week) ?? []), s]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Song swap" wide>
      <div className="grid gap-5">
        {reveal && (
          <p className="font-semibold text-muted">
            Reveal: {reveal.toLocaleDateString([], { weekday: "long" })} {reveal.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        <div className="grid gap-2">
          {mine && <PickRow s={mine} label="Your pick" />}
          {theirs ? <PickRow s={theirs} label={`${nameOf(theirs.user_id)}'s pick`} /> : <p className="font-semibold text-muted">Their pick: not yet</p>}
        </div>

        <div className="grid gap-3 rounded-card border border-line p-3">
          <Field label={mine ? "Change your pick" : "Your pick"}>
            <input id="swap-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library" className={inputClass} />
          </Field>
          {picked ? (
            <div className="flex items-center gap-3">
              <Artwork src={picked.artwork_thumb_url ?? picked.artwork_url} className="size-12 rounded-[10px]" />
              <p dir="auto" className="min-w-0 flex-1 truncate font-bold">{picked.title} · {picked.artists.join(", ")}</p>
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Change</Button>
            </div>
          ) : (
            <ul className="grid max-h-56 gap-1 overflow-y-auto">
              {results.data?.slice(0, 20).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setPicked(t)} className="flex w-full items-center gap-3 rounded-button p-1.5 text-start hover:bg-accent-soft/50">
                    <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-10 shrink-0 rounded-[8px]" />
                    <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">{t.title} · {t.artists.join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Note">
            <input id="swap-note" dir="auto" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </Field>
          <Button variant="primary" onClick={save} disabled={!picked}>
            Save pick
          </Button>
        </div>

        {weeks.size > 0 && (
          <div className="grid gap-3">
            <h3 className="font-display text-lg font-semibold">Past swaps</h3>
            {[...weeks.entries()].map(([week, picks]) => (
              <div key={week} className="grid gap-2">
                <p className="text-sm font-bold text-muted">{new Date(`${week}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric" })}</p>
                {picks.map((s) => (
                  <PickRow key={s.user_id} s={s} label={`${nameOf(s.user_id)}'s pick`} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
