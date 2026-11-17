"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { json, request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { Track } from "./types";

export type Photo = {
  id: string;
  album_id: string | null;
  status: "processing" | "ready" | "failed";
  url: string | null;
  thumb_url: string | null;
  original_url: string | null;
  width: number | null;
  height: number | null;
  color: string | null;
  caption: string;
  taken_on: string | null;
  uploaded_by: string;
  placeholder: boolean;
  created_at: string;
};

export type PhotoAlbum = {
  id: string;
  name: string;
  description: string;
  cover_photo_id: string | null;
  track_id: string | null;
  created_by: string;
  placeholder: boolean;
  created_at: string;
  updated_at: string;
  photo_count: number;
  cover: Photo | null;
  track: Track | null;
};

export type PhotoAlbumView = PhotoAlbum & { photos: Photo[] };

export type AlbumInput = { name: string; description: string; track_id: string | null; cover_photo_id: string | null };

export type Memory = {
  id: string;
  created_by: string;
  date: string;
  title: string;
  caption: string;
  photo_id: string | null;
  track_id: string | null;
  placeholder: boolean;
  created_at: string;
  updated_at: string;
  photo: Photo | null;
  track: Track | null;
};

export type MemoryInput = { date: string; title: string; caption: string; photo_id: string | null; track_id: string | null };

export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  date: string | null;
  note: string;
  photo_id: string | null;
  track_id: string | null;
  created_by: string;
  placeholder: boolean;
  created_at: string;
  photo: Photo | null;
  track: Track | null;
};

export type PlaceInput = { name: string; lat: number; lon: number; date: string | null; note: string; photo_id: string | null; track_id: string | null };

export type Chapter = {
  id: string;
  position: number;
  title: string;
  date_from: string | null;
  date_to: string | null;
  body: string;
  track_id: string | null;
  created_by: string;
  placeholder: boolean;
  created_at: string;
  updated_at: string;
  photos: Photo[];
  track: Track | null;
};

export type ChapterInput = {
  title: string;
  date_from: string | null;
  date_to: string | null;
  body: string;
  track_id: string | null;
  photo_ids: string[];
};

export type CollectionItem = {
  id: string;
  user_id: string;
  track_id: string;
  reason: string;
  placeholder: boolean;
  created_at: string;
  track: Track | null;
};

export type GlossaryKind = "joke" | "nickname";

export type GlossaryEntry = {
  id: string;
  kind: GlossaryKind;
  term: string;
  body: string;
  started_on: string | null;
  photo_id: string | null;
  track_id: string | null;
  created_by: string;
  placeholder: boolean;
  created_at: string;
  photo: Photo | null;
  track: Track | null;
};

export type GlossaryInput = {
  kind: GlossaryKind;
  term: string;
  body: string;
  started_on: string | null;
  photo_id: string | null;
  track_id: string | null;
};

export type MomentKind = "our_song" | "chapter" | "memory" | "place" | "dedication";

export type Moment = { kind: MomentKind; id?: string; label: string; date: string | null; user_id?: string };

export type SoundtrackItem = { track: Track; moments: Moment[] };

export type MapInfo = { tiles: boolean; bytes: number; updated_at: string | null; build?: string };

export type TableCount = { total: number; placeholders: number };

export type MemoriesSummary = { counts: Record<string, TableCount>; map: MapInfo };

