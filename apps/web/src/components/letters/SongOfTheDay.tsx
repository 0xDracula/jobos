"use client";

import { Play, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Loading } from "@/components/common";
import { Dialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { CoverShelf, Plank } from "@/components/Shelf";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, SectionTitle, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { lettersApi, refreshLetters, useHomeZone, usePicks, useSongOfTheDay, type SongOfTheDay } from "@/lib/letters";
import { formatDay, splitByDate, todayIn } from "@/lib/paper";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { Handwriting, useHandFont } from "./Handwriting";
import { useNames } from "./Letters";
import { SongPicker, SongRow } from "./SongPicker";
import { useSongDialog } from "./stores";

const panel = "rounded-card border border-panel-line bg-panel";

const play = (t: Track, name = "Song of the day") => playTracks([t], 0, { type: "queue", name });

export function SongOfTheDayCard({ className }: { className?: string }) {
  const q = useSongOfTheDay();
  const names = useNames();
  const s = q.data?.today;
  if (!s?.track) return null;
  const t = s.track;
  return (
    <section className={cn(panel, "relative flex gap-4 overflow-hidden p-3 sm:p-4", className)} aria-label="Song of the day">
      <button type="button" onClick={() => play(t)} aria-label={`Play ${t.title}`} className="group relative shrink-0">
        <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-24 rounded-[6px] shadow-[0_8px_18px_rgba(10,8,30,0.35)] sm:size-28" />
        <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
          <Play className="size-8 fill-current" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold text-accent-strong">Song of the day</p>
        <p dir="auto" className="truncate font-display text-xl font-semibold">
          {t.title}
        </p>
        <p dir="auto" className="truncate text-sm font-bold text-muted">
          {t.artists.join(", ")} · {names(s.author_id)}
        </p>
        {s.note && (
          <Handwriting authorId={s.author_id} className="mt-1 line-clamp-3 text-[21px] leading-snug">
            {s.note}
          </Handwriting>
        )}
        {s.auto && <p className="mt-1 text-xs font-bold text-muted">From picks</p>}
      </div>
    </section>
  );
}

export function SongOfTheDayHome({ className }: { className?: string }) {
  const q = useSongOfTheDay();
  const names = useNames();
  const s = q.data?.today;
  const key = s ? `jobbos.song-of-the-day.${s.date}` : "";
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!key) return;
    try {
      setHidden(localStorage.getItem(key) === "1");
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (!s?.track || hidden) return null;
  const t = s.track;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(key, "1");
    } catch {
    }
  };
  return (
    <section aria-label="Song of the day" className={cn("flex items-center gap-3 rounded-card bg-surface-solid/80 p-3 shadow-soft backdrop-blur", className)}>
      <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-16 shrink-0 self-start rounded-button" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-accent-strong">
          <Sparkles className="size-4" /> Song of the day
        </div>
        <div dir="auto" className="truncate font-bold">
          {t.title}
        </div>
        <div dir="auto" className="truncate text-sm font-semibold text-muted">
          {t.artists.join(", ")} · {names(s.author_id)}
        </div>
        {s.note && (
          <Handwriting authorId={s.author_id} className="line-clamp-2 text-[19px] leading-snug">
            {s.note}
          </Handwriting>
        )}
      </div>
      <Button variant="primary" onClick={() => play(t)} className="shrink-0 max-sm:hidden">
        <Play className="size-5 fill-current" /> Play
      </Button>
      <IconButton label={`Play ${t.title}`} onClick={() => play(t)} className="shrink-0 bg-accent text-on-accent sm:hidden">
        <Play className="fill-current" />
      </IconButton>
      <IconButton label="Dismiss" size="sm" onClick={dismiss}>
        <X />
      </IconButton>
    </section>
  );
}

