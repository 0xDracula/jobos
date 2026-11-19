"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { Track } from "./types";

export function useTracks(ids: string[]): Map<string, Track> {
  const unique = [...new Set(ids)].sort();
  const q = useQuery({
    queryKey: ["tracks-by-id", unique.join(",")],
    queryFn: async () => (await api.tracks(unique)).tracks,
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  return new Map((q.data ?? []).map((t) => [t.id, t]));
}
