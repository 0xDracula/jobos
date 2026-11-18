"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, FileText, Play, Replace, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { adminApi, adminKeys, type ReviewItem, type ReviewList } from "@/lib/admin";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { keys, queryClient, usePlaylists } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { Dialog, openVersions, providerLabel } from "../dialogs";
import { Artwork } from "../media";
import { Button, Chip, Empty, Field, IconButton, Switch, inputClass } from "../ui";

import { Bar, Line, Panel, Stat } from "./parts";

function Imports() {
  const playlists = usePlaylists();
  const imported = (playlists.data ?? []).filter((p) => p.kind === "imported");
  const rematch = async (id: string) => {
    try {
      const r = await adminApi.rematch(id, ["review", "unmatched"]);
      toast(`Matches queued: ${r.queued}`);
    } catch {
      toast("Not queued");
    }
  };
  return (
    <Panel title="Imports">
      {!imported.length && <Empty>No imported playlists</Empty>}
      {imported.map((p) => {
        const c = p.counts;
        return (
          <div key={p.id} className="grid gap-2 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p dir="auto" className="min-w-0 flex-1 truncate font-bold">
                {p.name}
              </p>
              <Button size="sm" variant="ghost" onClick={() => void rematch(p.id)}>
                Rematch flagged
              </Button>
            </div>
            <Bar
              total={c.total}
              parts={[
                { label: "Cached", value: c.cached, className: "bg-accent" },
                { label: "Matched", value: Math.max(0, c.matched - c.cached), className: "bg-tint/60" },
              ]}
            />
            <p className="tabular text-sm font-semibold text-muted">
              {c.cached} of {c.total} cached · {c.matched} matched · {c.review} flagged · {c.unmatched} unmatched · {c.pending} pending
            </p>
          </div>
        );
      })}
    </Panel>
  );
}

const LISTS: [ReviewList, string][] = [
  ["unchecked", "Unchecked"],
  ["review", "Flagged"],
  ["unmatched", "Unmatched"],
  ["checked", "Checked"],
  ["chosen", "Overrides"],
];

