"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import type { MixtapeSummary } from "./gift";
import { queryClient } from "./queries";
import type { Track } from "./types";

export type CardLine = { text: string; ms: number | null };

export type SongNote = {
  id: string;
  author_id: string;
  track_id: string;
  line_index: number | null;
  line_text: string | null;
  line_ms: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  track?: Track | null;
};

export type SongNoteInput = { body: string; line_index?: number | null; line_text?: string | null; line_ms?: number | null };

export type Clipping = { id: string; user_id: string; track_id: string; lines: CardLine[]; created_at: string; track?: Track | null };

export type VoiceClip = {
  id: string;
  author_id: string;
  status: "processing" | "ready" | "failed";
  url: string | null;
  duration_ms: number | null;
  created_at: string;
};

export type Dedication = { id: string; author_id: string; track_id: string; note: string; created_at: string; clip: VoiceClip; track?: Track | null };

export type MixtapeTrack = { position: number; side: "A" | "B"; note: string; track: Track | null };
export type Mixtape = MixtapeSummary & { note: string; intro: VoiceClip | null; tracks: MixtapeTrack[] };
export type MixtapeInput = {
  title: string;
  color: string;
  note: string;
  intro_clip_id: string | null;
  tracks: { track_id: string; side: "A" | "B"; note: string }[];
};

export const keepsakeApi = {
  trackNotes: (trackId: string) => request<{ notes: SongNote[] }>(`/api/tracks/${trackId}/notes`),
  allNotes: () => request<{ notes: SongNote[] }>("/api/song-notes"),
  createNote: (trackId: string, n: SongNoteInput) => request<SongNote>(`/api/tracks/${trackId}/notes`, json("POST", n)),
  updateNote: (id: string, body: string) => request<SongNote>(`/api/song-notes/${id}`, json("PATCH", { body })),
  deleteNote: (id: string) => request<null>(`/api/song-notes/${id}`, { method: "DELETE" }),

  scrapbook: () => request<{ clippings: Clipping[] }>("/api/scrapbook"),
  addClipping: (trackId: string, lines: CardLine[]) => request<Clipping>("/api/scrapbook", json("POST", { track_id: trackId, lines })),
  deleteClipping: (id: string) => request<null>(`/api/scrapbook/${id}`, { method: "DELETE" }),

  uploadClip: (file: Blob, name: string, conversationId?: string) => {
    const form = new FormData();
    form.append("file", file, name);
    if (conversationId) form.append("conversation_id", conversationId);
    return request<VoiceClip>("/api/clips", { method: "POST", body: form });
  },
  clip: (id: string) => request<VoiceClip>(`/api/clips/${id}`),
  trackDedications: (trackId: string) => request<{ dedications: Dedication[] }>(`/api/tracks/${trackId}/dedications`),
  dedications: () => request<{ dedications: Dedication[] }>("/api/dedications"),
  dedicatedIds: () => request<{ ids: string[] }>("/api/dedications/ids"),
  createDedication: (trackId: string, clipId: string, note: string) =>
    request<Dedication>(`/api/tracks/${trackId}/dedications`, json("POST", { clip_id: clipId, note })),
  deleteDedication: (id: string) => request<null>(`/api/dedications/${id}`, { method: "DELETE" }),

  mixtape: (id: string) => request<Mixtape>(`/api/mixtapes/${id}`),
  createMixtape: (m: MixtapeInput) => request<Mixtape>("/api/mixtapes", json("POST", m)),
  updateMixtape: (id: string, m: MixtapeInput) => request<Mixtape>(`/api/mixtapes/${id}`, json("PUT", m)),
  sendMixtape: (id: string) => request<MixtapeSummary>(`/api/mixtapes/${id}/send`, { method: "POST" }),
  openMixtape: (id: string) => request<null>(`/api/mixtapes/${id}/open`, { method: "POST" }),
  deleteMixtape: (id: string) => request<null>(`/api/mixtapes/${id}`, { method: "DELETE" }),

  recentSearches: () => request<{ searches: string[] }>("/api/searches/recent"),
  addRecentSearch: (query: string) => request<null>("/api/searches/recent", json("POST", { query })),
  deleteRecentSearch: (query?: string) =>
    request<null>(`/api/searches/recent${query ? `?q=${encodeURIComponent(query)}` : ""}`, { method: "DELETE" }),
};

export const keepsakeKeys = {
  notes: ["song-notes"] as const,
  trackNotes: (id: string) => ["song-notes", id] as const,
  scrapbook: ["scrapbook"] as const,
  dedications: ["dedications"] as const,
  dedicatedIds: ["dedications", "ids"] as const,
  trackDedications: (id: string) => ["dedications", "track", id] as const,
  mixtape: (id: string) => ["mixtapes", id] as const,
  recentSearches: ["searches", "recent"] as const,
};

export const useTrackNotes = (trackId: string | null | undefined) =>
  useQuery({
    queryKey: keepsakeKeys.trackNotes(trackId ?? ""),
    queryFn: async () => (await keepsakeApi.trackNotes(trackId!)).notes,
    enabled: !!trackId,
    staleTime: 60_000,
  });

export const useAllNotes = () => useQuery({ queryKey: keepsakeKeys.notes, queryFn: async () => (await keepsakeApi.allNotes()).notes, staleTime: 60_000 });

export const useScrapbook = () =>
  useQuery({ queryKey: keepsakeKeys.scrapbook, queryFn: async () => (await keepsakeApi.scrapbook()).clippings, staleTime: 60_000 });

export const useDedications = () =>
  useQuery({ queryKey: keepsakeKeys.dedications, queryFn: async () => (await keepsakeApi.dedications()).dedications, staleTime: 60_000 });

export function useDedicatedIds(): ReadonlySet<string> {
  const q = useQuery({
    queryKey: keepsakeKeys.dedicatedIds,
    queryFn: async () => new Set((await keepsakeApi.dedicatedIds()).ids),
    staleTime: 5 * 60_000,
  });
  return q.data ?? EMPTY;
}
const EMPTY: ReadonlySet<string> = new Set();

export const useTrackDedications = (trackId: string | null | undefined) =>
  useQuery({
    queryKey: keepsakeKeys.trackDedications(trackId ?? ""),
    queryFn: async () => (await keepsakeApi.trackDedications(trackId!)).dedications,
    enabled: !!trackId,
    staleTime: 60_000,
  });

export const useMixtape = (id: string | null) =>
  useQuery({ queryKey: keepsakeKeys.mixtape(id ?? ""), queryFn: () => keepsakeApi.mixtape(id!), enabled: !!id });

export const useRecentSearches = () =>
  useQuery({ queryKey: keepsakeKeys.recentSearches, queryFn: async () => (await keepsakeApi.recentSearches()).searches, staleTime: 60_000 });

export const refreshNotes = () => void queryClient.invalidateQueries({ queryKey: keepsakeKeys.notes });

export type OurSong = { track: Track | null; story: string; plays: { user_id: string; plays: number }[] };

export const ourSongKey = ["our-song"] as const;

export const useOurSong = () => useQuery({ queryKey: ourSongKey, queryFn: () => request<OurSong>("/api/our-song"), staleTime: 5 * 60_000 });

export const setOurSong = (trackId: string | null, story: string) =>
  request<OurSong>("/api/admin/our-song", json("PUT", { track_id: trackId, story }));
