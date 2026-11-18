"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "./api";
import type { Track } from "./types";

export type WeatherMix = {
  weather: { condition: string; temperature_c: number; is_day: boolean; city: string };
  mood: "mellow" | "upbeat" | "bright" | "soft";
  generated_at: string;
  tracks: Track[];
};

export const WEATHER_CONDITIONS: Record<string, string> = {
  clear: "Clear",
  clouds: "Clouds",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
};

export const MOOD_LABELS: Record<WeatherMix["mood"], string> = { mellow: "Mellow", upbeat: "Upbeat", bright: "Bright", soft: "Soft" };

export const useWeatherMix = () =>
  useQuery({
    queryKey: ["mixes", "weather"],
    queryFn: () => request<WeatherMix>("/api/mixes/weather"),
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
    retry: false,
  });

export type MixReason = { kind: string; label: string };
export type MixTrack = Track & { reason: MixReason; new: boolean };
export type MixSummary = {
  kind: string;
  title: string;
  count: number;
  generated_at: string;
  cover_url: string;
  current?: boolean;
  artists: string[];
};
export type Mix = { kind: string; title: string; generated_at: string; cover_url: string; tracks: MixTrack[] };
export type ReleaseTrack = { title: string; deezer_id: string; artists: string[]; duration_ms: number | null };
export type Release = {
  id: string;
  artist_id: string;
  artist: string;
  title: string;
  kind: string;
  release_date: string;
  artwork_url: string | null;
  tracks: ReleaseTrack[];
};

export const MADE_FOR_YOU = ["daily", "your_song", "rediscover"];
export const TIME_MIXES = ["morning", "afternoon", "evening", "late_night"];
export const MOOD_MIXES = ["happy", "calm", "sad", "energetic"];

export const MOOD_MIX: Record<string, string> = {
  happy: "happy",
  excited: "energetic",
  calm: "calm",
  tired: "calm",
  stressed: "calm",
  sick: "calm",
  sad: "sad",
  missing_you: "your_song",
};

export const mixContext = (kind: string, title: string) => ({ type: "queue" as const, id: `mix:${kind}`, name: title });

export const mixKeys = {
  all: ["mixes", "list"] as const,
  one: (kind: string) => ["mixes", "one", kind] as const,
  similar: (id: string) => ["tracks", id, "similar"] as const,
  releases: ["releases"] as const,
};

export const useMixes = () =>
  useQuery({
    queryKey: mixKeys.all,
    queryFn: async () => (await request<{ mixes: MixSummary[] }>("/api/mixes")).mixes,
    staleTime: 10 * 60_000,
  });

export const useMix = (kind: string | null) =>
  useQuery({
    queryKey: mixKeys.one(kind ?? ""),
    queryFn: () => request<Mix>(`/api/mixes/${kind}`),
    enabled: !!kind,
    staleTime: 10 * 60_000,
    retry: false,
  });

export const useSimilar = (id: string | null) =>
  useQuery({
    queryKey: mixKeys.similar(id ?? ""),
    queryFn: async () => (await request<{ tracks: Track[] }>(`/api/tracks/${id}/similar`)).tracks,
    enabled: !!id,
    staleTime: 30 * 60_000,
  });

export const useReleases = () =>
  useQuery({
    queryKey: mixKeys.releases,
    queryFn: async () => (await request<{ releases: Release[] }>("/api/releases")).releases,
    staleTime: 30 * 60_000,
  });

export const releaseTracks = async (id: string) =>
  (await request<{ tracks: Track[] }>(`/api/releases/${id}/tracks`, { method: "POST" })).tracks;

const UPDATED = new Intl.RelativeTimeFormat([], { numeric: "auto" });

export function updatedLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days <= 1) return `${UPDATED.format(-days, "day").replace(/^./, (c) => c.toUpperCase())}, ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
