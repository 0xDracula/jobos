"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { json, request } from "./api";
import { msUntil, type LetterKind } from "./paper";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { Track } from "./types";

export type { LetterKind } from "./paper";

export type Letter = {
  id: string;
  author_id: string;
  recipient_id: string | null;
  kind: LetterKind;
  occasion: string;
  title: string;
  body: string | null;
  playlist_id: string | null;
  track_id: string | null;
  track?: Track | null;
  unlock_at: string | null;
  unlock_date?: string;
  unlock_time?: string;
  locked: boolean;
  opened_at: string | null;
  status: "draft" | "published";
  placeholder: boolean;
  created_at: string;
  updated_at: string;
};

export type LetterInput = {
  kind: Exclude<LetterKind, "welcome">;
  occasion: string;
  title: string;
  body: string;
  playlist_id: string | null;
  track_id: string | null;
  unlock_date: string;
  unlock_time: string;
  status: "draft" | "published";
};

export type NoteKind = "daily" | "morning" | "night";

export type Note = {
  id: string;
  author_id: string;
  recipient_id: string | null;
  kind: NoteKind;
  body: string;
  track_id: string | null;
  track?: Track | null;
  available_on: string | null;
  opened_at: string | null;
  placeholder: boolean;
  created_at: string;
  updated_at: string;
};

export type NoteInput = { kind: NoteKind; body: string; track_id: string | null };

export type Jar = {
  day: string;
  today: Note | null;
  waiting: boolean;
  left: number;
  opened: Note[];
  next_at: string;
};

export type WindowNote = {
  window: "morning" | "night" | null;
  note: Note | null;
  day?: string;
  ends_at?: string;
  next_at: string;
};

export type PromiseEntry = {
  id: string;
  author_id: string;
  body: string;
  kept_on: string | null;
  placeholder: boolean;
  created_at: string;
  updated_at: string;
};

export type SongPick = { author_id: string; track_id: string; placeholder: boolean; created_at: string; track: Track };

export type SongOfTheDay = {
  author_id: string;
  date: string;
  track_id: string;
  note: string;
  auto: boolean;
  placeholder: boolean;
  created_at?: string;
  updated_at?: string;
  track?: Track | null;
};

export type SongOfTheDayView = {
  date: string;
  today: SongOfTheDay | null;
  history: SongOfTheDay[];
  mine: SongOfTheDay[];
  preview: SongOfTheDay | null;
};

export type HandwritingFont = {
  user_id: string;
  status: "processing" | "ready" | "failed";
  original_name: string;
  url: string | null;
  family: string | null;
  glyphs: number | null;
  bytes: number | null;
  error: string | null;
  updated_at: string;
};

export type Welcome = { letter: Letter | null; seen: boolean; song: Track | null };

export type AdminLetters = {
  welcome: Letter | null;
  daily_left: { author_id: string; left: number; placeholders: number }[];
  fonts: HandwritingFont[];
  placeholders: Record<string, number>;
};

export const lettersApi = {
  letters: () => request<{ letters: Letter[]; time_zone: string }>("/api/letters"),
  letter: (id: string) => request<Letter>(`/api/letters/${id}`),
  createLetter: (l: LetterInput) => request<Letter>("/api/letters", json("POST", l)),
  updateLetter: (id: string, l: LetterInput) => request<Letter>(`/api/letters/${id}`, json("PUT", l)),
  deleteLetter: (id: string) => request<null>(`/api/letters/${id}`, { method: "DELETE" }),
  openLetter: (id: string) => request<null>(`/api/letters/${id}/open`, { method: "POST" }),
  welcome: () => request<Welcome>("/api/welcome"),
  welcomeSeen: () => request<null>("/api/welcome/seen", { method: "POST" }),

  jar: () => request<Jar>("/api/jar"),
  openJar: () => request<Note>("/api/jar/open", { method: "POST" }),
  windowNote: () => request<WindowNote>("/api/notes/now"),
  notesWritten: () => request<{ notes: Note[] }>("/api/notes/written"),
  addNote: (n: NoteInput) => request<Note>("/api/notes", json("POST", n)),
  editNote: (id: string, n: NoteInput) => request<Note>(`/api/notes/${id}`, json("PUT", n)),
  removeNote: (id: string) => request<null>(`/api/notes/${id}`, { method: "DELETE" }),

  promises: () => request<{ promises: PromiseEntry[] }>("/api/promises"),
  createPromise: (body: string, keptOn: string | null) => request<PromiseEntry>("/api/promises", json("POST", { body, kept_on: keptOn })),
  updatePromise: (id: string, body: string, keptOn: string | null) => request<PromiseEntry>(`/api/promises/${id}`, json("PUT", { body, kept_on: keptOn })),
  deletePromise: (id: string) => request<null>(`/api/promises/${id}`, { method: "DELETE" }),

  picks: () => request<{ mine: SongPick[]; for_me: SongPick[] }>("/api/picks"),
  pick: (trackId: string, on: boolean) => request<null>(`/api/picks/${trackId}`, { method: on ? "PUT" : "DELETE" }),
  songOfTheDay: () => request<SongOfTheDayView>("/api/song-of-the-day"),
  setSongOfTheDay: (trackId: string, note: string, date?: string) =>
    request<null>("/api/song-of-the-day", json("PUT", { track_id: trackId, note, date: date ?? "" })),
  deleteSongOfTheDay: (date: string) => request<null>(`/api/song-of-the-day/${date}`, { method: "DELETE" }),

  fonts: () => request<{ fonts: HandwritingFont[] }>("/api/fonts"),
  adminLetters: () => request<AdminLetters>("/api/admin/letters"),
  setWelcome: (title: string, body: string) => request<Letter>("/api/admin/welcome", json("PUT", { title, body })),
  uploadFont: (userId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<HandwritingFont>(`/api/admin/fonts/${userId}`, { method: "POST", body: form });
  },
  deleteFont: (userId: string) => request<null>(`/api/admin/fonts/${userId}`, { method: "DELETE" }),
};

