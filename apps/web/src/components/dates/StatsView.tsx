"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { Loading } from "@/components/common";
import { Artwork } from "@/components/media";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { CoverShelf } from "@/components/Shelf";
import { PageHero } from "@/components/sky/PageHero";
import { Chip, Empty, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { fmtCount, fmtHours, hourLabel } from "@/lib/dateMath";
import { datesApi, datesKeys, useStats, useTogether, type ListeningStats, type StatsRange, type TogetherStats } from "@/lib/dates";
import { useMe, useMembers } from "@/lib/session";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { HourBars } from "./HourBars";
import { DatePanel, Figure } from "./parts";

const RANGES: [StatsRange, string][] = [
  ["week", "Week"],
  ["month", "Month"],
  ["year", "Year"],
  ["all", "All time"],
];

const RANGE_META: Record<StatsRange, string> = { week: "Last 7 days", month: "Last 30 days", year: "Last 365 days", all: "All time" };

const EXCHANGE_LABELS: [string, string][] = [
  ["card", "Song cards"],
  ["mixtape", "Mixtape songs"],
  ["dedication", "Dedications"],
  ["swap", "Song swaps"],
];

function TopSongs({ tracks }: { tracks: ListeningStats["top_songs"] }) {
  if (!tracks.length) return <Empty>No plays</Empty>;
  return (
    <ol className="grid grid-cols-1 gap-1">
      {tracks.map((t, i) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => playTracks(tracks, i, { type: "history", name: "Top songs" })}
            className="flex min-h-14 w-full items-center gap-3 rounded-[8px] px-1 py-1 text-start hover:bg-accent-soft/50"
          >
            <span className="tabular w-5 shrink-0 text-center text-sm font-extrabold text-muted">{i + 1}</span>
            <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-12 shrink-0 rounded-[6px]" />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate font-extrabold">
                {t.title}
              </span>
              <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                {t.artists.join(", ")}
              </span>
            </span>
            <span className="tabular shrink-0 text-sm font-bold text-muted">{t.plays}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function TopArtists({ artists }: { artists: ListeningStats["top_artists"] }) {
  if (!artists.length) return <Empty>No plays</Empty>;
  return (
    <ol className="grid grid-cols-1 gap-1">
      {artists.map((a, i) => (
        <li key={a.id}>
          <Link href={`/artist/?id=${a.id}`} className="flex min-h-14 items-center gap-3 rounded-[8px] px-1 py-1 hover:bg-accent-soft/50">
            <span className="tabular w-5 shrink-0 text-center text-sm font-extrabold text-muted">{i + 1}</span>
            <Artwork src={a.image_url} className="size-11 shrink-0 rounded-full" />
            <span dir="auto" className="min-w-0 flex-1 truncate font-extrabold">
              {a.name}
            </span>
            <span className="tabular shrink-0 text-sm font-bold text-muted">{a.plays}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Genres({ genres }: { genres: ListeningStats["top_genres"] }) {
  if (!genres.length) return <Empty>No genres yet</Empty>;
  return (
    <ul className="flex flex-wrap gap-2">
      {genres.map((g) => (
        <li key={g.name} dir="auto" className="rounded-full border border-line bg-panel px-3 py-1 text-sm font-bold first-letter:uppercase">
          {g.name}
        </li>
      ))}
    </ul>
  );
}

function Listening({ st }: { st: ListeningStats }) {
  const t = st.totals;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <DatePanel title="Listening">
        <div className="mb-4 flex items-end gap-3">
          <PixelIcon name="headphones" size={48} className="mb-1 shrink-0" />
          <div>
            <div className="text-[52px] font-extrabold leading-none">{fmtCount(t.minutes)}</div>
            <div className="mt-1 font-bold text-muted">Minutes listened · {fmtHours(t.minutes)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Figure label="Plays" value={fmtCount(t.plays)} />
          <Figure label="Songs" value={fmtCount(t.songs)} />
          <Figure label="Days" value={fmtCount(t.days)} />
          <Figure label="Current streak" value={`${st.streaks.current} ${st.streaks.current === 1 ? "day" : "days"}`} />
          <Figure label="Longest streak" value={`${st.streaks.longest} ${st.streaks.longest === 1 ? "day" : "days"}`} />
          <Figure label="Top hour" value={st.top_hour >= 0 ? hourLabel(st.top_hour) : "—"} />
        </div>
      </DatePanel>
      <DatePanel title="Listening by hour">
        <HourBars hours={st.hours} className="mt-8" />
      </DatePanel>
      <DatePanel title="Top songs">
        <TopSongs tracks={st.top_songs} />
      </DatePanel>
      <div className="grid grid-cols-1 gap-6">
        <DatePanel title="Top artists">
          <TopArtists artists={st.top_artists} />
        </DatePanel>
        <DatePanel title="Top genres">
          <Genres genres={st.top_genres} />
        </DatePanel>
      </div>
    </div>
  );
}

function Together({ st }: { st: TogetherStats }) {
  const members = useMembers();
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const recent = st.exchanged.recent.map((s) => s.track as unknown as Track);
  return (
    <section aria-labelledby="together" className="grid grid-cols-1 gap-6">
      <h2 id="together" className="font-display text-2xl font-semibold">
        Together
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Minutes together" value={fmtCount(st.minutes_together)} />
        <Figure label="Taste match" value={st.taste_match == null ? "—" : `${st.taste_match}%`} />
        <Figure label="Liked by both" value={fmtCount(st.both_liked)} />
        <Figure label="Songs exchanged" value={fmtCount(st.exchanged.total)} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <DatePanel title="Our song">
          {st.our_song.track ? (
            <div className="flex items-center gap-3">
              <Link href="/song/" className="shrink-0">
                <Artwork src={st.our_song.track.artwork_thumb_url ?? st.our_song.track.artwork_url} className="size-16 rounded-[6px]" />
              </Link>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="truncate font-extrabold">
                  {st.our_song.track.title}
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-muted">
                  {st.our_song.plays.map((p) => (
                    <li key={p.user_id}>
                      {name(p.user_id)} <span className="text-ink">{p.plays}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <Empty>No song set</Empty>
          )}
        </DatePanel>
        <DatePanel title="Songs exchanged">
          <ul className="grid grid-cols-2 gap-2">
            {EXCHANGE_LABELS.map(([k, label]) => (
              <li key={k}>
                <Figure label={label} value={fmtCount(st.exchanged.by_kind[k] ?? 0)} />
              </li>
            ))}
          </ul>
        </DatePanel>
      </div>
      {st.both_liked_tracks.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-xl font-semibold">Liked by both</h3>
          <CoverShelf tracks={st.both_liked_tracks} context={{ type: "likes", name: "Liked by both" }} label="Liked by both" />
        </div>
      )}
      {recent.length > 0 && (
        <div>
          <h3 className="mb-3 font-display text-xl font-semibold">Recently exchanged</h3>
          <CoverShelf tracks={recent} context={{ type: "history", name: "Recently exchanged" }} label="Recently exchanged" />
        </div>
      )}
    </section>
  );
}

export function StatsView() {
  const me = useMe().data;
  const members = useMembers();
  const other = members.data?.find((u) => u.id !== me?.id);
  const [range, setRange] = useState<StatsRange>("month");
  const [person, setPerson] = useState<string | null>(null);
  const otherVisible = useQuery({
    queryKey: datesKeys.stats("week", other?.id),
    queryFn: () => datesApi.stats("week", other!.id),
    enabled: !!other,
    retry: false,
  });
  const canSeeOther = !!other && otherVisible.isSuccess;
  const subject = person && canSeeOther ? person : undefined;
  const stats = useStats(range, subject);
  const together = useTogether();
  const forbidden = stats.error instanceof ApiError && stats.error.status === 403;
  const whose = subject ? (other?.display_name ?? "") : "You";

  return (
    <>
      <PageHero title="Stats" meta={`${whose} · ${RANGE_META[range]}`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar -mx-1 max-w-full overflow-x-auto px-1">
            <Segmented label="Range" value={range} options={RANGES} onChange={setRange} />
          </div>
          {canSeeOther && (
            <div className="flex gap-2">
              <Chip selected={!subject} onClick={() => setPerson(null)}>
                You
              </Chip>
              <Chip selected={!!subject} onClick={() => setPerson(other!.id)}>
                {other!.display_name}
              </Chip>
            </div>
          )}
        </div>
      </PageHero>
      <div className="grid grid-cols-1 gap-10">
        {stats.isLoading && <Loading />}
        {forbidden && <Empty>Listening history not visible</Empty>}
        {stats.data && <Listening st={stats.data} />}
        {together.data && together.data.members.length === 2 && <Together st={together.data} />}
      </div>
    </>
  );
}
