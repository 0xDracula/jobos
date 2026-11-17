"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useDebounced } from "@/components/common";
import { Artwork } from "@/components/media";
import { Button, IconButton, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import type { Track } from "@/lib/types";

export function SongRow({ track, children }: { track: Track; children?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-[8px] p-1.5">
      <Artwork src={track.artwork_thumb_url ?? track.artwork_url} className="size-11 shrink-0 rounded-[5px]" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate font-extrabold">
          {track.title}
        </span>
        <span dir="auto" className="block truncate text-sm font-semibold text-muted">
          {track.artists.join(", ")}
        </span>
      </span>
      {children}
    </div>
  );
}

export function SongPicker({ value, onChange, label = "Song" }: { value: Track | null; onChange: (t: Track | null) => void; label?: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const results = useQuery({ queryKey: ["library-search", q], queryFn: async () => (await api.searchLibrary(q)).tracks, enabled: q.length > 1 });
  if (value) {
    return (
      <div className="rounded-[10px] border border-panel-line bg-panel">
        <SongRow track={value}>
          <IconButton label={`Remove ${label.toLowerCase()}`} size="sm" onClick={() => onChange(null)}>
            <X />
          </IconButton>
        </SongRow>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-1">
      <input aria-label={label} placeholder={label} dir="auto" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />
      {results.data?.slice(0, 6).map((t) => (
        <SongRow key={t.id} track={t}>
          <Button
            size="sm"
            onClick={() => {
              onChange(t);
              setSearch("");
            }}
          >
            Choose
          </Button>
        </SongRow>
      ))}
    </div>
  );
}
