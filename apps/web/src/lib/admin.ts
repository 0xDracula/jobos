"use client";

import { json, request } from "./api";
import type { Holiday, Milestone, Unlockable } from "./gift";
import type { Lyrics, Track } from "./types";

export type SourceHealth = { source: string; last_ok_at: string | null; last_error_at: string | null; last_error: string | null };
export type JobCount = { kind: string; status: string; count: number };
export type FailedJob = {
  id: number;
  kind: string;
  track_id: string | null;
  title: string | null;
  attempts: number;
  last_error: string | null;
  finished_at: string | null;
};
export type CacheStats = {
  audio_files: number;
  audio_bytes: number;
  pinned_files: number;
  pinned_bytes: number;
  clearable_files: number;
  clearable_bytes: number;
  image_files: number;
  image_bytes: number;
};
export type LoudFile = { track_id: string; title: string; true_peak_db: number };

export type MediaStatus = {
  yt_dlp?: {
    version: string | null;
    released: string | null;
    latest: string | null;
    update_available: boolean;
    [k: string]: unknown;
  };
  ytmusicapi?: { version: string | null };
  cookies?: { configured: boolean; [k: string]: unknown };
  po_token_provider?: { version: string | null };
  [k: string]: unknown;
};

export type AdminStatus = {
  media: MediaStatus | null;
  workers: Record<string, { last_claim_at: string; downloads_paused_until?: string }>;
  store: {
    sources: SourceHealth[];
    jobs: JobCount[];
    failed: FailedJob[];
    cache: CacheStats;
    loud_files: LoudFile[];
    unmeasured_files: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
};

export type ReviewList = "unchecked" | "review" | "unmatched" | "checked" | "chosen" | "all";
export type ReviewItem = {
  track: Track;
  score: number | null;
  check: "correct" | "wrong" | null;
  checked_at: string | null;
  playlists: string[];
};
export type ReviewCounts = { auto: number; correct: number; wrong: number; review: number; unmatched: number; chosen: number; pending: number };

export type AdminNote = {
  id: string;
  spot: string;
  title: string;
  body: string;
  for_user_id: string | null;
  unlock_at: string | null;
  after_note_id: string | null;
  author_id: string | null;
  created_at: string;
  found_by: number;
};
export type NoteInput = Pick<AdminNote, "spot" | "title" | "body" | "for_user_id" | "unlock_at" | "after_note_id">;

export type AdminRoom = { unlockables: Unlockable[]; milestone_start: string; milestones: Milestone[]; lamp_minutes: number };

export type NowPlaying = { user_id: string; device_name: string; track_id: string; position_ms: number; updated_at: string };

export const adminApi = {
  status: () => request<AdminStatus>("/api/admin/status"),
  retryJob: (id: number) => request<null>(`/api/admin/jobs/${id}/retry`, { method: "POST" }),
  clearCache: () => request<{ files: unknown[]; bytes: number }>("/api/admin/cache/clear", { method: "POST" }),
  syncPlaylists: () => request<unknown>("/api/admin/playlists/sync", { method: "POST" }),
  rematch: (playlistId: string, statuses: string[]) =>
    request<{ queued: number }>(`/api/playlists/${playlistId}/rematch?status=${statuses.join(",")}`, { method: "POST" }),
  visibility: () => request<{ visibility: Record<string, string>; signals: string[] }>("/api/admin/visibility"),
  setVisibility: (modes: Record<string, string>) => request<unknown>("/api/admin/visibility", json("PUT", modes)),
  review: (list: ReviewList, playlist?: string) =>
    request<{ items: ReviewItem[]; counts: ReviewCounts }>(`/api/admin/review?list=${list}${playlist ? `&playlist=${playlist}` : ""}`),
  setCheck: (trackId: string, verdict: "correct" | "wrong" | "") => request<null>(`/api/admin/review/${trackId}`, json("PUT", { verdict })),
  lyrics: (trackId: string) => request<{ lyrics: Lyrics | null; synced_lrc: string }>(`/api/admin/tracks/${trackId}/lyrics`),
  setLyrics: (trackId: string, body: { synced_lrc: string; plain: string; instrumental: boolean }) =>
    request<{ lyrics: Lyrics | null; synced_lrc: string }>(`/api/admin/tracks/${trackId}/lyrics`, json("PUT", body)),
  setLyricsOffset: (trackId: string, offsetMs: number) => request<null>(`/api/tracks/${trackId}/lyrics`, json("PATCH", { offset_ms: offsetMs })),
  notes: () => request<{ notes: AdminNote[] }>("/api/admin/notes"),
  createNote: (n: NoteInput) => request<{ id: string }>("/api/admin/notes", json("POST", n)),
  updateNote: (id: string, n: NoteInput) => request<null>(`/api/admin/notes/${id}`, json("PUT", n)),
  deleteNote: (id: string) => request<null>(`/api/admin/notes/${id}`, { method: "DELETE" }),
  room: () => request<AdminRoom>("/api/admin/room"),
  setRoom: (body: { thresholds?: Record<string, number>; milestone_start?: string; lamp_minutes?: number }) =>
    request<AdminRoom>("/api/admin/room", json("PUT", body)),
  holidays: () => request<{ holidays: Holiday[] }>("/api/admin/holidays"),
  setHolidays: (list: Omit<Holiday, "id">[] | Holiday[]) => request<{ holidays: Holiday[] }>("/api/admin/holidays", json("PUT", list)),
  listening: () => request<{ playing: NowPlaying[]; tracks: Track[] }>("/api/admin/listening"),
};

export const adminKeys = {
  status: ["admin", "status"] as const,
  review: (list: string, playlist: string) => ["admin", "review", list, playlist] as const,
  notes: ["admin", "notes"] as const,
  room: ["admin", "room"] as const,
  holidays: ["admin", "holidays"] as const,
  visibility: ["admin", "visibility"] as const,
  accounts: ["admin", "accounts"] as const,
  invites: ["admin", "invites"] as const,
  listening: ["admin", "listening"] as const,
};
