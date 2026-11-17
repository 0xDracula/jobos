"use client";

import Link from "next/link";

import { PhotoImage } from "@/components/memories/parts";
import { cn } from "@/lib/cn";
import { tilt } from "@/lib/days";
import { useMemories, useMemoriesLive } from "@/lib/memories";
import type { Track } from "@/lib/types";
import { collapse } from "@/player/controls";

export function MemoryPhoto({ track, className }: { track: Track; className?: string }) {
  useMemoriesLive();
  const memories = useMemories();
  const m = memories.data?.find((x) => x.track_id === track.id && x.photo?.status === "ready");
  if (!m) return null;
  return (
    <Link
      href={`/memories/?id=${m.id}`}
      onClick={() => collapse()}
      aria-label={`Memory: ${m.title}`}
      title={m.title}
      className={cn("grid size-11 shrink-0 place-items-center", className)}
    >
      <span className="block w-[34px] bg-[#fffdf8] p-[2px] pb-[6px] shadow-[0_3px_8px_rgba(20,10,30,0.35)] transition-transform hover:scale-110" style={{ rotate: `${tilt(m.id, 6)}deg` }}>
        <PhotoImage photo={m.photo} className="block aspect-square w-full" />
      </span>
    </Link>
  );
}