export function PicksHome({ className }: { className?: string }) {
  const q = usePicks();
  const names = useNames();
  const picks = q.data?.for_me ?? [];
  const newest = picks.reduce((at, p) => (p.created_at > at ? p.created_at : at), "");
  const key = picks.length ? `${picks.length}.${newest}` : "";
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    if (!key) return;
    try {
      setHidden(localStorage.getItem("jobbos.picks-home") === key);
    } catch {
      setHidden(false);
    }
  }, [key]);
  if (!picks.length || hidden) return null;
  const tracks = picks.map((p) => p.track);
  const name = `Picks from ${names(picks[0].author_id)}`;
  const context = { type: "queue" as const, id: "picks", name };
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem("jobbos.picks-home", key);
    } catch {
    }
  };
  return (
    <section aria-label={name} className={cn("flex items-center gap-3 rounded-card bg-surface-solid/80 p-3 shadow-soft backdrop-blur", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-extrabold text-accent-strong">
          <Sparkles className="size-4" /> {name}
        </div>
        <div className="no-scrollbar mt-1.5 flex gap-1.5 overflow-x-auto">
          {tracks.slice(0, 8).map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => playTracks(tracks, i, context)}
              aria-label={`Play ${t.title}`}
              title={`${t.title} · ${t.artists.join(", ")}`}
              className="shrink-0 transition-transform duration-150 hover:-translate-y-0.5"
            >
              <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-12 rounded-[6px]" />
            </button>
          ))}
        </div>
      </div>
      <IconButton label={`Play ${name}`} onClick={() => playTracks(tracks, 0, context)} className="shrink-0 bg-accent text-on-accent">
        <Play className="fill-current" />
      </IconButton>
      <IconButton label="Dismiss" size="sm" onClick={dismiss}>
        <X />
      </IconButton>
    </section>
  );
}

export function PicksRow({ title }: { title?: string }) {
  const q = usePicks();
  const names = useNames();
  const picks = q.data?.for_me ?? [];
  if (!picks.length) return null;
  const tracks = picks.map((p) => p.track);
  const name = title ?? `Picks from ${names(picks[0].author_id)}`;
  return (
    <section>
      <SectionTitle>{name}</SectionTitle>
      <CoverShelf tracks={tracks} context={{ type: "queue", id: "picks", name }} label={name} />
    </section>
  );
}

function History({ list }: { list: SongOfTheDay[] }) {
  const names = useNames();
  if (!list.length) return <Empty>None yet</Empty>;
  return (
    <ul className={cn(panel, "divide-y divide-panel-line")}>
      {list.map((s) => (
        <li key={`${s.author_id}-${s.date}`} className="px-2 py-1">
          {s.track && (
            <SongRow track={s.track}>
              <span className="hidden text-sm font-bold text-muted sm:block">{formatDay(s.date, { day: "numeric", month: "short" })}</span>
              <IconButton label={`Play ${s.track.title}`} onClick={() => play(s.track as Track)}>
                <Play />
              </IconButton>
            </SongRow>
          )}
          <p className="px-1.5 pb-1 text-xs font-bold text-muted sm:hidden">{formatDay(s.date, { day: "numeric", month: "short" })}</p>
          {s.note && (
            <Handwriting authorId={s.author_id} className="px-1.5 pb-1.5 text-[19px] leading-snug">
              {s.note}
            </Handwriting>
          )}
          {s.auto && <p className="px-1.5 pb-1 text-xs font-bold text-muted">From picks · {names(s.author_id)}</p>}
        </li>
      ))}
    </ul>
  );
}

