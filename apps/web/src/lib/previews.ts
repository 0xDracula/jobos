"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import type { Track } from "./types";

export type Highlight = {
  start_ms: number;
  source: "replayed" | "chorus";
  heat?: number[];
};

export type PreviewMode = "you" | "friends";
export type PreviewReaction = "like" | "skip" | "add" | "send" | "full";

export type Preview = {
  track: Track;
  mode: PreviewMode;
  reason: string;
  from_user: string | null;
  highlight: Highlight | null;
  seen: boolean;
  reaction: PreviewReaction | null;
};

export const CLIP_MS = 30_000;

export const previewKeys = {
  feed: (mode: PreviewMode) => ["previews", mode] as const,
  highlight: (id: string) => ["highlight", id] as const,
};

export const previewApi = {
  feed: (mode: PreviewMode) => request<{ previews: Preview[]; growing: boolean }>(`/api/previews?mode=${mode}`),
  react: (trackId: string, reaction: PreviewReaction | "") => request<null>(`/api/previews/${trackId}/react`, json("POST", { reaction })),
  highlight: async (trackId: string) => (await request<{ highlight: Highlight | null }>(`/api/tracks/${trackId}/highlight`)).highlight,
};

export const usePreviews = (mode: PreviewMode) =>
  useQuery({
    queryKey: previewKeys.feed(mode),
    queryFn: () => previewApi.feed(mode),
    staleTime: 5 * 60_000,
    refetchInterval: (q) => (q.state.data?.growing && (q.state.data.previews.length ?? 0) < 4 ? 8_000 : false),
  });

export function previewStart(track: Pick<Track, "duration_ms">, h: Highlight | null | undefined): number {
  if (h) return h.start_ms;
  const d = track.duration_ms ?? 0;
  return d > 90_000 ? Math.round(d / 3) : 0;
}

export const fetchHighlight = (trackId: string) =>
  queryClient.fetchQuery({ queryKey: previewKeys.highlight(trackId), queryFn: () => previewApi.highlight(trackId), staleTime: 10 * 60_000 });

export function previewBars(h: Highlight | null | undefined, steps = 50): number[] {
  if (h?.heat && h.heat.length) {
    const out: number[] = [];
    for (let i = 0; i < steps; i++) out.push(h.heat[Math.min(h.heat.length - 1, Math.floor((i * h.heat.length) / steps))]);
    return out;
  }
  return Array(steps).fill(0.12);
}

export function previewLabel(h: Highlight | null | undefined, startMs: number): string {
  const s = Math.round(startMs / 1000);
  const at = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (!h) return `From ${at}`;
  return `${h.source === "replayed" ? "Most replayed" : "Chorus"} · ${at}`;
}
