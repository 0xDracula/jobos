"use client";

import { Check, ChevronRight, Expand, Headphones, Lock, Play, Plus, Search, Send } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Avatar } from "@/avatar";
import { ContinueHere } from "@/components/ContinueHere";
import { Dialog } from "@/components/dialogs";
import { Handwriting } from "@/components/letters/Handwriting";
import { useNames } from "@/components/letters/Letters";
import { Artwork, LevelMeter } from "@/components/media";
import { MixShelf } from "@/components/mixes/Mixes";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { MoodChip, MoodPicker } from "@/components/profile/Mood";
import { request } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useCountdowns } from "@/lib/dates";
import { lettersKeys, useLetterCounts, usePicks, useRefetchAt, useSongOfTheDay, useWindowNote, type Note } from "@/lib/letters";
import { useMixes } from "@/lib/mixes";
import { useProfile, useQuestion } from "@/lib/profiles";
import { useOurSong } from "@/lib/keepsakes";
import { useMode, usePair } from "@/lib/pair";
import { useMe, useMembers } from "@/lib/session";
import { sendMessage, useChat, usePresence, type Person } from "@/lib/social";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";
import { listenAlong } from "@/player/together";
import { useCity, useWeather } from "@/room/data";
import { useLamp, type LampState } from "@/room/lamp";
import { localTime, RoomView } from "@/room/ui/RoomView";

import { SoloToday } from "./SoloToday";

type User = { id: string; display_name: string };

const card = "rounded-card border border-line bg-surface";
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function seenLabel(iso: string | null): string {
  if (!iso) return "Away";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `Last seen ${today ? clock(iso) : d.toLocaleDateString([], { weekday: "short" })}`;
}

function LampGlyph({ on, size = 22 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.25)} viewBox="0 0 8 10" shapeRendering="crispEdges" aria-hidden className="[image-rendering:pixelated]">
      <rect x="2" y="0" width="4" height="1" fill={on ? "#ffe9b8" : "#8a93a6"} />
      <rect x="1" y="1" width="6" height="3" fill={on ? "#ffc46b" : "#5d6577"} />
      <rect x="1" y="3" width="6" height="1" fill={on ? "#e9a04a" : "#4b5263"} />
      <rect x="3" y="4" width="2" height="5" fill="#8a93a6" />
      <rect x="2" y="9" width="4" height="1" fill="#5d6577" />
    </svg>
  );
}

const glow = "bg-[radial-gradient(circle_at_50%_45%,rgba(255,196,107,0.42),transparent_68%)]";

function PlayButton({ label, onClick, size = "md" }: { label: string; onClick: () => void; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("grid shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-transform active:scale-95", size === "md" ? "size-12" : "size-10")}
    >
      <Play className={cn("ms-0.5 fill-current", size === "md" ? "size-5" : "size-4")} />
    </button>
  );
}

function Greeting() {
  const city = useCity();
  const place = city.data?.city ?? null;
  const weather = useWeather(place);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const part = (o: Intl.DateTimeFormatOptions) => {
    if (!now) return "";
    try {
      return new Intl.DateTimeFormat("en-GB", { ...o, timeZone: place?.timezone || undefined }).format(now);
    } catch {
      return new Intl.DateTimeFormat("en-GB", o).format(now);
    }
  };
  const temp = weather.data ? `${Math.round(weather.data.temperature_c)}°` : "";
  const meta = [part({ day: "numeric", month: "long" }), now ? localTime(now, weather.data, place?.timezone) : "", temp && (place ? `${temp} in ${place.name}` : temp)].filter(Boolean);
  return (
    <div className="pointer-events-none absolute start-4 top-[max(env(safe-area-inset-top),16px)] z-[3] max-w-[calc(100%-5rem)] lg:start-8 lg:top-7">
      <h1 className="font-display text-[32px] leading-none text-ink lg:text-[56px]">{part({ weekday: "long" }) || "Today"}</h1>
      {meta.length > 0 && (
        <p dir="auto" className="tabular mt-2 inline-block rounded-[8px] bg-over px-2 py-0.5 text-[13px] font-bold text-over-ink lg:mt-3 lg:text-sm">
          {meta.join(" · ")}
        </p>
      )}
    </div>
  );
}

