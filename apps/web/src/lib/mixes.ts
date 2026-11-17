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