function ReviewRow({ item, onCheck, onLyrics }: { item: ReviewItem; onCheck: (v: "correct" | "wrong" | "") => void; onLyrics: () => void }) {
  const t = item.track;
  const src = t.source;
  return (
    <div className="flex flex-wrap items-center gap-3 px-2 py-2">
      <Artwork src={t.artwork_thumb_url} className="size-12 shrink-0 rounded-chip" />
      <div className="min-w-0 flex-1 basis-48">
        <p dir="auto" className="truncate font-bold">
          {t.title}
        </p>
        <p dir="auto" className="truncate text-sm font-semibold text-muted">
          {t.artists.join(", ")}
          {t.duration_ms ? ` · ${fmtMs(t.duration_ms)}` : ""}
        </p>
        <p dir="auto" className="truncate text-xs font-semibold text-muted">
          {src ? `${providerLabel(src.provider)} · ${src.uploader ?? "—"} · ${src.title ?? ""}${src.duration_ms ? ` · ${fmtMs(src.duration_ms)}` : ""}` : "No recording"}
          {item.score != null ? ` · ${item.score.toFixed(2)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <IconButton label={`Play ${t.title}`} size="sm" onClick={() => playTracks([t], 0, { type: "queue", name: "Review" })}>
          <Play />
        </IconButton>
        <IconButton label="Versions" size="sm" onClick={() => openVersions(t)}>
          <Replace />
        </IconButton>
        <IconButton label="Lyrics" size="sm" onClick={onLyrics}>
          <FileText />
        </IconButton>
        <Chip selected={item.check === "correct"} onClick={() => onCheck(item.check === "correct" ? "" : "correct")} aria-label="Correct">
          <Check className="size-4" /> Correct
        </Chip>
        <Chip selected={item.check === "wrong"} onClick={() => onCheck(item.check === "wrong" ? "" : "wrong")} aria-label="Wrong version">
          <X className="size-4" /> Wrong
        </Chip>
      </div>
    </div>
  );
}

function MatchCheck({ onLyrics }: { onLyrics: (t: Track) => void }) {
  const playlists = usePlaylists();
  const imported = (playlists.data ?? []).filter((p) => p.kind === "imported");
  const [list, setList] = useState<ReviewList>("unchecked");
  const [playlist, setPlaylist] = useState("");
  useEffect(() => {
    if (!playlist && imported[0]) setPlaylist(imported[0].id);
  }, [playlist, imported]);
  const q = useQuery({
    queryKey: adminKeys.review(list, playlist),
    queryFn: () => adminApi.review(list, playlist || undefined),
    enabled: playlists.isSuccess,
  });
  const c = q.data?.counts;
  const target = useMemo(() => {
    if (!c) return null;
    const songs = c.auto + c.unmatched + c.chosen + c.pending;
    const allowed = Math.floor(songs * 0.05);
    const fixes = c.wrong + c.unmatched + c.chosen;
    return { songs, allowed, fixes };
  }, [c]);
  const check = async (item: ReviewItem, verdict: "correct" | "wrong" | "") => {
    queryClient.setQueryData<{ items: ReviewItem[] }>(adminKeys.review(list, playlist), (d) =>
      d ? { ...d, items: d.items.map((x) => (x.track.id === item.track.id ? { ...x, check: verdict || null } : x)) } : d,
    );
    try {
      await adminApi.setCheck(item.track.id, verdict);
      void queryClient.invalidateQueries({ queryKey: ["admin", "review"] });
      if (verdict === "wrong") openVersions(item.track);
    } catch {
      toast("Not saved");
    }
  };
  return (
    <Panel title="Match check">
      {c && target && (
        <div className="grid grid-cols-2 gap-2 p-1 sm:grid-cols-4">
          <Stat label="Checked correct" value={`${c.correct} / ${c.auto}`} tone={c.correct === c.auto && c.auto > 0 ? "good" : undefined} />
          <Stat label="Manual fixes" value={`${target.fixes} / ${target.allowed}`} tone={target.fixes > target.allowed ? "bad" : "good"} />
          <Stat label="Flagged" value={c.review} tone={c.review ? "warn" : undefined} />
          <Stat label="Pending" value={c.pending} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-1 py-2">
        {LISTS.map(([v, label]) => (
          <Chip key={v} selected={list === v} onClick={() => setList(v)}>
            {label}
          </Chip>
        ))}
        {imported.length > 0 && (
          <select
            aria-label="Playlist"
            className={cn(inputClass, "min-h-9 w-auto max-w-full py-1 text-sm")}
            value={playlist}
            onChange={(e) => setPlaylist(e.target.value)}
            dir="auto"
          >
            <option value="">All songs</option>
            {imported.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {q.data && !q.data.items.length && <Empty>Nothing here</Empty>}
      {q.data?.items.map((item) => (
        <ReviewRow key={item.track.id} item={item} onCheck={(v) => void check(item, v)} onLyrics={() => onLyrics(item.track)} />
      ))}
    </Panel>
  );
}

export function LyricsEditor({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["admin", "lyrics", track?.id], queryFn: () => adminApi.lyrics(track!.id), enabled: !!track });
  const [lrc, setLrc] = useState("");
  const [plain, setPlain] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [offset, setOffset] = useState("0");
  useEffect(() => {
    if (!q.data) return;
    setLrc(q.data.synced_lrc);
    setPlain(q.data.lyrics?.plain ?? "");
    setInstrumental(q.data.lyrics?.status === "instrumental");
    setOffset(String(q.data.lyrics?.offset_ms ?? 0));
  }, [q.data]);
  const save = async () => {
    if (!track) return;
    try {
      await adminApi.setLyrics(track.id, { synced_lrc: lrc, plain, instrumental });
      const ms = Math.round(Number(offset) || 0);
      if (ms !== (q.data?.lyrics?.offset_ms ?? 0)) await adminApi.setLyricsOffset(track.id, ms);
      void queryClient.invalidateQueries({ queryKey: keys.lyrics(track.id) });
      void q.refetch();
      toast("Lyrics saved");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Lyrics not saved");
    }
  };
  return (
    <Dialog open={!!track} onOpenChange={(o) => !o && onClose()} title={track ? `Lyrics · ${track.title}` : "Lyrics"} wide>
      <div className="grid gap-3">
        <p className="text-sm font-semibold text-muted">
          {q.data?.lyrics ? `${q.data.lyrics.status} · ${q.data.lyrics.source ?? "—"}` : "Not looked up"}
        </p>
        <Field label="Synced lyrics (LRC)">
          <textarea dir="auto" rows={10} className={`${inputClass} py-3 font-mono text-sm`} value={lrc} onChange={(e) => setLrc(e.target.value)} />
        </Field>
        <Field label="Plain lyrics">
          <textarea dir="auto" rows={6} className={`${inputClass} py-3 text-sm`} value={plain} onChange={(e) => setPlain(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Offset (ms)">
            <input type="number" step={50} className={`${inputClass} w-36`} value={offset} onChange={(e) => setOffset(e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center gap-3 font-bold">
            <Switch label="Instrumental" checked={instrumental} onCheckedChange={setInstrumental} />
            Instrumental
          </label>
        </div>
        <Button variant="primary" onClick={() => void save()}>
          Save lyrics
        </Button>
      </div>
    </Dialog>
  );
}

export function Library() {
  const [lyricsFor, setLyricsFor] = useState<Track | null>(null);
  return (
    <>
      <Imports />
      <MatchCheck onLyrics={setLyricsFor} />
      <Panel title="Lyrics">
        <LyricsSearch onPick={setLyricsFor} />
      </Panel>
      <LyricsEditor track={lyricsFor} onClose={() => setLyricsFor(null)} />
    </>
  );
}

function LyricsSearch({ onPick }: { onPick: (t: Track) => void }) {
  const [q, setQ] = useState("");
  const results = useQuery({
    queryKey: ["library-search", q.trim()],
    queryFn: async () => (await api.searchLibrary(q.trim())).tracks,
    enabled: q.trim().length > 1,
  });
  return (
    <div className="grid gap-2 p-1">
      <input aria-label="Song" placeholder="Song" dir="auto" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
      {results.data?.slice(0, 12).map((t) => (
        <Line key={t.id} label={<span dir="auto">{t.title}</span>} sub={<span dir="auto">{t.artists.join(", ")}</span>}>
          <Button size="sm" onClick={() => onPick(t)}>
            Edit lyrics
          </Button>
        </Line>
      ))}
    </div>
  );
}
