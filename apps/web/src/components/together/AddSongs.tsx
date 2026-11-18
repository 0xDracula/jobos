"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";
import { useState } from "react";

import { useDebounced } from "@/components/common";
import { Dialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Switch, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { useRecent } from "@/lib/queries";
import { sessionApi } from "@/lib/sessions";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

export function AddSongsDialog({ sessionId, live, open, onOpenChange }: { sessionId: string; live: boolean; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [next, setNext] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const q = useDebounced(query.trim(), 200);
  const found = useQuery({ queryKey: ["library-search", q], queryFn: async () => (await api.searchLibrary(q)).tracks, enabled: q.length > 1 });
  const recent = useRecent();
  const tracks: Track[] = q.length > 1 ? (found.data ?? []) : dedupe(recent.data ?? []).slice(0, 30);
  const add = async (t: Track) => {
    try {
      await sessionApi.add(sessionId, [t.id], { next: live && next });
      setAdded((s) => new Set(s).add(t.id));
    } catch {
      toast("Not added");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setQuery(""); setAdded(new Set()); } }} title="Add songs">
      <div className="grid gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input autoFocus type="search" dir="auto" aria-label="Search the library" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} ps-11`} />
        </div>
        {live && <Switch label="Play next" checked={next} onCheckedChange={setNext} />}
        <p className="text-xs font-extrabold text-muted">{q.length > 1 ? "Results" : "Recently played"}</p>
        <ul className="-mx-2 grid max-h-[50dvh] gap-0.5 overflow-y-auto">
          {tracks.map((t) => {
            const done = added.has(t.id);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => void add(t)} className="flex w-full items-center gap-3 rounded-[12px] px-2 py-1.5 text-start hover:bg-accent-soft/50">
                  <Artwork src={t.artwork_thumb_url} className="size-11 shrink-0 rounded-[8px]" />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate font-bold">{t.title}</span>
                    <span dir="auto" className="block truncate text-sm font-semibold text-muted">{t.artists.join(", ")}</span>
                  </span>
                  <span className={done ? "text-accent-strong" : "text-muted"} aria-label={done ? "Added" : "Add"}>
                    {done ? <Check className="size-5" /> : <Plus className="size-5" />}
                  </span>
                </button>
              </li>
            );
          })}
          {q.length > 1 && found.data && !found.data.length && <li className="px-2 py-4 text-center font-semibold text-muted">No songs</li>}
        </ul>
      </div>
    </Dialog>
  );
}

function dedupe(list: Track[]): Track[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}
