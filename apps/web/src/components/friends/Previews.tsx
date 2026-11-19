"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Artwork } from "@/components/media";
import { cn } from "@/lib/cn";
import { onPreview, playPreview, stopPreview } from "@/lib/previewPlayer";
import { CLIP_MS, previewBars, previewLabel, previewStart, usePreviews, type Preview } from "@/lib/previews";
import { trackUrl } from "@/player/engine";

export function PreviewsCard({ className }: { className?: string }) {
  const list = usePreviews("you").data?.previews ?? [];
  const covers = list.slice(0, 3).map((p) => p.track.artwork_thumb_url ?? p.track.artwork_url);
  const fresh = list.filter((p) => !p.seen).length;
  return (
    <Link
      href="/previews/"
      className={cn("group flex items-center gap-3.5 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong hover:bg-surface-2/40", className)}
    >
      <span className="relative h-14 w-[78px] shrink-0">
        {[2, 1, 0].map((k) =>
          covers[k] || k === 0 ? (
            <span
              key={k}
              className="absolute top-1/2 overflow-hidden rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out group-hover:translate-x-[var(--fan)]"
              style={{ left: k * 11, zIndex: 3 - k, transform: `translateY(-50%) scale(${1 - k * 0.12})`, filter: k ? `brightness(${1 - k * 0.22})` : undefined, ["--fan" as string]: `${k * 3}px` }}
            >
              <Artwork src={covers[k] ?? null} className="size-14" />
            </span>
          ) : null,
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-extrabold">Previews</span>
        <span className="block text-[13px] font-semibold text-muted">{fresh ? `${fresh} new songs · 30 s each` : "New songs · 30 s each"}</span>
      </span>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
        <Play className="ms-0.5 size-[18px] fill-current" />
      </span>
    </Link>
  );
}

function HoldTile({ p }: { p: Preview }) {
  const [held, setHeld] = useState(false);
  const [at, setAt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const start = previewStart(p.track, p.highlight);
  const url = trackUrl(p.track);
  useEffect(() => {
    if (!held) return;
    return onPreview((s) => setAt(s.at));
  }, [held]);
  const down = () => {
    if (!url) return;
    timer.current = setTimeout(() => {
      holding.current = true;
      setHeld(true);
      void playPreview(url, start);
    }, 280);
  };
  const up = () => {
    if (timer.current) clearTimeout(timer.current);
    if (holding.current) stopPreview();
    setHeld(false);
  };
  const bars = previewBars(p.highlight, 30);
  const dur = p.track.duration_ms ?? 0;
  const left = Math.max(0, Math.round((start + CLIP_MS - at) / 1000));
  return (
    <li className="grid gap-2">
      <Link
        href="/previews/"
        aria-label={`${p.track.title}, hold to preview`}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (holding.current) {
            e.preventDefault();
            holding.current = false;
          }
        }}
        className={cn("relative block aspect-square select-none overflow-hidden rounded-[12px] transition-transform [-webkit-touch-callout:none]", held && "scale-[1.04] ring-[2.5px] ring-accent ring-offset-2 ring-offset-bg")}
      >
        <Artwork src={p.track.artwork_url ?? p.track.artwork_thumb_url} className="size-full object-cover" />
        {held && (
          <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.72),transparent)] px-2.5 pb-2.5 pt-6 text-white">
            <span className="flex h-[22px] items-end gap-[1.5px]">
              {bars.map((v, k) => {
                const t = ((k + 0.5) / bars.length) * dur;
                return <i key={k} className={cn("block min-h-[3px] flex-1 rounded-[1px]", t >= start && t <= start + CLIP_MS ? "bg-white" : "bg-white/35")} style={{ height: `${Math.round(3 + v * 19)}px` }} />;
              })}
            </span>
            <span className="mt-1.5 flex justify-between text-[11px] font-extrabold tabular-nums">
              <span>{previewLabel(p.highlight, start)}</span>
              <span>0:{String(left).padStart(2, "0")}</span>
            </span>
          </span>
        )}
      </Link>
      <span className="min-w-0 text-left">
        <span dir="auto" className="block truncate text-sm font-extrabold">
          {p.track.title}
        </span>
        <span dir="auto" className="block truncate text-[12.5px] font-semibold text-muted">
          {p.track.artists.join(", ")}
        </span>
      </span>
    </li>
  );
}

export function NewForYou() {
  const list = (usePreviews("you").data?.previews ?? []).filter((p) => !!trackUrl(p.track)).slice(0, 4);
  return (
    <section className="grid gap-3">
      <PreviewsCard />
      {list.length > 0 && (
        <>
          <div className="mt-3 flex items-baseline justify-between">
            <h2 className="font-display text-xl">New for you</h2>
            <Link href="/previews/" className="text-[13px] font-bold text-muted transition-colors hover:text-ink">
              All
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            {list.map((p) => (
              <HoldTile key={p.track.id} p={p} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