function SongOfTheDayForm({ initial, onDone }: { initial?: Track | null; onDone?: () => void }) {
  const me = useMe().data;
  const hand = useHandFont(me?.id);
  const tz = useHomeZone();
  const today = todayIn(tz);
  const [track, setTrack] = useState<Track | null>(initial ?? null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!track) return;
    setBusy(true);
    try {
      await lettersApi.setSongOfTheDay(track.id, note, date);
      refreshLetters("song-of-the-day");
      toast(date === today ? "Song of the day set" : `Song of the day set for ${formatDay(date)}`);
      setTrack(null);
      setNote("");
      onDone?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3">
      <Field label="Song">
        <SongPicker value={track} onChange={setTrack} />
      </Field>
      <Field label="Note">
        <textarea dir="auto" rows={3} maxLength={1000} className={cn(inputClass, "py-3")} style={{ fontFamily: hand, fontSize: 21, lineHeight: 1.35 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Date">
        <input type="date" className={cn(inputClass, "w-48")} min={today} value={date} onChange={(e) => setDate(e.target.value || today)} />
      </Field>
      <Button variant="primary" onClick={() => void save()} disabled={busy || !track}>
        Save song of the day
      </Button>
    </div>
  );
}

export function SongOfTheDayDialog() {
  const track = useSongDialog((s) => s.track);
  return (
    <Dialog open={!!track} onOpenChange={(o) => !o && useSongDialog.setState({ track: null })} title="Song of the day">
      {track && <SongOfTheDayForm key={track.id} initial={track} onDone={() => useSongDialog.setState({ track: null })} />}
    </Dialog>
  );
}

function Yours() {
  const q = useSongOfTheDay();
  const picks = usePicks();
  const me = useMe().data;
  const members = useMembers();
  const tz = useHomeZone();
  const other = members.data?.find((u) => u.id !== me?.id);
  const { upcoming } = splitByDate(q.data?.mine ?? [], todayIn(tz));
  const mine = picks.data?.mine ?? [];
  const remove = async (date: string) => {
    try {
      await lettersApi.deleteSongOfTheDay(date);
      refreshLetters("song-of-the-day");
    } catch {
      toast("Not deleted");
    }
  };
  const unpick = async (trackId: string) => {
    try {
      await lettersApi.pick(trackId, false);
      refreshLetters("picks", "song-of-the-day");
    } catch {
      toast("Not removed");
    }
  };
  const preview = q.data?.preview;
  return (
    <div className="grid grid-cols-1 gap-10">
      <section>
        <SectionTitle>{other ? `Today for ${other.display_name}` : "Today"}</SectionTitle>
        {preview?.track ? (
          <div className={panel}>
            <SongRow track={preview.track}>
              <span className="text-sm font-bold text-muted">{preview.auto ? "From picks" : ""}</span>
            </SongRow>
            {preview.note && (
              <Handwriting authorId={preview.author_id} className="px-3 pb-2 text-[19px] leading-snug">
                {preview.note}
              </Handwriting>
            )}
          </div>
        ) : (
          <Empty>None</Empty>
        )}
      </section>
      <section>
        <SectionTitle>Your song of the day</SectionTitle>
        <div className={cn(panel, "p-3")}>
          <SongOfTheDayForm />
        </div>
      </section>
      <section>
        <SectionTitle>Scheduled</SectionTitle>
        {upcoming.length ? (
          <ul className={cn(panel, "divide-y divide-panel-line")}>
            {upcoming.map((s) => (
              <li key={s.date} className="px-2 py-1">
                {s.track && (
                  <SongRow track={s.track}>
                    <span className="text-sm font-bold text-muted">{formatDay(s.date, { day: "numeric", month: "short" })}</span>
                    {s.placeholder && <PlaceholderMark />}
                    <IconButton label="Delete" size="sm" onClick={() => void remove(s.date)}>
                      <Trash2 />
                    </IconButton>
                  </SongRow>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>None</Empty>
        )}
      </section>
      <section>
        <SectionTitle action={<span className="tabular text-sm font-bold text-muted">{mine.length}</span>}>Your picks</SectionTitle>
        {mine.length ? (
          <Plank>
            {mine.map((p) => (
              <div key={p.track_id} className="grid w-[118px] shrink-0 snap-start gap-1.5 sm:w-[140px] lg:w-[150px]">
                <button type="button" onClick={() => play(p.track, "Your picks")} aria-label={`Play ${p.track.title}`} className="group">
                  <Artwork
                    src={p.track.artwork_thumb_url ?? p.track.artwork_url}
                    className="aspect-square w-full rounded-[6px] shadow-[0_8px_18px_rgba(10,8,30,0.35)] transition-transform duration-200 ease-out group-hover:-translate-y-1"
                  />
                </button>
                <span dir="auto" className="truncate text-sm font-extrabold">
                  {p.track.title}
                </span>
                <span className="-mt-1 flex items-center gap-1">
                  {p.placeholder ? (
                    <>
                      <PlaceholderMark />
                      <IconButton label={`Keep ${p.track.title}`} size="sm" onClick={() => void lettersApi.pick(p.track_id, true).then(() => refreshLetters("picks"))}>
                        <Sparkles />
                      </IconButton>
                    </>
                  ) : null}
                  <IconButton label={`Remove ${p.track.title} from picks`} size="sm" onClick={() => void unpick(p.track_id)}>
                    <Trash2 />
                  </IconButton>
                </span>
              </div>
            ))}
          </Plank>
        ) : (
          <Empty>No picks</Empty>
        )}
      </section>
    </div>
  );
}

export function SongOfTheDayPage() {
  const q = useSongOfTheDay();
  const today = q.data?.date;
  const history = (q.data?.history ?? []).filter((s) => s.date !== today);
  return (
    <>
      <PageHero title="Song of the day" meta={today ? formatDay(today) : undefined} />
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="grid grid-cols-1 gap-10">
          {q.data.today ? <SongOfTheDayCard /> : <Empty>No song today</Empty>}
          <PicksRow />
          <section>
            <SectionTitle>History</SectionTitle>
            <History list={history} />
          </section>
          <Yours />
        </div>
      )}
    </>
  );
}