export function RoomBand({ search = true }: { search?: boolean } = {}) {
  const over = "border border-line-strong bg-over text-over-ink";
  return (
    <section aria-label="Room" className="today-band relative h-[190px] overflow-hidden bg-surface-2 lg:mx-6 lg:mt-5 lg:h-[240px] lg:rounded-[22px]">
      <RoomView band />
      <div aria-hidden className="today-scrim pointer-events-none absolute inset-0 z-[2]" />
      <Greeting />
      {search && (
        <Link href="/search/" aria-label="Search" className={cn(over, "absolute end-3 top-[max(env(safe-area-inset-top),12px)] z-[3] grid size-10 place-items-center rounded-full lg:hidden")}>
          <Search className="size-5" />
        </Link>
      )}
      <Link
        href="/room/"
        className={cn(over, "absolute end-3 z-[3] inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-extrabold lg:bottom-5 lg:end-5 lg:h-9 lg:px-3.5 lg:text-[13px]", search ? "bottom-[44px]" : "bottom-3.5")}
      >
        <Expand className="size-3.5" />
        Room
      </Link>
    </section>
  );
}

type Playing = { title: string; artists: string[]; art: string | null; live: boolean; detail?: string };

function MoodSlot({ user, mine }: { user: User; mine: boolean }) {
  const profile = useProfile(user.id);
  const [open, setOpen] = useState(false);
  const mood = profile?.mood;
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-extrabold";
  return (
    <>
      {mood ? (
        mine ? (
          <button type="button" onClick={() => setOpen(true)} className={cn(chip, "bg-surface-2")} aria-label="Change mood">
            <MoodChip mood={mood} />
          </button>
        ) : (
          <span className={cn(chip, "bg-surface-2")}>
            <MoodChip mood={mood} />
          </span>
        )
      ) : mine ? (
        <button type="button" onClick={() => setOpen(true)} className={cn(chip, "border border-dashed border-line-strong text-muted hover:text-ink")}>
          <Plus className="size-3.5" />
          Mood
        </button>
      ) : null}
      {mine && (
        <Dialog open={open} onOpenChange={setOpen} title="Mood">
          <MoodPicker current={mood} onDone={() => setOpen(false)} />
        </Dialog>
      )}
    </>
  );
}

