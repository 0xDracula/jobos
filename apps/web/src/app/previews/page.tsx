"use client";

import { ChevronDown, ChevronUp, Heart, Play, Plus, Send, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, lookOf } from "@/avatar";
import { openAddToPlaylist } from "@/components/dialogs";
import { Vinyl } from "@/components/friends/Previews";
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
  const mix = (c: number) => Math.round(c * 0.36 + 12);
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
  const left = Math.max(0, Math.round((start + CLIP_MS - Math.max(clip.at, start)) / 1000));
  const fromFriend = cur?.from_user ? friends?.find((f) => f.person.id === cur.from_user)?.person : null;
  const art = cur ? (cur.track.artwork_url ?? cur.track.artwork_thumb_url) : null;
  const isLiked = !!cur && liked.has(cur.track.id);

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden text-white transition-colors duration-500"
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
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.2)_0%,transparent_16%,rgba(12,8,6,0.5)_58%,rgba(12,8,6,0.82)_100%)]" />
      <header className="relative z-10 flex shrink-0 items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),8px)]">
        <button type="button" aria-label="Close" onClick={() => router.back()} className="grid size-11 place-items-center rounded-full transition-colors hover:bg-white/10">
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
                className={cn("h-8 rounded-[8px] px-3.5 text-[13px] font-extrabold transition-colors", mode === m ? "bg-white/22 text-white" : "text-white/72 hover:text-white")}
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
          className="grid size-11 place-items-center rounded-full transition-colors hover:bg-white/10"
        >
          {muted ? <VolumeX className="size-[22px]" /> : <Volume2 className="size-[22px]" />}
        </button>
      </header>

      {!cur ? (
        <div className="relative z-10 grid flex-1 place-items-center px-6 text-center">
          <p className="font-display text-xl">{q.isError ? "Previews unavailable" : list && !q.data?.growing ? (mode === "friends" ? "No songs from friends yet" : "No previews yet") : "Finding songs"}</p>
        </div>
      ) : (
        <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-7 py-4 [--s:min(56vw,32dvh,260px)]">
          <button
            type="button"
            aria-label={clip.playing ? "Pause" : "Play"}
            onClick={togglePreview}
            className="relative block h-[var(--s)] w-full shrink-0 text-start"
          >
            <span key={cur.track.id} className="absolute top-[calc(var(--s)*0.03)] start-[calc(var(--s)*0.55)] animate-[record-out_700ms_cubic-bezier(0.16,1,0.3,1)_150ms_both]">
              <Vinyl src={art} size="calc(var(--s) * 0.94)" spin={clip.playing ? "on" : "off"} />
            </span>
            <span className="absolute start-0 top-0 block size-[var(--s)] overflow-hidden rounded-[6px] shadow-[12px_18px_40px_-10px_rgba(0,0,0,0.75)]">
              <Artwork src={art} className="size-full object-cover" eager />
              {!clip.playing && (
                <span className="absolute inset-0 grid place-items-center bg-black/25">
                  <span className="grid size-14 place-items-center rounded-full bg-black/50 backdrop-blur-sm">
                    <Play className="ms-0.5 size-7 fill-current" />
                  </span>
                </span>
              )}
            </span>
          </button>

          <div className="mt-7 text-left">
            <h1 dir="auto" className="truncate font-display text-[30px] font-extrabold leading-tight tracking-[-0.02em]">
              {cur.track.title}
            </h1>
            <p dir="auto" className="mt-0.5 truncate text-base font-bold text-white/75">
              {cur.track.artists.join(", ")}
            </p>
            {cur.reason && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-extrabold text-white/60">
                {fromFriend ? <Avatar userId={fromFriend.id} size={18} look={lookOf(fromFriend.id, fromFriend.avatar)} /> : <Sparkles className="size-3.5" />}
                {cur.reason}
              </p>
            )}
          </div>

          <div className="mt-5" aria-hidden>
            <div className="flex h-10 items-end gap-[2px]">
              {bars.map((v, k) => {
                const t = ((k + 0.5) / bars.length) * dur;
                const inside = dur > 0 && t >= start && t <= start + CLIP_MS;
                return (
                  <i
                    key={k}
                    className={cn("block min-h-[3px] flex-1 rounded-[2px] transition-colors duration-300", inside && t <= clip.at ? "bg-accent" : inside ? "bg-white/55" : "bg-white/20")}
                    style={{ height: `${Math.round(4 + v * 36)}px` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-xs font-extrabold text-white/65 tabular-nums">
              <span>{previewLabel(cur.highlight, start)}</span>
              <span>0:{String(left).padStart(2, "0")}</span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2.5">
            <Round label="Like" on={isLiked} onClick={() => void like()}>
              <Heart className={cn("size-[22px]", isLiked && "fill-current")} />
            </Round>
            <Round
              label="Add"
              onClick={() => {
                void previewApi.react(cur.track.id, "add");
                openAddToPlaylist([cur.track]);
              }}
            >
              <Plus className="size-[22px]" />
            </Round>
            <Round label="Send" onClick={() => openSend({ kind: "song", track: cur.track, startMs: start, onSent: () => void previewApi.react(cur.track.id, "send") })}>
              <Send className="size-5" />
            </Round>
            <button
              type="button"
              onClick={full}
              className="ms-auto inline-flex h-[50px] items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-extrabold text-on-accent transition-[filter,transform] hover:brightness-105 active:scale-[0.97]"
            >
              <Play className="size-4 fill-current" /> Full song
            </button>
          </div>
        </main>
      )}

      {next && (
        <div className="relative z-10 mx-auto w-full max-w-md shrink-0 px-7 pb-[max(env(safe-area-inset-bottom),20px)]">
          <button
            type="button"
            onClick={() => go(1)}
            className="flex w-full items-center gap-2.5 rounded-[14px] bg-white/7 p-2 text-start transition-colors hover:bg-white/12"
          >
            <Artwork src={next.track.artwork_thumb_url ?? next.track.artwork_url} className="size-10 shrink-0 rounded-[8px] object-cover" />
            <span className="min-w-0 flex-1 text-left">
              <span dir="auto" className="block truncate text-sm font-extrabold">
                {next.track.title}
              </span>
              <span dir="auto" className="block truncate text-[12.5px] font-bold text-white/60">
                {next.track.artists.join(", ")}
              </span>
            </span>
            <ChevronUp aria-label="Next" className="me-1.5 size-5 shrink-0 text-white/60" />
          </button>
        </div>
      )}
    </div>
  );
}

function Round({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "grid size-[50px] shrink-0 place-items-center rounded-full border-[1.5px] transition-colors active:scale-95",
        on ? "border-accent bg-accent text-on-accent" : "border-white/25 text-white hover:border-white/45 hover:bg-white/8",
      )}
    >
      {children}
    </button>
  );
}
