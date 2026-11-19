"use client";

import { ChevronDown, ChevronUp, Heart, Play, Plus, Send, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, lookOf } from "@/avatar";
import { openAddToPlaylist } from "@/components/dialogs";
import { openSend } from "@/components/friends/sheets";
import { Artwork } from "@/components/media";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useFriends } from "@/lib/people";
import { onPreview, playPreview, previewMuted, setPreviewMuted, stopPreview, togglePreview, warmPreview } from "@/lib/previewPlayer";
import { CLIP_MS, previewApi, previewBars, previewLabel, previewStart, usePreviews, type Preview, type PreviewMode } from "@/lib/previews";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { playTracks } from "@/player/controls";
import { trackUrl } from "@/player/engine";

export default function PreviewsPage() {
  return (
    <Suspense>
      <Feed />
    </Suspense>
  );
}

function tintOf(p: Preview | undefined): string {
  const hex = p?.track.palette?.[0]?.hex;
  if (!hex) return "#1b1e26";
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * 0.28 + 14);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function Feed() {
  const router = useRouter();
  const [mode, setMode] = useState<PreviewMode>("you");
  const q = usePreviews(mode);
  const friends = useFriends().data?.friends;
  const [list, setList] = useState<Preview[] | null>(null);
  const [i, setI] = useState(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(previewMuted());
  const [clip, setClip] = useState({ at: 0, playing: false });
  const touch = useRef<number | null>(null);
  const wheelAt = useRef(0);

  useEffect(() => {
    setList(null);
    setI(0);
  }, [mode]);
  useEffect(() => {
    if (!q.data) return;
    const fresh = q.data.previews.filter((p) => !!trackUrl(p.track));
    setList((cur) => (cur && cur.length ? [...cur, ...fresh.filter((p) => !cur.some((c) => c.track.id === p.track.id))] : fresh));
  }, [q.data]);
  useEffect(() => onPreview((s) => setClip({ at: s.at, playing: s.playing })), []);
  useEffect(() => () => stopPreview(), []);

  const items = useMemo(() => list ?? [], [list]);
  const cur = items[i];
  const next = items[i + 1];
  const start = cur ? previewStart(cur.track, cur.highlight) : 0;

  useEffect(() => {
    if (!cur) return;
    const url = trackUrl(cur.track);
    if (url) void playPreview(url, start);
    const t = setTimeout(() => void previewApi.react(cur.track.id, "").catch(() => {}), 3000);
    const n = next && trackUrl(next.track);
    if (n) warmPreview(n);
    return () => clearTimeout(t);
  }, [cur?.track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((d: number) => setI((x) => Math.max(0, Math.min(items.length - 1, x + d))), [items.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") go(1);
      else if (e.key === "ArrowUp" || e.key === "k") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        togglePreview();
      } else if (e.key === "Escape") router.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, router]);

  const like = async () => {
    if (!cur) return;
    const on = !liked.has(cur.track.id);
    setLiked((s) => {
      const n = new Set(s);
      if (on) n.add(cur.track.id);
      else n.delete(cur.track.id);
      return n;
    });
    try {
      await api.like(cur.track.id, on);
      if (on) void previewApi.react(cur.track.id, "like");
      void queryClient.invalidateQueries({ queryKey: ["likes"] });
    } catch {
      toast("Like not saved");
    }
  };
  const full = () => {
    if (!cur) return;
    void previewApi.react(cur.track.id, "full");
    stopPreview();
    playTracks([cur.track], 0, { type: "queue", name: "Previews" });
    router.back();
  };

  const bars = previewBars(cur?.highlight);
  const dur = cur?.track.duration_ms ?? 0;
  const winL = dur ? (start / dur) * 100 : 0;
  const winW = dur ? (Math.min(CLIP_MS, Math.max(0, dur - start)) / dur) * 100 : 0;
  const head = dur && clip.at >= start ? Math.min(winW, ((clip.at - start) / dur) * 100) : 0;
  const fromFriend = cur?.from_user ? friends?.find((f) => f.person.id === cur.from_user)?.person : null;

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden text-white transition-colors duration-300"
      style={{ background: tintOf(cur) }}
      onTouchStart={(e) => (touch.current = e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dy = e.changedTouches[0].clientY - touch.current;
        touch.current = null;
        if (dy < -60) go(1);
        else if (dy > 60) go(-1);
      }}
      onWheel={(e) => {
        const now = Date.now();
        if (Math.abs(e.deltaY) < 30 || now - wheelAt.current < 600) return;
        wheelAt.current = now;
        go(e.deltaY > 0 ? 1 : -1);
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.28)_0%,transparent_22%,transparent_60%,rgba(0,0,0,0.34)_100%)]" />
      <header className="relative z-10 flex items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),8px)]">
        <button type="button" aria-label="Close" onClick={() => router.back()} className="grid size-11 place-items-center rounded-full">
          <ChevronDown className="size-6" />
        </button>
        <div className="flex flex-1 justify-center">
          <div role="radiogroup" aria-label="Previews" className="inline-flex rounded-[11px] bg-white/12 p-[3px]">
            {(["you", "friends"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("h-8 rounded-[8px] px-3.5 text-[13px] font-extrabold", mode === m ? "bg-white/22 text-white" : "text-white/72")}
              >
                {m === "you" ? "For you" : "Friends"}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          aria-label={muted ? "Sound on" : "Sound off"}
          onClick={() => {
            setPreviewMuted(!muted);
            setMuted(!muted);
          }}
          className="grid size-11 place-items-center rounded-full"
        >
          {muted ? <VolumeX className="size-[22px]" /> : <Volume2 className="size-[22px]" />}
        </button>
      </header>

      {!cur ? (
        <div className="relative z-10 grid h-[70dvh] place-items-center px-6 text-center">
          <p className="font-display text-xl">{q.isError ? "Previews unavailable" : list && !q.data?.growing ? (mode === "friends" ? "No songs from friends yet" : "No previews yet") : "Finding songs"}</p>
        </div>
      ) : (
        <main className="relative z-10 mx-auto grid max-w-md gap-0 px-6 pt-3">
          <button type="button" aria-label={clip.playing ? "Pause" : "Play"} onClick={togglePreview} className="relative mx-auto aspect-square w-full max-w-[400px]">
            <Artwork src={cur.track.artwork_url ?? cur.track.artwork_thumb_url} className="size-full rounded-[16px] object-cover shadow-[0_28px_60px_-18px_rgba(0,0,0,0.7)]" />
            {!clip.playing && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-16 place-items-center rounded-full bg-black/45">
                  <Play className="size-8 fill-current" />
                </span>
              </span>
            )}
          </button>
          <div className="mt-5">
            <h1 dir="auto" className="font-display text-[26px] leading-tight">
              {cur.track.title}
            </h1>
            <p dir="auto" className="mt-0.5 text-base font-bold text-white/78">
              {cur.track.artists.join(", ")}
            </p>
            {cur.reason && (
              <span className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-[10px] bg-white/12 px-2.5 text-[12.5px] font-extrabold text-white/90">
                {fromFriend && <Avatar userId={fromFriend.id} size={18} look={lookOf(fromFriend.id, fromFriend.avatar)} />}
                {cur.reason}
              </span>
            )}
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-extrabold text-white/80 tabular-nums">
              <span className="flex items-center gap-1.5 text-white">
                <span className="size-[7px] rounded-full bg-accent" />
                {previewLabel(cur.highlight, start)}
              </span>
              <span>30 s</span>
            </div>
            <div className="relative flex h-10 items-end gap-[2px]" aria-hidden>
              {bars.map((v, k) => {
                const inside = dur > 0 && ((k + 0.5) / bars.length) * dur >= start && ((k + 0.5) / bars.length) * dur <= start + CLIP_MS;
                return <i key={k} className={cn("block min-h-[3px] flex-1 rounded-[1.5px]", inside ? "bg-white" : "bg-white/25")} style={{ height: `${Math.round(4 + v * 36)}px` }} />;
              })}
              {dur > 0 && (
                <>
                  <span className="absolute -inset-y-1 rounded-[6px] border-[1.5px] border-white/90" style={{ left: `${winL}%`, width: `${winW}%` }} />
                  <span className="absolute -inset-y-1.5 w-0.5 rounded-[1px] bg-accent" style={{ left: `${winL + head}%` }} />
                </>
              )}
            </div>
          </div>
          <div className="mt-6 grid grid-cols-4 text-xs font-extrabold text-white/85">
            <Action label="Like" on={liked.has(cur.track.id)} onClick={() => void like()}>
              <Heart className={cn("size-6", liked.has(cur.track.id) && "fill-current")} />
            </Action>
            <Action
              label="Add"
              onClick={() => {
                void previewApi.react(cur.track.id, "add");
                openAddToPlaylist([cur.track]);
              }}
            >
              <Plus className="size-6" />
            </Action>
            <Action
              label="Send"
              onClick={() => openSend({ kind: "song", track: cur.track, startMs: start, onSent: () => void previewApi.react(cur.track.id, "send") })}
            >
              <Send className="size-[22px]" />
            </Action>
            <Action label="Full song" onClick={full}>
              <Play className="size-[22px] fill-current" />
            </Action>
          </div>
        </main>
      )}

      {next && (
        <>
          <button
            type="button"
            onClick={() => go(1)}
            className="absolute bottom-[max(env(safe-area-inset-bottom),12px)] left-1/2 z-20 inline-flex h-[30px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/34 px-3 text-[12.5px] font-extrabold"
          >
            <ChevronUp className="size-4" />
            <span dir="auto" className="max-w-[60vw] truncate">
              {next.track.title}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

function Action({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="grid justify-items-center gap-1.5">
      <span className={cn("grid size-[52px] place-items-center rounded-full", on ? "bg-accent text-on-accent" : "bg-white/13 text-white")}>{children}</span>
      {label}
    </button>
  );
}