export const memoriesApi = {
  uploadPhoto: (file: File, opts: { albumId?: string | null; caption?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (opts.albumId) form.append("album_id", opts.albumId);
    if (opts.caption) form.append("caption", opts.caption);
    return request<Photo>("/api/photos", { method: "POST", body: form });
  },
  photo: (id: string) => request<Photo>(`/api/photos/${id}`),
  updatePhoto: (id: string, body: { caption: string; taken_on: string | null }) => request<Photo>(`/api/photos/${id}`, json("PUT", body)),
  deletePhoto: (id: string) => request<null>(`/api/photos/${id}`, { method: "DELETE" }),

  albums: () => request<{ albums: PhotoAlbum[] }>("/api/photo-albums"),
  album: (id: string) => request<PhotoAlbumView>(`/api/photo-albums/${id}`),
  createAlbum: (input: AlbumInput) => request<PhotoAlbumView>("/api/photo-albums", json("POST", input)),
  updateAlbum: (id: string, input: AlbumInput) => request<PhotoAlbumView>(`/api/photo-albums/${id}`, json("PUT", input)),
  deleteAlbum: (id: string) => request<null>(`/api/photo-albums/${id}`, { method: "DELETE" }),
  reorderPhotos: (id: string, ids: string[]) => request<null>(`/api/photo-albums/${id}/order`, json("PUT", { ids })),

  memories: () => request<{ memories: Memory[] }>("/api/memories"),
  createMemory: (input: MemoryInput) => request<Memory>("/api/memories", json("POST", input)),
  updateMemory: (id: string, input: MemoryInput) => request<Memory>(`/api/memories/${id}`, json("PUT", input)),
  deleteMemory: (id: string) => request<null>(`/api/memories/${id}`, { method: "DELETE" }),

  places: () => request<{ places: Place[] }>("/api/places"),
  createPlace: (input: PlaceInput) => request<{ places: Place[] }>("/api/places", json("POST", input)),
  updatePlace: (id: string, input: PlaceInput) => request<{ places: Place[] }>(`/api/places/${id}`, json("PUT", input)),
  deletePlace: (id: string) => request<null>(`/api/places/${id}`, { method: "DELETE" }),
  map: () => request<MapInfo>("/api/map"),

  chapters: () => request<{ chapters: Chapter[] }>("/api/chapters"),
  createChapter: (input: ChapterInput) => request<{ chapters: Chapter[] }>("/api/chapters", json("POST", input)),
  updateChapter: (id: string, input: ChapterInput) => request<{ chapters: Chapter[] }>(`/api/chapters/${id}`, json("PUT", input)),
  deleteChapter: (id: string) => request<null>(`/api/chapters/${id}`, { method: "DELETE" }),
  reorderChapters: (ids: string[]) => request<{ chapters: Chapter[] }>("/api/chapters/order", json("PUT", { ids })),

  soundtrack: () => request<{ items: SoundtrackItem[] }>("/api/soundtrack"),

  collections: () => request<{ items: CollectionItem[] }>("/api/collections"),
  addToCollection: (trackId: string, reason = "") =>
    request<{ item: CollectionItem; added: boolean }>("/api/collections", json("POST", { track_id: trackId, reason })),
  updateCollectionItem: (id: string, reason: string) => request<null>(`/api/collections/${id}`, json("PUT", { reason })),
  removeFromCollection: (id: string) => request<null>(`/api/collections/${id}`, { method: "DELETE" }),

  glossary: () => request<{ entries: GlossaryEntry[] }>("/api/glossary"),
  createGlossaryEntry: (input: GlossaryInput) => request<{ entries: GlossaryEntry[] }>("/api/glossary", json("POST", input)),
  updateGlossaryEntry: (id: string, input: GlossaryInput) => request<{ entries: GlossaryEntry[] }>(`/api/glossary/${id}`, json("PUT", input)),
  deleteGlossaryEntry: (id: string) => request<null>(`/api/glossary/${id}`, { method: "DELETE" }),

  summary: () => request<MemoriesSummary>("/api/admin/memories/summary"),
};

export const memoryKeys = {
  memories: ["memories"] as const,
  albums: ["photo-albums"] as const,
  album: (id: string) => ["photo-albums", id] as const,
  photo: (id: string) => ["photo", id] as const,
  places: ["places"] as const,
  map: ["map"] as const,
  chapters: ["chapters"] as const,
  soundtrack: ["soundtrack"] as const,
  collections: ["collections"] as const,
  glossary: ["glossary"] as const,
  summary: ["admin", "memories"] as const,
};

export function refreshPhotos() {
  for (const key of [memoryKeys.albums, memoryKeys.memories, memoryKeys.places, memoryKeys.chapters, memoryKeys.glossary]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

let wired = false;

function startMemories() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const keyOf: Record<string, readonly unknown[]> = {
    memories: memoryKeys.memories,
    albums: memoryKeys.albums,
    places: memoryKeys.places,
    chapters: memoryKeys.chapters,
    collections: memoryKeys.collections,
    glossary: memoryKeys.glossary,
    soundtrack: memoryKeys.soundtrack,
  };
  on<{ lists: string[] }>("memories.update", (e) => {
    for (const l of e.data?.lists ?? []) {
      const key = keyOf[l];
      if (key) void queryClient.invalidateQueries({ queryKey: key });
    }
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  });
}

export function useMemoriesLive() {
  useEffect(startMemories, []);
}

const processing = (photos: (Photo | null | undefined)[]) => photos.some((p) => p?.status === "processing");

const whileProcessing =
  <T>(photosOf: (data: T) => (Photo | null | undefined)[]) =>
  (q: { state: { data?: T } }) =>
    q.state.data && processing(photosOf(q.state.data)) ? 2000 : false;

export const useMemories = () =>
  useQuery({
    queryKey: memoryKeys.memories,
    queryFn: async () => (await memoriesApi.memories()).memories,
    staleTime: 60_000,
    refetchInterval: whileProcessing((list: Memory[]) => list.map((m) => m.photo)),
  });

export const usePhotoAlbums = () =>
  useQuery({ queryKey: memoryKeys.albums, queryFn: async () => (await memoriesApi.albums()).albums, staleTime: 60_000 });

export const usePhotoAlbum = (id: string | null) =>
  useQuery({
    queryKey: memoryKeys.album(id ?? ""),
    queryFn: () => memoriesApi.album(id!),
    enabled: !!id,
    staleTime: 30_000,
    refetchInterval: whileProcessing((a: PhotoAlbumView) => a.photos),
  });

export const usePlaces = () =>
  useQuery({
    queryKey: memoryKeys.places,
    queryFn: async () => (await memoriesApi.places()).places,
    staleTime: 60_000,
    refetchInterval: whileProcessing((list: Place[]) => list.map((p) => p.photo)),
  });

export const useMapInfo = () => useQuery({ queryKey: memoryKeys.map, queryFn: memoriesApi.map, staleTime: 5 * 60_000 });

export const useChapters = () =>
  useQuery({
    queryKey: memoryKeys.chapters,
    queryFn: async () => (await memoriesApi.chapters()).chapters,
    staleTime: 60_000,
    refetchInterval: whileProcessing((list: Chapter[]) => list.flatMap((c) => c.photos)),
  });

export const useSoundtrack = () =>
  useQuery({ queryKey: memoryKeys.soundtrack, queryFn: async () => (await memoriesApi.soundtrack()).items, staleTime: 60_000 });

export const useCollections = () =>
  useQuery({ queryKey: memoryKeys.collections, queryFn: async () => (await memoriesApi.collections()).items, staleTime: 60_000 });

export const useGlossary = () =>
  useQuery({
    queryKey: memoryKeys.glossary,
    queryFn: async () => (await memoriesApi.glossary()).entries,
    staleTime: 60_000,
    refetchInterval: whileProcessing((list: GlossaryEntry[]) => list.map((g) => g.photo)),
  });

export const useMemoriesSummary = () => useQuery({ queryKey: memoryKeys.summary, queryFn: memoriesApi.summary, staleTime: 30_000 });

export async function waitForPhoto(id: string, timeoutMs = 120_000): Promise<Photo> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const p = await memoriesApi.photo(id);
    if (p.status === "ready") return p;
    if (p.status === "failed") throw new Error("Photo not processed");
    if (Date.now() > until) throw new Error("Photo still processing");
    await new Promise((r) => setTimeout(r, 1500));
  }
}
