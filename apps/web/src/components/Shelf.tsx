"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import type { PlayContext } from "@/player/store";

import { Artwork } from "./media";
import { PixelIcon, type PixelIconName } from "./pixel/PixelIcon";

export function Plank({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-5 lg:mx-0 lg:px-0">{children}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-1 h-[10px] rounded-[2px] bg-[linear-gradient(var(--plank-hi)_0_3px,var(--plank)_3px)] shadow-[0_5px_0_var(--plank-shade)] max-lg:-mx-4"
      />
    </div>
  );
}

export function CoverShelf({ tracks, context, label }: { tracks: Track[]; context: PlayContext; label: string }) {
  return (
    <Plank>
      {tracks.map((t, i) => (
        <button
          key={`${t.id}-${i}`}
          type="button"
          onClick={() => playTracks(tracks, i, context)}
          aria-label={`Play ${t.title} from ${label}`}
          className="group grid w-[118px] shrink-0 snap-start gap-1.5 text-start sm:w-[140px] lg:w-[150px]"
        >
          <Artwork
            src={t.artwork_thumb_url ?? t.artwork_url}
            className="aspect-square w-full rounded-[6px] shadow-[0_8px_18px_rgba(10,8,30,0.35)] transition-transform duration-200 ease-out group-hover:-translate-y-1"
          />
          <span dir="auto" className="truncate text-sm font-extrabold">
            {t.title}
          </span>
          <span dir="auto" className="-mt-1.5 truncate text-[13px] font-semibold text-muted">
            {t.artists.join(", ")}
          </span>
        </button>
      ))}
    </Plank>
  );
}

export type Keepsake = { href: string; label: string; icon: PixelIconName };

export const KEEPSAKES: Keepsake[] = [
  { href: "/song/", label: "Our song", icon: "record" },
  { href: "/notes/", label: "Song notes", icon: "notes" },
  { href: "/scrapbook/", label: "Scrapbook", icon: "scrap" },
  { href: "/dedications/", label: "Dedications", icon: "mic" },
  { href: "/mixtapes/", label: "Mixtapes", icon: "cassette" },
  { href: "/favorites/", label: "Favorite things", icon: "flower" },
  { href: "/stars/", label: "Star map", icon: "star" },
  { href: "/discover/", label: "Discover", icon: "window" },
  { href: "/together/", label: "Listen together", icon: "headphones" },
];

export function KeepsakeTiles({ items = KEEPSAKES }: { items?: Keepsake[] }) {
  return (
    <nav aria-label="Keepsakes" className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-9">
      {items.map((k) => (
        <Link
          key={k.href}
          href={k.href}
          className="group grid min-h-[104px] justify-items-center gap-2 rounded-[8px] border-2 border-b-[5px] border-panel-line bg-panel px-1.5 pb-2.5 pt-3.5 text-center text-[13px] font-extrabold leading-tight transition-[transform,background-color] duration-150 hover:-translate-y-0.5 hover:bg-accent-soft/60 active:translate-y-0"
        >
          <PixelIcon name={k.icon} size={40} className="transition-transform duration-200 group-hover:scale-110" />
          <span>{k.label}</span>
        </Link>
      ))}
    </nav>
  );
}
