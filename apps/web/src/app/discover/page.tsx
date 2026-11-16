"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Cloud, Moon, Play, Radio, Sun } from "lucide-react";

import { Loading } from "@/components/common";
import { TrackList } from "@/components/tracks";
import { Button, Empty, PageTitle, SectionTitle } from "@/components/ui";
import { ApiError, request } from "@/lib/api";
import { useOurSong } from "@/lib/keepsakes";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { MOODS, startRadio } from "@/player/radio";
import { selectTrack, usePlayer } from "@/player/store";

type WeatherMix = {
  weather: { condition: string; temperature_c: number; is_day: boolean; city: string };
  mood: "mellow" | "upbeat" | "bright" | "soft";
  generated_at: string;
  tracks: Track[];
};

const CONDITIONS: Record<string, string> = {
  clear: "Clear",
  clouds: "Clouds",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
};

const MOOD_LABELS: Record<WeatherMix["mood"], string> = { mellow: "Mellow", upbeat: "Upbeat", bright: "Bright", soft: "Soft" };

function WeatherIcon({ condition, day }: { condition: string; day: boolean }) {
  const cls = "size-9 text-accent-strong";
  switch (condition) {
    case "rain":
      return <CloudRain className={cls} />;
    case "drizzle":
      return <CloudDrizzle className={cls} />;
    case "snow":
      return <CloudSnow className={cls} />;
    case "fog":
      return <CloudFog className={cls} />;
    case "thunderstorm":
      return <CloudLightning className={cls} />;
    case "clouds":
      return <Cloud className={cls} />;
    default:
      return day ? <Sun className={cls} /> : <Moon className={cls} />;
  }
}

function WeatherMixSection() {
  const q = useQuery({
    queryKey: ["mixes", "weather"],
    queryFn: () => request<WeatherMix>("/api/mixes/weather"),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <Empty>{q.error instanceof ApiError && q.error.status === 404 ? "No city" : "Weather mix unavailable"}</Empty>;
  const m = q.data!;
  const context = { type: "queue" as const, id: "weather-mix", name: "Weather mix" };
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-card bg-surface-solid/60 p-4 shadow-soft">
        <WeatherIcon condition={m.weather.condition} day={m.weather.is_day} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">Weather mix</h2>
          <p className="text-sm font-bold text-muted">
            {CONDITIONS[m.weather.condition] ?? m.weather.condition} · {Math.round(m.weather.temperature_c)}°C · {m.weather.city} · {MOOD_LABELS[m.mood]}
          </p>
        </div>
        <Button variant="primary" onClick={() => playTracks(m.tracks, 0, context)} disabled={!m.tracks.length}>
          <Play className="size-5" /> Play
        </Button>
      </div>
      {m.tracks.length ? <TrackList tracks={m.tracks} context={context} /> : <Empty>No songs</Empty>}
    </section>
  );
}

function RadioSection() {
  const current = usePlayer(selectTrack);
  const ours = useOurSong().data?.track;
  return (
    <section>
      <SectionTitle>Radio</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {ours && (
          <Button onClick={() => void startRadio({ type: "track", id: ours.id, name: ours.title })}>
            <Radio className="size-4" /> Our song
          </Button>
        )}
        {current && (
          <Button onClick={() => void startRadio({ type: "track", id: current.id, name: current.title })}>
            <Radio className="size-4" /> <span dir="auto" className="max-w-48 truncate">{current.title}</span>
          </Button>
        )}
        {MOODS.map(([mood, label]) => (
          <Button key={mood} onClick={() => void startRadio({ type: "mood", mood, name: label })}>
            <Radio className="size-4" /> {label}
          </Button>
        ))}
      </div>
    </section>
  );
}

export default function DiscoverPage() {
  return (
    <>
      <PageTitle>Discover</PageTitle>
      <WeatherMixSection />
      <RadioSection />
    </>
  );
}
