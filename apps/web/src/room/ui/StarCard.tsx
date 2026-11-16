"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { Dialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import type { Star, StarKind } from "@/lib/gift";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import { playTracks } from "@/player/controls";

export const STAR_KINDS: Record<StarKind, string> = {
  card: "Song card",
  dedication: "Dedication",
  mixtape: "Mixtape",
  swap: "Song swap",
  note: "Song note",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-semibold text-muted">{label}</span>
      <span className="text-end font-bold" dir="auto">
        {value}
      </span>
    </div>
  );
}

export async function playStar(star: Star) {
  try {
    const track = await api.track(star.track.id);
    playTracks([track], 0, { type: "queue", name: "Star map" });
  } catch {
    toast("Song unavailable");
  }
}

export function StarBody({ star }: { star: Star }) {
  const members = useMembers();
  const [busy, setBusy] = useState(false);
  const who = members.data?.find((u) => u.id === star.user_id)?.display_name ?? "";
  const date = new Date(star.at);
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Artwork src={star.track.artwork_thumb_url ?? star.track.artwork_url} className="size-16 shrink-0 rounded-chip" />
        <div className="min-w-0">
          <p dir="auto" className="truncate font-display text-lg font-semibold">
            {star.track.title}
          </p>
          <p dir="auto" className="truncate font-semibold text-muted">
            {star.track.artists.join(", ")}
          </p>
        </div>
      </div>
      <div className="grid rounded-card bg-surface-solid/60 px-4 py-2">
        <Row label="Shared by" value={who} />
        <Row label="Date" value={Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })} />
        <Row label="Type" value={STAR_KINDS[star.kind] ?? star.kind} />
      </div>
      {star.note && (
        <p dir="auto" className="whitespace-pre-line rounded-card bg-[#fffdf8] p-4 font-hand text-2xl leading-8 text-[#3b2f3f] shadow-soft">
          {star.note}
        </p>
      )}
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await playStar(star);
          setBusy(false);
        }}
      >
        <Play className="size-4 fill-current" />
        Play
      </Button>
    </div>
  );
}

export function StarDialog({ star, onClose }: { star: Star | null; onClose: () => void }) {
  return (
    <Dialog open={!!star} onOpenChange={(o) => !o && onClose()} title={star?.track.title ?? ""}>
      {star && <StarBody star={star} />}
    </Dialog>
  );
}