export const lettersKeys = {
  letters: ["letters"] as const,
  letter: (id: string) => ["letters", id] as const,
  welcome: ["welcome"] as const,
  jar: ["jar"] as const,
  windowNote: ["letter-notes", "now"] as const,
  written: ["letter-notes", "written"] as const,
  promises: ["promises"] as const,
  picks: ["picks"] as const,
  songOfTheDay: ["song-of-the-day"] as const,
  fonts: ["fonts"] as const,
  admin: ["admin", "letters"] as const,
};

export const useLetters = () => useQuery({ queryKey: lettersKeys.letters, queryFn: lettersApi.letters, staleTime: 60_000 });

export function useHomeZone(): string {
  const tz = useLetters().data?.time_zone;
  return tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const useLetter = (id: string | null) =>
  useQuery({ queryKey: lettersKeys.letter(id ?? ""), queryFn: () => lettersApi.letter(id!), enabled: !!id, staleTime: 60_000 });

export const useWelcome = (enabled = true) => useQuery({ queryKey: lettersKeys.welcome, queryFn: lettersApi.welcome, enabled, staleTime: 10 * 60_000 });

export const useJar = () => useQuery({ queryKey: lettersKeys.jar, queryFn: lettersApi.jar, staleTime: 60_000 });

export const useWindowNote = () => useQuery({ queryKey: lettersKeys.windowNote, queryFn: lettersApi.windowNote, staleTime: 5 * 60_000 });

export const useWrittenNotes = () =>
  useQuery({ queryKey: lettersKeys.written, queryFn: async () => (await lettersApi.notesWritten()).notes, staleTime: 60_000 });

export const usePromises = () => useQuery({ queryKey: lettersKeys.promises, queryFn: async () => (await lettersApi.promises()).promises, staleTime: 60_000 });

export const usePicks = () => useQuery({ queryKey: lettersKeys.picks, queryFn: lettersApi.picks, staleTime: 60_000 });

export const useSongOfTheDay = () => useQuery({ queryKey: lettersKeys.songOfTheDay, queryFn: lettersApi.songOfTheDay, staleTime: 5 * 60_000 });

export const useHandwritingFonts = () =>
  useQuery({ queryKey: lettersKeys.fonts, queryFn: async () => (await lettersApi.fonts()).fonts, staleTime: 30 * 60_000 });

export const useAdminLetters = () => useQuery({ queryKey: lettersKeys.admin, queryFn: lettersApi.adminLetters });

export function useRefetchAt(iso: string | null | undefined, queryKey: readonly unknown[]) {
  const key = JSON.stringify(queryKey);
  useEffect(() => {
    const ms = msUntil(iso);
    if (ms == null) return;
    const t = setTimeout(() => void queryClient.invalidateQueries({ queryKey: JSON.parse(key) }), ms + 500);
    return () => clearTimeout(t);
  }, [iso, key]);
}

export const refreshLetters = (...lists: (keyof typeof LIST_KEYS)[]) => {
  for (const l of lists) for (const key of LIST_KEYS[l]) void queryClient.invalidateQueries({ queryKey: key });
};

const LIST_KEYS = {
  letters: [lettersKeys.letters, lettersKeys.welcome, lettersKeys.admin],
  welcome: [lettersKeys.welcome, lettersKeys.admin],
  jar: [lettersKeys.jar, lettersKeys.admin],
  notes: [lettersKeys.written, lettersKeys.windowNote, lettersKeys.admin],
  promises: [lettersKeys.promises],
  picks: [lettersKeys.picks],
  "song-of-the-day": [lettersKeys.songOfTheDay],
  fonts: [lettersKeys.fonts, lettersKeys.admin],
} satisfies Record<string, readonly (readonly unknown[])[]>;

let wired = false;

export function startLetters() {
  if (wired) return;
  wired = true;
  on<{ lists: string[] }>("letters.update", (e) => {
    for (const l of e.data?.lists ?? []) if (l in LIST_KEYS) refreshLetters(l as keyof typeof LIST_KEYS);
  });
}
