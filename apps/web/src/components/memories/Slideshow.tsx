"use client";

import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PhotoAlbumView } from "@/lib/memories";
import { useTrackDetail } from "@/lib/queries";
import { kenBurns, nextChangeAt, SLIDE_MS } from "@/lib/slideshow";
import { pause as pausePlayer, play as playPlayer } from "@/player/controls";
import { getEngine } from "@/player/engine";
import { usePlayer } from "@/player/store";

import { PhotoImage, playSong, useReducedMotionPref } from "./parts";

type WakeLockSentinelLike = { release: () => Promise<void> };

function useWakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinelLike | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        const l = await nav.wakeLock!.request("screen");
        if (alive) lock = l;
        else void l.release();
      } catch {
      }
    };
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export function Slideshow({ album, onClose }: { album: PhotoAlbumView; onClose: () => void }) {
  const photos = album.photos.filter((p) => p.status === "ready");
  const reduced = useReducedMotionPref();
  const root = useRef<HTMLDivElement>(null);
  const track = album.track;
  const detail = useTrackDetail(track?.id ?? null);
  const beats = detail.data?.id === track?.id ? (detail.data?.audio?.beats ?? null) : null;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [chrome, setChrome] = useState(true);
  const timing = useRef({ clock: "" as "" | "song" | "wall", start: 0, next: 0 });
  const [duration, setDuration] = useState(SLIDE_MS);
  useWakeLock();

  useEffect(() => {
    const el = root.current;
    if (el?.requestFullscreen && !document.fullscreenElement) void el.requestFullscreen().catch(() => {});
    if (track) playSong(track, album.name);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const now = useCallback((): { clock: "song" | "wall"; ms: number } => {
    const s = usePlayer.getState();
    const current = s.index >= 0 ? s.queue[s.index]?.track.id : null;
    if (track && current === track.id && s.playing) return { clock: "song", ms: getEngine().currentTime() * 1000 };
    return { clock: "wall", ms: performance.now() };
  }, [track]);

  const restart = useCallback(() => {
    const t = now();
    const next = nextChangeAt(t.clock === "song" ? beats : null, t.ms);
    timing.current = { clock: t.clock, start: t.ms, next };
    setDuration(Math.max(1000, next - t.ms));
  }, [beats, now]);

  const go = useCallback(
    (d: 1 | -1) => {
      if (!photos.length) return;
      setIndex((i) => (i + d + photos.length) % photos.length);
      restart();
    },
    [photos.length, restart],
  );

  useEffect(() => {
    if (paused || photos.length < 2) return;
    let raf = 0;
    const tick = () => {
      const t = now();
      const s = timing.current;
      if (t.clock !== s.clock || (t.clock === "song" && t.ms < s.start - 1500)) restart();
      else if (t.ms >= s.next) {
        const start = s.next;
        const next = nextChangeAt(t.clock === "song" ? beats : null, start);
        timing.current = { clock: t.clock, start, next };
        setDuration(Math.max(1000, next - start));
        setIndex((i) => (i + 1) % photos.length);
      }
      raf = requestAnimationFrame(tick);
    };
    restart();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, photos.length, beats, now, restart]);

  useEffect(() => {
    if (!chrome) return;
    const t = setTimeout(() => setChrome(false), 3000);
    return () => clearTimeout(t);
  }, [chrome, index]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      playPlayer();
      restart();
    } else pausePlayer();
    setPaused(!pausedRef.current);
  }, [restart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        togglePause();
      } else return;
      setChrome(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, togglePause]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && root.current?.dataset.wasFull === "1") onClose();
      if (document.fullscreenElement && root.current) root.current.dataset.wasFull = "1";
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [onClose]);

  const photo = photos[index];
  const pose = kenBurns(index);
  const fade = reduced ? 0.12 : 0.9;
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={album.name}
      className={cn("fixed inset-0 z-[90] overflow-hidden bg-[#0d0f2b] text-white", !chrome && "cursor-none")}
      onPointerMove={() => setChrome(true)}
      onClick={() => setChrome(true)}
    >
      <AnimatePresence initial={false}>
        {photo && (
          <motion.div
            key={`${photo.id}-${index}`}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: fade, ease: "easeInOut" }}
          >
            <PhotoImage photo={photo} size="thumb" className="absolute inset-0 size-full scale-110 opacity-50 blur-2xl" />
            <motion.div
              className="absolute inset-0"
              initial={reduced ? false : { scale: pose.from.scale, x: `${pose.from.x}%`, y: `${pose.from.y}%` }}
              animate={reduced ? { scale: 1, x: "0%", y: "0%" } : { scale: pose.to.scale, x: `${pose.to.x}%`, y: `${pose.to.y}%` }}
              transition={{ duration: reduced ? 0 : duration / 1000 + fade, ease: "linear" }}
            >
              <PhotoImage photo={photo} size="display" eager fit="contain" className="size-full" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {!photos.length && <p className="absolute inset-0 grid place-items-center font-semibold text-white/70">No photos</p>}

      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-500", chrome ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="pointer-events-auto absolute end-[max(12px,env(safe-area-inset-right))] top-[max(12px,env(safe-area-inset-top))]">
          <IconButton label="Close slideshow" onClick={onClose} className="text-white hover:bg-white/15">
            <X />
          </IconButton>
        </div>
        <div className="absolute inset-x-0 bottom-[max(16px,env(safe-area-inset-bottom))] grid gap-3 px-5">
          <div className="min-w-0">
            <p dir="auto" className="truncate font-display text-xl font-semibold [text-shadow:0_1px_8px_#000]">
              {album.name}
            </p>
            {photo?.caption && (
              <p dir="auto" className="truncate font-hand text-xl [text-shadow:0_1px_8px_#000]">
                {photo.caption}
              </p>
            )}
          </div>
          <div className="pointer-events-auto flex items-center justify-center gap-3">
            <IconButton label="Previous photo" onClick={() => go(-1)} className="text-white hover:bg-white/15">
              <ChevronLeft />
            </IconButton>
            <IconButton label={paused ? "Play slideshow" : "Pause slideshow"} size="lg" onClick={togglePause} className="bg-white/15 text-white hover:bg-white/25">
              {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
            </IconButton>
            <IconButton label="Next photo" onClick={() => go(1)} className="text-white hover:bg-white/15">
              <ChevronRight />
            </IconButton>
          </div>
          <p className="tabular text-center text-xs font-bold text-white/70">
            {photos.length ? `${index + 1} / ${photos.length}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