function PersonCard({ user, mine, person, lamp, friend }: { user: User; mine: boolean; person: Person | undefined; lamp: LampState; friend: boolean }) {
  const myTrack = usePlayer(selectTrack);
  const myPlaying = usePlayer((s) => s.playing);
  const playing: Playing | null = mine
    ? myTrack && { title: myTrack.title, artists: myTrack.artists, art: myTrack.artwork_thumb_url ?? myTrack.artwork_url, live: myPlaying, detail: myPlaying ? undefined : "Paused" }
    : person?.playing
      ? { title: person.playing.title, artists: person.playing.artists, art: person.playing.artwork_thumb_url, live: !!person.listening }
      : null;
  const status = playing ? playing.title : mine ? null : person?.online ? (person.quiet ? "Online · Quiet" : "Online") : seenLabel(person?.last_seen ?? null);
  const along = async () => {
    const p = person?.playing;
    if (!p) return;
    try {
      await listenAlong(p.track_id, p.position_ms + Math.max(0, Date.now() - Date.parse(p.at)));
    } catch {
      toast("Listen together unavailable");
    }
  };
  return (
    <section
      aria-label={mine ? "You" : user.display_name}
      className={cn(
        "relative grid min-w-0 content-start justify-items-center gap-1 border border-line bg-surface px-2.5 pb-3.5 pt-3.5 text-center shadow-soft",
        mine ? "rounded-s-card border-e-0" : "rounded-e-card",
        "lg:justify-items-stretch lg:gap-0 lg:rounded-card lg:border-e lg:p-[18px] lg:text-start lg:shadow-none",
        mine ? "lg:col-start-1 lg:row-start-1" : "lg:col-start-3 lg:row-start-1",
      )}
    >
      <div className="grid min-w-0 justify-items-center gap-1 lg:flex lg:items-center lg:gap-3 lg:pe-20">
        <span className="overflow-hidden rounded-full bg-surface-2 lg:hidden">
          <Avatar userId={user.id} size={48} pose={playing?.live ? "listening" : "idle"} />
        </span>
        <span className="hidden overflow-hidden rounded-full bg-surface-2 lg:block">
          <Avatar userId={user.id} size={56} pose={playing?.live ? "listening" : "idle"} />
        </span>
        <span className="grid min-w-0 justify-items-center lg:justify-items-start">
          <span dir="auto" className="flex max-w-full items-center gap-1.5 truncate text-[15px] font-extrabold lg:text-lg">
            {!mine && person?.online && <span aria-hidden className="size-2 shrink-0 rounded-full bg-online" />}
            {user.display_name}
          </span>
          {status && (
            <span dir="auto" className="flex max-w-full items-center gap-1.5 text-[12.5px] font-semibold text-muted lg:text-[13px]">
              {playing?.live && <LevelMeter playing className="shrink-0 text-online" />}
              <span className="truncate">{status}</span>
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 lg:absolute lg:end-4 lg:top-[18px] lg:mt-0">
        <MoodSlot user={user} mine={mine} />
      </div>
      <div className="hidden lg:mt-4 lg:grid lg:gap-3">
        {playing && (
          <div className="flex items-center gap-2.5 rounded-[12px] bg-surface-2 p-2.5">
            <Artwork src={playing.art} className="size-11 shrink-0 rounded-[8px]" />
            <span className="min-w-0">
              <span dir="auto" className="block truncate text-sm font-extrabold">
                {playing.title}
              </span>
              <span dir="auto" className="block truncate text-[12.5px] font-semibold text-muted">
                {[playing.artists.join(", "), playing.detail].filter(Boolean).join(" · ")}
              </span>
            </span>
          </div>
        )}
        {!mine && person?.playing && (
          <button type="button" onClick={() => void along()} className="inline-flex h-9 items-center justify-center gap-2 rounded-[10px] border border-line bg-surface-2 text-[13px] font-extrabold hover:bg-surface-3">
            <Headphones className="size-4" />
            Listen along
          </button>
        )}
        {!friend && <div className="flex items-center gap-2 border-t border-line pt-3 text-[13.5px]">
          <span className={cn("grid size-8 place-items-center rounded-[10px]", (mine ? lamp.sending : !!lamp.received) && glow)}>
            <LampGlyph on={mine ? lamp.sending : !!lamp.received} size={15} />
          </span>
          {mine ? (
            <>
              <span className="flex-1 font-extrabold">Lamp</span>
              <button
                type="button"
                role="switch"
                aria-checked={lamp.sending}
                aria-label="Your lamp"
                onClick={() => void lamp.toggle()}
                className={cn("relative h-[22px] w-9 rounded-full transition-colors", lamp.sending ? "bg-accent" : "bg-surface-3")}
              >
                <span className={cn("absolute top-[3px] size-4 rounded-full bg-white shadow transition-transform", lamp.sending ? "translate-x-[17px]" : "translate-x-[3px]")} />
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 font-extrabold">{lamp.received ? "Lamp on" : "Lamp off"}</span>
              {lamp.received && <span className="tabular text-[12.5px] font-semibold text-muted">{clock(lamp.received.sent_at)}</span>}
            </>
          )}
        </div>}
      </div>
    </section>
  );
}

function Duet({ me, other, friend }: { me: User; other: User | null; friend: boolean }) {
  const presence = usePresence().data;
  const lamp = useLamp();
  const person = presence?.people.find((p) => p.id === other?.id);
  const lit = lamp.sending || !!lamp.received;
  const middle = "absolute start-1/2 top-[30px] z-[5] grid size-[50px] -translate-x-1/2 place-items-center rounded-full border border-line-strong bg-surface-2 shadow-[0_0_0_5px_var(--bg)] lg:hidden";
  const along = async () => {
    const p = person?.playing;
    if (!p) {
      toast("Nothing playing");
      return;
    }
    try {
      await listenAlong(p.track_id, p.position_ms + Math.max(0, Date.now() - Date.parse(p.at)));
    } catch {
      toast("Listen together unavailable");
    }
  };
  return (
    <div className={cn("relative z-[4] -mt-[30px] grid px-4 lg:contents", other ? "grid-cols-2" : "grid-cols-1")}>
      <PersonCard user={me} mine person={undefined} lamp={lamp} friend={friend} />
      {other && (
        <>
          {friend ? (
            <button type="button" onClick={() => void along()} aria-label="Listen along" className={middle}>
              <Headphones className="size-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void lamp.toggle()}
              aria-label={lamp.sending ? "Switch off your lamp" : "Light your lamp"}
              aria-pressed={lamp.sending}
              className={middle}
            >
              <span className={cn("grid size-10 place-items-center rounded-full", lit && glow)}>
                <LampGlyph on={lit} />
              </span>
            </button>
          )}
          <PersonCard user={other} mine={false} person={person} lamp={lamp} friend={friend} />
        </>
      )}
    </div>
  );
}

function NoteCard({ note, label, authorName, track }: { note: Pick<Note, "author_id" | "body" | "created_at">; label: string; authorName: string; track?: Track | null }) {
  const [text, setText] = useState("");
  const send = () => {
    const body = text.trim();
    if (!body) return;
    sendMessage("text", body);
    setText("");
    toast(`Sent to ${authorName}`);
  };
  return (
    <article className="rounded-card border border-note-edge bg-note p-4">
      <header className="flex items-center gap-2 text-[13px]">
        <span className="overflow-hidden rounded-full bg-surface-2">
          <Avatar userId={note.author_id} size={26} />
        </span>
        <b className="font-extrabold">{authorName}</b>
        <span className="text-muted">
          {label} · {clock(note.created_at)}
        </span>
      </header>
      <Handwriting authorId={note.author_id} className="mt-2.5 text-[30px] leading-[1.06] text-hand lg:text-[34px]">
        {note.body}
      </Handwriting>
      {track && (
        <div className="mt-3 flex items-center gap-2.5 rounded-[12px] border border-line bg-[var(--field)] p-2">
          <Artwork src={track.artwork_thumb_url ?? track.artwork_url} className="size-10 shrink-0 rounded-[8px]" />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate text-sm font-extrabold">
              {track.title}
            </span>
            <span dir="auto" className="block truncate text-xs font-semibold text-muted">
              {track.artists.join(", ")}
            </span>
          </span>
          <PlayButton size="sm" label={`Play ${track.title}`} onClick={() => playTracks([track], 0, { type: "queue", name: label })} />
        </div>
      )}
      <form
        className="mt-3.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`Reply to ${authorName}`}
          placeholder="Reply"
          dir="auto"
          className="h-[42px] min-w-0 flex-1 rounded-[12px] border border-line bg-[var(--field)] px-3.5 text-[15px] text-ink outline-none placeholder:text-muted focus:border-accent"
        />
        <button type="submit" aria-label="Send" className="grid size-[42px] shrink-0 place-items-center rounded-[12px] bg-accent text-on-accent disabled:opacity-60" disabled={!text.trim()}>
          <Send className="size-[18px]" />
        </button>
      </form>
    </article>
  );
}

function SongOfTheDay() {
  const q = useSongOfTheDay();
  const names = useNames();
  const s = q.data?.today;
  if (!s?.track) return <Picks />;
  const t = s.track;
  return (
    <>
      <article className={cn(card, "flex items-center gap-3 p-3")}>
        <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-16 shrink-0 rounded-[10px]" />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-[17px] font-extrabold">
            {t.title}
          </p>
          <p dir="auto" className="truncate text-[13px] font-semibold text-muted">
            {t.artists.join(", ")}
          </p>
          <p className="mt-0.5 truncate text-xs font-bold text-accent-strong">
            {s.auto ? "From picks" : "Song of the day"} · {names(s.author_id)}
          </p>
        </div>
        <PlayButton label={`Play ${t.title}`} onClick={() => playTracks([t], 0, { type: "queue", name: "Song of the day" })} />
      </article>
      {s.note && <NoteCard note={{ author_id: s.author_id, body: s.note, created_at: s.created_at ?? `${s.date}T06:00:00` }} label="With today’s song" authorName={names(s.author_id)} />}
    </>
  );
}

function Picks() {
  const picks = usePicks().data?.for_me ?? [];
  const names = useNames();
  if (!picks.length) return null;
  const tracks = picks.map((p) => p.track);
  return (
    <article className={cn(card, "p-3")}>
      <p className="px-1 text-[13px] font-extrabold text-muted">Picks from {names(picks[0].author_id)}</p>
      <div className="no-scrollbar mt-2 flex gap-2.5 overflow-x-auto">
        {picks.slice(0, 8).map((p, i) => (
          <button key={p.track_id} type="button" onClick={() => playTracks(tracks, i, { type: "queue", name: "Picks" })} className="grid w-[92px] shrink-0 gap-1 text-start" aria-label={`Play ${p.track.title}`}>
            <Artwork src={p.track.artwork_thumb_url ?? p.track.artwork_url} className="aspect-square w-full rounded-[10px]" />
            <span dir="auto" className="truncate text-[12.5px] font-extrabold">
              {p.track.title}
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}

function WindowNote() {
  const q = useWindowNote();
  const names = useNames();
  useRefetchAt(q.data?.ends_at ?? q.data?.next_at, lettersKeys.windowNote);
  const n = q.data?.note;
  if (!n || !q.data?.window) return null;
  return <NoteCard note={n} label={q.data.window === "morning" ? "Morning note" : "Night note"} authorName={names(n.author_id)} track={n.track} />;
}

function Slot({ userId, name, children }: { userId: string; name: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-2 rounded-[12px] bg-surface-2 p-2.5">
      <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-extrabold">
        <span className="overflow-hidden rounded-full bg-surface-3">
          <Avatar userId={userId} size={24} />
        </span>
        <span dir="auto" className="truncate">
          {name}
        </span>
      </span>
      {children}
    </div>
  );
}

function Question({ me, other }: { me: User; other: User | null }) {
  const q = useQuestion().data?.today;
  if (!q) return null;
  const status = "flex h-[34px] items-center gap-1.5 text-[12.5px] font-semibold text-muted";
  return (
    <article className={cn(card, "p-4")}>
      <p dir="auto" className="text-[17px] font-extrabold leading-snug lg:text-lg">
        {q.body}
      </p>
      <div className={cn("mt-3.5 grid gap-2", other && "grid-cols-2")}>
        <Slot userId={me.id} name="You">
          {q.mine ? (
            <span className={status}>
              <Check className="size-3.5" /> Answered
            </span>
          ) : (
            <Link href="/question/" className="grid h-[34px] place-items-center rounded-[10px] bg-accent text-[13px] font-extrabold text-on-accent">
              Answer
            </Link>
          )}
        </Slot>
        {other && (
          <Slot userId={other.id} name={other.display_name}>
            {q.they_answered ? (
              q.mine ? (
                <Link href="/question/" className={cn(status, "text-ink")}>
                  See answers <ChevronRight className="size-3.5" />
                </Link>
              ) : (
                <span className={status}>
                  <Lock className="size-3.5" /> Answered
                </span>
              )
            ) : (
              <span className={status}>Not yet</span>
            )}
          </Slot>
        )}
      </div>
    </article>
  );
}

export function ComingUp() {
  const c = useCountdowns().data?.countdowns[0];
  if (!c) return null;
  const surprise = c.surprise && !c.title;
  const d = new Date(`${c.date}T12:00:00`);
  const days = c.days === 0 ? "Today" : c.days === 1 ? "1 day" : `${c.days} days`;
  return (
    <Link href={`/calendar/?date=${c.date}`} className={cn(card, "flex min-w-0 items-center gap-3 p-3 transition-colors hover:border-line-strong")}>
      <span className="grid h-[50px] w-[46px] shrink-0 place-content-center rounded-[10px] bg-accent text-center leading-none text-on-accent">
        <span className="text-[11px] font-extrabold">{d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
        <span className="tabular text-[19px] font-extrabold">{d.getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[15px] font-extrabold">
          {surprise ? "Surprise" : c.title || "Countdown"}
        </span>
        <span className="block truncate text-[13px] font-semibold text-muted">{d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
      </span>
      <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-extrabold text-accent-strong">{days}</span>
    </Link>
  );
}

const KIND_LABEL: Record<string, string> = { song: "Song", lyric: "Lyrics", swap: "Song swap", session: "Listen together", voice: "Voice note", photo: "Photo", sticker: "Sticker" };

function ChatCard({ other }: { other: User }) {
  const chat = useChat();
  const unread = usePresence().data?.unread ?? 0;
  const messages = chat.data?.messages ?? [];
  let last = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_id === other.id && !messages[i].deleted) {
      last = messages[i];
      break;
    }
  }
  if (!last) return null;
  const text = last.kind === "text" ? last.body : last.body || KIND_LABEL[last.kind] || "Message";
  return (
    <Link href="/chat/" className={cn(card, "flex min-w-0 items-center gap-3 p-3 transition-colors hover:border-line-strong")}>
      <span className="overflow-hidden rounded-full bg-surface-2">
        <Avatar userId={other.id} size={36} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
          <b className="font-extrabold text-ink">{other.display_name}</b>
          <span className="tabular">{clock(last.created_at)}</span>
        </span>
        <span dir="auto" className="block truncate text-[15px] font-semibold">
          {text}
        </span>
      </span>
      {unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-extrabold text-on-accent">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

function Letters() {
  const c = useLetterCounts();
  if (!c.unopened) return null;
  return (
    <Link href={c.next ? `/letters/?id=${c.next.id}` : "/letters/"} className={cn(card, "flex items-center gap-3 p-3 transition-colors hover:border-line-strong")}>
      <PixelIcon name="envelope" size={36} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold">{c.unopened === 1 ? "New letter" : `${c.unopened} new letters`}</span>
        <span className="block text-[13px] font-semibold text-muted">Letters</span>
      </span>
      <ChevronRight className="size-5 text-muted" />
    </Link>
  );
}

export function NowMusic() {
  const mixes = useMixes().data;
  const current = mixes?.find((m) => m.current)?.kind;
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  const title = hour === null ? "Mixes" : hour < 5 || hour >= 18 ? "Tonight" : hour < 12 ? "This morning" : "This afternoon";
  const kinds = [current, "daily", "your_song", "calm", "rediscover"].filter((k, i, a): k is string => !!k && a.indexOf(k) === i);
  return <MixShelf title={title} kinds={kinds} />;
}

function FirstSteps({ friend }: { friend: boolean }) {
  const pair = usePair().data?.pair;
  const ourSong = useOurSong().data?.track;
  const chat = useChat().data;
  if (!pair || !chat || chat.messages.length > 0 || Date.now() - Date.parse(pair.created_at) > 7 * 86_400_000) return null;
  const steps = [
    !friend && !ourSong && { href: "/song/", icon: "record" as PixelIconName, title: "Our song", meta: "Choose" },
    { href: "/chat/", icon: "bubble" as PixelIconName, title: "Send a song", meta: "Chat" },
    { href: "/together/", icon: "headphones" as PixelIconName, title: "Listen together", meta: "Start" },
  ].filter((x): x is { href: string; icon: PixelIconName; title: string; meta: string } => !!x);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-3">
      {steps.map((st) => (
        <Link key={st.href} href={st.href} className={cn(card, "flex items-center gap-3 p-3 transition-colors hover:border-line-strong")}>
          <PixelIcon name={st.icon} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold">{st.title}</span>
            <span className="block text-[13px] font-semibold text-muted">{st.meta}</span>
          </span>
          <ChevronRight className="size-5 text-muted" />
        </Link>
      ))}
    </div>
  );
}

function useFirstRun() {
  const router = useRouter();
  const start = useQuery({ queryKey: ["start"], queryFn: () => request<{ show: boolean }>("/api/start"), staleTime: 5 * 60_000 });
  useEffect(() => {
    if (start.data?.show && !new URLSearchParams(window.location.search).has("welcome")) router.replace("/start/");
  }, [start.data?.show, router]);
}

export function Today() {
  const me = useMe().data;
  const members = useMembers().data;
  const mode = useMode();
  useFirstRun();
  if (!me) return null;
  if (mode === "solo") return <SoloToday />;
  const friend = mode === "friend";
  const other = members?.find((u) => u.id !== me.id) ?? null;
  return (
    <div>
      <RoomBand />
      <div className="mx-auto max-w-[1400px] lg:grid lg:grid-cols-[290px_minmax(0,1fr)_290px] lg:items-start lg:gap-6 lg:px-6 lg:pt-5">
        <Duet me={me} other={other} friend={friend} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2.5 px-4 pt-6 lg:col-start-2 lg:row-start-1 lg:px-0 lg:pt-0">
          <h2 className="font-display text-xl lg:text-[22px]">Between you</h2>
          <ContinueHere className="w-full" />
          <FirstSteps friend={friend} />
          <SongOfTheDay />
          {!friend && <WindowNote />}
          <Question me={me} other={other} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2">
            <ComingUp />
            {other && <ChatCard other={other} />}
          </div>
          {!friend && <Letters />}
          <div className="mt-4">
            <NowMusic />
          </div>
        </div>
      </div>
    </div>
  );
}
