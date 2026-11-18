"use client";

import { Play } from "lucide-react";
import Link from "next/link";

import { Loading } from "@/components/common";
import { MixShelf, ReleasesShelf, TimeMixShelf } from "@/components/mixes/Mixes";
import { Artwork } from "@/components/media";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { PageHero } from "@/components/sky/PageHero";
import { TrackList } from "@/components/tracks";
import { Button, Empty, SectionTitle } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { holidayActive, useRoomConfig } from "@/lib/gift";
import { useOurSong } from "@/lib/keepsakes";
import { MADE_FOR_YOU, MOOD_LABELS, MOOD_MIXES, TIME_MIXES, WEATHER_CONDITIONS, useWeatherMix } from "@/lib/mixes";
import { usePlaylists } from "@/lib/queries";
import { playTracks } from "@/player/controls";
import { MOODS, startRadio } from "@/player/radio";
import { selectTrack, usePlayer } from "@/player/store";

const MIX_CONTEXT = { type: "queue" as const, id: "mix:weather", name: "Weather mix" };

function WeatherMixSection() {
  const q = useWeatherMix();
  if (q.isLoading) return <Loading />;
  if (q.error) return <Empty>{q.error instanceof ApiError && q.error.status === 404 ? "No city" : "Weather mix unavailable"}</Empty>;
  const m = q.data!;
  const day = m.weather.is_day;
  return (
    <section className="grid grid-cols-1 gap-5">
      <div className="grid gap-5 rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel p-4 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-center sm:p-5">
        <div className="relative size-44 justify-self-center overflow-hidden rounded-[8px] sm:justify-self-start">
          <div className="grid size-full grid-cols-2">
            {m.tracks.slice(0, 4).map((t) => (
              <Artwork key={t.id} src={t.artwork_thumb_url} className="size-full" />
            ))}
          </div>
          <span className="absolute bottom-1.5 end-1.5 grid size-11 place-items-center rounded-[8px] bg-[#0d0f2b]/80">
            <PixelIcon name={day ? "sun" : "moon"} size={28} />
          </span>
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-[28px] font-semibold leading-tight">Weather mix</h2>
          <p className="mt-1 font-bold text-muted">
            {WEATHER_CONDITIONS[m.weather.condition] ?? m.weather.condition} · {Math.round(m.weather.temperature_c)}°C · {m.weather.city}
          </p>
          <p className="mt-0.5 font-bold text-muted">
            {MOOD_LABELS[m.mood]} · {plural(m.tracks.length, "song")}
          </p>
          <Button variant="primary" className="mt-4" onClick={() => playTracks(m.tracks, 0, MIX_CONTEXT)} disabled={!m.tracks.length}>
            <Play className="size-5" /> Play
          </Button>
        </div>
      </div>
      {m.tracks.length ? <TrackList tracks={m.tracks} context={MIX_CONTEXT} /> : <Empty>No songs</Empty>}
    </section>
  );
}

const MOOD_ICONS: Record<string, PixelIconName> = { calm: "moon", upbeat: "sun", melancholy: "notes", late_night: "star" };

function RadioSection() {
  const current = usePlayer(selectTrack);
  const ours = useOurSong().data?.track;
  const tile =
    "flex min-h-[72px] items-center gap-3 rounded-[8px] border-2 border-b-[5px] border-panel-line bg-panel px-3 text-start font-extrabold transition-transform duration-150 hover:-translate-y-0.5";
  return (
    <section>
      <SectionTitle>Radio</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        {ours && (
          <button type="button" className={tile} onClick={() => void startRadio({ type: "track", id: ours.id, name: ours.title })}>
            <Artwork src={ours.artwork_thumb_url} className="size-11 shrink-0 rounded-[5px]" />
            <span className="min-w-0">
              <span className="block">Our song</span>
              <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                {ours.title}
              </span>
            </span>
          </button>
        )}
        {current && (
          <button type="button" className={tile} onClick={() => void startRadio({ type: "track", id: current.id, name: current.title })}>
            <Artwork src={current.artwork_thumb_url} className="size-11 shrink-0 rounded-[5px]" />
            <span className="min-w-0">
              <span className="block">Playing now</span>
              <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                {current.title}
              </span>
            </span>
          </button>
        )}
        {MOODS.map(([mood, label]) => (
          <button key={mood} type="button" className={tile} onClick={() => void startRadio({ type: "mood", mood, name: label })}>
            <PixelIcon name={MOOD_ICONS[mood] ?? "star"} size={34} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function HolidaySection() {
  const config = useRoomConfig().data;
  const playlists = usePlaylists().data;
  const today = new Date();
  const active = (config?.holidays ?? []).filter((h) => h.playlist_id && holidayActive(h, today));
  if (!active.length) return null;
  return (
    <section>
      <SectionTitle>Holiday</SectionTitle>
      <div className="flex flex-wrap gap-2.5">
        {active.map((h) => (
          <Link
            key={h.id}
            href={`/playlist/?id=${h.playlist_id}`}
            className="inline-flex min-h-14 items-center gap-3 rounded-[8px] border-2 border-b-[5px] border-panel-line bg-panel px-4 font-extrabold"
          >
            <PixelIcon name="star" size={28} />
            <span dir="auto">{h.name}</span>
            <span dir="auto" className="text-sm font-semibold text-muted">
              {playlists?.find((p) => p.id === h.playlist_id)?.name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DiscoverHero() {
  const m = useWeatherMix().data;
  const meta = m ? `${m.weather.city} · ${WEATHER_CONDITIONS[m.weather.condition] ?? m.weather.condition} · ${Math.round(m.weather.temperature_c)}°C` : undefined;
  return <PageHero title="Discover" meta={meta} />;
}

export default function DiscoverPage() {
  return (
    <>
      <DiscoverHero />
      <div className="grid grid-cols-1 gap-12">
        <HolidaySection />
        <MixShelf title="Made for you" kinds={MADE_FOR_YOU} />
        <TimeMixShelf kinds={TIME_MIXES} />
        <MixShelf title="Moods" kinds={MOOD_MIXES} />
        <ReleasesShelf />
        <WeatherMixSection />
        <RadioSection />
      </div>
    </>
  );
}
