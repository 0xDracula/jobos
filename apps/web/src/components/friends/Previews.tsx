"use client";

import { Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Artwork } from "@/components/media";
import { cn } from "@/lib/cn";
import { onPreview, playPreview, stopPreview } from "@/lib/previewPlayer";
import { CLIP_MS, previewBars, previewLabel, previewStart, usePreviews, type Preview } from "@/lib/previews";
import { trackUrl } from "@/player/engine";

export function Vinyl({ src, size, spin = "off", className }: { src: string | null | undefined; size: number | string; spin?: "on" | "off" | "hover"; className?: string }) {
  return (
    <span aria-hidden className={cn("relative block shrink-0 rounded-full shadow-[0_16px_34px_-12px_rgba(0,0,0,0.75)]", className)} style={{ width: size, height: size }}>
      <span
        className={cn(
          "vinyl absolute inset-0 grid place-items-center animate-[record-spin_3.2s_linear_infinite]",
          spin !== "on" && "[animation-play-state:paused]",
          spin === "hover" && "group-hover:[animation-play-state:running]",
        )}
      >
        <span className="block size-[36%] overflow-hidden rounded-full ring-[3px] ring-[#0c0c0c]">
          <Artwork src={src} className="size-full object-cover" />
        </span>
      </span>
      <span className="vinyl-sheen absolute inset-0" />
      <span className="absolute left-1/2 top-1/2 size-[5%] min-h-1 min-w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#e9e2d8]" />
    </span>
  );
}

export function PreviewsCard({ className }: { className?: string }) {
  const list = usePreviews("you").data?.previews ?? [];
  const cover = list[0] ? (list[0].track.artwork_thumb_url ?? list[0].track.artwork_url) : null;
  const fresh = list.filter((p) => !p.seen).length;
  return (
    <Link
      href="/previews/"
      className={cn("group flex items-center gap-3.5 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong hover:bg-surface-2/40", className)}
    >
      <span className="relative h-14 w-[86px] shrink-0">
        <Vinyl src={cover} size={52} spin="hover" className="absolute start-[30px] top-0.5 transition-transform duration-500 ease-out group-hover:translate-x-1.5" />
        <span className="absolute start-0 top-0 size-14 overflow-hidden rounded-[6px] shadow-[5px_6px_14px_-4px_rgba(0,0,0,0.55)]">
          <Artwork src={cover} className="size-full object-cover" />
        </span>
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
        {held && <Vinyl src={p.track.artwork_thumb_url ?? p.track.artwork_url} size={36} spin="on" className="absolute end-2 top-2" />}
        {held && (
          <span className="absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.72),transparent)] px-2.5 pb-2.5 pt-6 text-white">
            <span className="flex h-[22px] items-end gap-[1.5px]">
              {bars.map((v, k) => {
                const t = ((k + 0.5) / bars.length) * dur;
                const inside = t >= start && t <= start + CLIP_MS;
                return <i key={k} className={cn("block min-h-[3px] flex-1 rounded-[1px]", inside && t <= at ? "bg-accent" : inside ? "bg-white" : "bg-white/35")} style={{ height: `${Math.round(3 + v * 19)}px` }} />;
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
