"use client";

import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { keys } from "@/lib/queries";
import type { LyricLine } from "@/lib/types";
import { seek } from "@/player/controls";

import { Spinner } from "../ui";
import { usePlaybackClock } from "./clock";

const notYet = (err: unknown) => err instanceof ApiError && err.status === 404;

export function LyricsPanel({ trackId }: { trackId: string }) {
  const q = useQuery({
    queryKey: keys.lyrics(trackId),
    queryFn: () => api.lyrics(trackId),
    retry: false,
    refetchInterval: (query) => (notYet(query.state.error) && query.state.errorUpdateCount < 60 ? 5000 : false),
  });
  const center = "grid min-h-0 flex-1 place-items-center font-display text-xl font-semibold text-muted";
  if (q.isLoading) {
    return (
      <div className={center}>
        <Spinner className="size-7" />
      </div>
    );
  }
  if (q.error) {
    return (
      <div className={center}>
        <span className="inline-flex items-center gap-2">
          {notYet(q.error) && <Spinner className="size-5" />}
          {notYet(q.error) ? "Lyrics pending" : "Lyrics unavailable"}
        </span>
      </div>
    );
  }
  const v = q.data!;
  if (v.status === "synced" && v.lines?.length) return <SyncedLyrics key={trackId} lines={v.lines} offset={v.offset_ms} />;
  if (v.status === "plain" && v.plain) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-6">
        {v.plain.split("\n").map((line, i) => (
          <p key={i} dir="auto" className="min-h-4 text-start text-xl font-extrabold leading-relaxed lg:text-2xl">
            {line}
          </p>
        ))}
      </div>
    );
  }
  return <div className={center}>{v.status === "instrumental" ? "Instrumental" : "No lyrics"}</div>;
}

function lineAt(lines: LyricLine[], offset: number, ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time_ms + offset <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function SyncedLyrics({ lines, offset }: { lines: LyricLine[]; offset: number }) {
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);
  const reduced = useReducedMotion();

  usePlaybackClock((t) => {
    const i = lineAt(lines, offset, t * 1000 + 150);
    setActive((prev) => (prev === i ? prev : i));
  });

  useEffect(() => {
    if (Date.now() - userScrolled.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${Math.max(0, active)}"]`);
    if (!el || !box.current) return;
    const top = el.offsetTop - box.current.clientHeight / 2 + el.clientHeight / 2;
    box.current.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  const markUser = () => {
    userScrolled.current = Date.now();
  };

  return (
    <div
      ref={box}
      onWheel={markUser}
      onTouchMove={markUser}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-[38%] [mask-image:linear-gradient(transparent,black_14%,black_86%,transparent)] lg:py-[30%]"
    >
      {lines.map((line, i) => (
        <button
          key={i}
          type="button"
          data-line={i}
          dir="auto"
          onClick={() => seek(Math.max(0, (line.time_ms + offset) / 1000))}
          className={cn(
            "block w-full rounded-button px-3 py-2 text-start text-[26px] font-extrabold leading-snug transition-[opacity,color,transform] duration-300 lg:text-[32px]",
            i === active ? "text-ink" : i < active ? "text-ink opacity-35" : "text-ink opacity-50 hover:opacity-80",
          )}
        >
          {line.text || "♪"}
        </button>
      ))}
    </div>
  );
}
