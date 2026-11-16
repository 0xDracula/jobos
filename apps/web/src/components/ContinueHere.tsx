"use client";

import { useQuery } from "@tanstack/react-query";
import { MonitorSmartphone, Play, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { knownDeviceId } from "@/lib/device";
import { fmtMs } from "@/lib/format";
import { keys, usePlaybackStates } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { continueFrom, localSavedAt } from "@/player/resume";

import { Artwork } from "./media";
import { Button, IconButton } from "./ui";

export function ContinueHere({ className }: { className?: string }) {
  const states = usePlaybackStates();
  const [mine, setMine] = useState<{ id: string | null; savedAt: number } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMine({ id: knownDeviceId(), savedAt: localSavedAt() }), []);
  const own = states.data?.find((s) => s.device_id === mine?.id);
  const newest = Math.max(mine?.savedAt ?? 0, own ? Date.parse(own.updated_at) : 0);
  const other = mine ? states.data?.find((s) => s.device_id !== mine.id && s.track_id && Date.parse(s.updated_at) > newest) : undefined;
  const track = useQuery({
    queryKey: keys.track(other?.track_id ?? ""),
    queryFn: () => api.track(other!.track_id!),
    enabled: !!other?.track_id,
  });
  if (!other || dismissed || !track.data) return null;
  const t = track.data;
  const resume = async () => {
    setBusy(true);
    try {
      if (await continueFrom(other)) setDismissed(true);
      else toast("Continue failed");
    } catch {
      toast("Continue failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Continue here" className={cn("flex items-center gap-4 rounded-card bg-surface-solid/80 p-3 shadow-soft backdrop-blur", className)}>
      <Artwork src={t.artwork_thumb_url} className="size-16 shrink-0 rounded-button" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-accent-strong">
          <MonitorSmartphone className="size-4" /> Continue here
        </div>
        <div dir="auto" className="truncate font-bold">
          {t.title}
        </div>
        <div className="truncate text-sm font-semibold text-muted">
          {other.device_name} · {fmtMs(other.position_ms)}
        </div>
      </div>
      <Button variant="primary" onClick={() => void resume()} disabled={busy} className="shrink-0">
        <Play className="size-5 fill-current" /> Continue
      </Button>
      <IconButton label="Dismiss" size="sm" onClick={() => setDismissed(true)}>
        <X />
      </IconButton>
    </section>
  );
}
