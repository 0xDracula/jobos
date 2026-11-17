"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { Button, inputClass } from "@/components/ui";
import { adminApi } from "@/lib/admin";
import { usePlaceholders } from "@/lib/placeholders";
import { queryClient, usePlaylists } from "@/lib/queries";
import { toast } from "@/lib/toast";

import { DatesAdmin } from "./gift/Dates";
import { LettersAdmin } from "./gift/Letters";
import { MemoriesAdmin } from "./gift/Memories";
import { Line, Panel } from "./parts";

function Placeholders() {
  const q = usePlaceholders();
  const sets = q.data ?? [];
  const left = sets.reduce((n, s) => n + s.left, 0);
  return (
    <Panel title="Placeholders" action={<span className="tabular text-sm font-bold text-muted">{left} left</span>}>
      {sets.map((s) => (
        <Line key={s.name} label={s.label}>
          <Link href={s.admin} className="tabular text-sm font-bold text-accent-strong">
            {s.left}
          </Link>
        </Line>
      ))}
    </Panel>
  );
}

function HerPlaylist() {
  const q = useQuery({ queryKey: ["admin", "her-playlist"], queryFn: adminApi.herPlaylist });
  const playlists = usePlaylists().data ?? [];
  const id = q.data?.playlist_id ?? "";
  const picked = playlists.find((p) => p.id === id);
  const pick = async (playlistId: string) => {
    try {
      queryClient.setQueryData(["admin", "her-playlist"], await adminApi.setHerPlaylist(playlistId));
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch {
      toast("Not saved");
    }
  };
  const cover = async () => {
    try {
      await adminApi.spotifyCover(id);
      toast("Cover queued");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Cover unavailable");
    }
  };
  return (
    <Panel title="Her playlist">
      <Line label="Playlist">
        <select aria-label="Her playlist" className={`${inputClass} w-64`} value={id} onChange={(e) => void pick(e.target.value)}>
          <option value="" disabled>
            None
          </option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Line>
      {picked?.source_provider === "spotify" && (
        <Line label="Cover">
          <Button size="sm" onClick={() => void cover()}>
            Spotify cover
          </Button>
        </Line>
      )}
    </Panel>
  );
}

export function GiftAdmin() {
  return (
    <div className="grid gap-6">
      <Placeholders />
      <HerPlaylist />
      <LettersAdmin />
      <MemoriesAdmin />
      <DatesAdmin />
    </div>
  );
}
