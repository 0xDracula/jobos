"use client";

import { useQuery } from "@tanstack/react-query";
import { MonitorSmartphone, Play, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Loading } from "@/components/common";
import { Artwork, CardGrid, CardRow, Cover, MediaCard } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { Button, Empty, IconButton, PageTitle, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { knownDeviceId } from "@/lib/device";
import { fmtMs } from "@/lib/format";
import { keys, usePlaybackStates, usePlaylists, useRecent, useTop } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { playTracks } from "@/player/controls";
import { continueFrom, localSavedAt } from "@/player/resume";

function ContinueHere() {
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
    <section aria-label="Continue here" className="mb-8 flex items-center gap-4 rounded-card bg-surface-solid/70 p-3 shadow-soft">
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

export default function HomePage() {
  const recent = useRecent();
  const top = useTop();
  const playlists = usePlaylists();
  const recentTracks = recent.data ?? [];
  return (
    <>
      <PageTitle>Home</PageTitle>
      <ContinueHere />

      <section className="mb-10">
        <SectionTitle>Recently played</SectionTitle>
        {recent.isLoading ? (
          <Loading />
        ) : recentTracks.length ? (
          <CardRow>
            {recentTracks.slice(0, 20).map((t, i) => (
              <MediaCard
                key={t.id}
                onClick={() => playTracks(recentTracks, i, { type: "history", name: "Recently played" })}
                image={<Artwork src={t.artwork_thumb_url} className="size-full" />}
                title={t.title}
                subtitle={t.artists.join(", ")}
              />
            ))}
          </CardRow>
        ) : (
          <Empty>No plays yet</Empty>
        )}
      </section>

      <section className="mb-10">
        <SectionTitle
          action={
            <Link href="/library/" className="text-sm font-bold text-accent-strong hover:underline">
              Library
            </Link>
          }
        >
          Playlists
        </SectionTitle>
        {playlists.isLoading ? (
          <Loading />
        ) : playlists.data?.length ? (
          <CardGrid>
            {playlists.data.map((p) => (
              <MediaCard
                key={p.id}
                href={`/playlist/?id=${p.id}`}
                image={<Cover cover={p.cover_url} collage={p.collage} className="size-full" />}
                title={p.name}
                subtitle={`${p.counts.total} songs`}
              />
            ))}
          </CardGrid>
        ) : (
          <Empty>No playlists</Empty>
        )}
      </section>

      <section>
        <SectionTitle>Most played</SectionTitle>
        {top.isLoading ? (
          <Loading />
        ) : top.data?.length ? (
          <TrackList tracks={top.data.slice(0, 10)} context={{ type: "history", name: "Most played" }} />
        ) : (
          <Empty>No plays yet</Empty>
        )}
      </section>
    </>
  );
}
