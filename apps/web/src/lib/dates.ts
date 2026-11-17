"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { giftKeys, type Star } from "./gift";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { PlayedTrack, Track } from "./types";

export type CalendarEvent = {
  id: string;
  kind: string;
  title: string;
  date: string;
  time?: string;
  surprise?: boolean;
  link?: string;
  author_id?: string;
  placeholder?: boolean;
};

export type CalendarRange = { today: string; from: string; to: string; events: CalendarEvent[] };

export type DateKind = "birthday" | "anniversary" | "countdown" | "plan" | "other";

export type DateItem = {
  id: string;
  kind: DateKind;
  label: string;
  date: string;
  time: string | null;
  note: string;
  recurring: boolean;
  surprise: boolean;
  user_id: string | null;
  author_id: string | null;
  playlist_id: string | null;
  decorations: string[];
  remind_minutes: number | null;
  placeholder: boolean;
  editable: boolean;
};

export type DateInput = Pick<DateItem, "kind" | "label" | "date" | "time" | "note" | "recurring" | "surprise" | "user_id" | "playlist_id" | "decorations" | "remind_minutes">;

export type Countdown = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  days: number;
  surprise: boolean;
  author_id: string | null;
  placeholder: boolean;
  editable: boolean;
};

export const DATE_KINDS: [DateKind, string][] = [
  ["plan", "Plan"],
  ["countdown", "Countdown"],
  ["birthday", "Birthday"],
  ["anniversary", "Anniversary"],
  ["other", "Date"],
];

export const KIND_LABELS: Record<string, string> = {
  ...Object.fromEntries(DATE_KINDS),
  milestone: "Milestone",
  holiday: "Holiday",
  letter_unlock: "Letter",
  listening_date: "Listening date",
};

export type StatsRange = "week" | "month" | "year" | "all";

export type ListeningTotals = { minutes: number; plays: number; songs: number; days: number };
export type ArtistPlays = { id: string; name: string; image_url: string | null; plays: number };
export type TagWeight = { name: string; weight: number };

export type ListeningStats = {
  user_id: string;
  range?: StatsRange;
  from: string | null;
  totals: ListeningTotals;
  top_songs: PlayedTrack[];
  top_artists: ArtistPlays[];
  top_genres: TagWeight[];
  hours: number[];
  top_hour: number;
  streaks: { current: number; longest: number };
};

export type Exchanged = { total: number; by_kind: Record<string, number>; recent: Star[] };

export type TogetherStats = {
  members: string[];
  minutes_together: number;
  both_liked: number;
  both_liked_tracks: Track[];
  taste_match: number | null;
  our_song: { track: Track | null; plays: { user_id: string; plays: number }[] };
  exchanged: Exchanged;
};

export type RecapPeriod = "month" | "year";

export type RecapEntry = { period: RecapPeriod; starts_on: string; ends_on: string; released_on: string; opened: boolean };

export type RecapList = { months: RecapEntry[]; years: RecapEntry[]; latest: RecapEntry | null; next_month: string; next_year: string | null };

export type RecapHighlight = {
  title: string;
  caption?: string;
  date?: string;
  photo_url?: string;
  track_id?: string;
  link?: string;
  placeholder?: boolean;
};

export type SourcedFigure = { source: string; key: string; label: string; value: number; detail?: unknown };

export type RecapNoteView = { author_id: string; body: string; placeholder: boolean };

export type SharedTrack = Track & { plays: Record<string, number> };

export type Slide =
  | { kind: "cover"; data: { name: string } }
  | { kind: "listening"; data: { totals: ListeningTotals; longest_streak: number; top_hour: number; hours: number[] } }
  | { kind: "top_songs"; data: { tracks: PlayedTrack[] } }
  | { kind: "top_artists"; data: { artists: ArtistPlays[]; genres: TagWeight[] } }
  | { kind: "together"; data: TogetherStats }
  | { kind: "together_minutes"; data: { minutes: number; taste_match: number | null } }
  | { kind: "shared_songs"; data: { tracks: SharedTrack[] } }
  | { kind: "exchanged"; data: Exchanged }
  | { kind: "highlight"; data: SourcedFigure }
  | { kind: "figures"; data: { figures: SourcedFigure[] } }
  | { kind: "note"; data: RecapNoteView }
  | { kind: "notes"; data: { notes: RecapNoteView[] } };

export type Recap = {
  period: RecapPeriod;
  starts_on: string;
  ends_on: string;
  subject: string;
  preview: boolean;
  hidden: string[];
  slides: Slide[];
};

export type RecapNote = { id: string; author_id: string; period: RecapPeriod; starts_on: string; body: string; placeholder: boolean; updated_at: string };
export type NoteSlot = { period: RecapPeriod; starts_on: string; ends_on: string; released_on: string };

export const datesApi = {
  calendar: (from: string, to: string) => request<CalendarRange>(`/api/calendar?from=${from}&to=${to}`),
  dates: () => request<{ dates: DateItem[] }>("/api/dates"),
  createDate: (d: DateInput) => request<DateItem>("/api/dates", json("POST", d)),
  updateDate: (id: string, d: DateInput) => request<DateItem>(`/api/dates/${id}`, json("PUT", d)),
  deleteDate: (id: string) => request<null>(`/api/dates/${id}`, { method: "DELETE" }),
  countdowns: () => request<{ today: string; countdowns: Countdown[] }>("/api/countdowns"),
  stats: (range: StatsRange, user?: string) => request<ListeningStats>(`/api/stats?range=${range}${user ? `&user=${user}` : ""}`),
  together: () => request<TogetherStats>("/api/stats/together"),
  recaps: () => request<RecapList>("/api/recaps"),
  recap: (period: RecapPeriod, start: string, forUser?: string) =>
    request<Recap>(`/api/recaps/${period}?start=${start}${forUser ? `&for=${forUser}` : ""}`),
  preview: (period: RecapPeriod, forUser?: string) => request<Recap>(`/api/admin/recaps/${period}/current${forUser ? `?for=${forUser}` : ""}`),
  opened: (period: RecapPeriod, start: string) => request<null>(`/api/recaps/${period}/opened`, json("POST", { starts_on: start })),
  notes: () => request<{ notes: RecapNote[]; slots: NoteSlot[] }>("/api/recaps/notes"),
  setNote: (period: RecapPeriod, start: string, body: string) => request<{ note: RecapNote | null }>("/api/recaps/notes", json("PUT", { period, starts_on: start, body })),
};

export const datesKeys = {
  calendar: (from: string, to: string) => ["calendar", from, to] as const,
  dates: ["dates"] as const,
  countdowns: ["countdowns"] as const,
  stats: (range: StatsRange, user?: string) => ["stats", range, user ?? "me"] as const,
  together: ["stats", "together"] as const,
  recaps: ["recaps"] as const,
  recap: (period: RecapPeriod, start: string, forUser?: string, preview?: boolean) => ["recap", period, start, forUser ?? "me", !!preview] as const,
  notes: ["recaps", "notes"] as const,
};

let wired = false;

function startDates() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  on("dates.update", () => {
    for (const key of [["calendar"], datesKeys.dates, datesKeys.countdowns, datesKeys.recaps, ["recap"], giftKeys.roomConfig]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });
}

export function useCalendar(from: string, to: string, enabled = true) {
  startDates();
  return useQuery({
    queryKey: datesKeys.calendar(from, to),
    queryFn: () => datesApi.calendar(from, to),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    enabled,
  });
}

export function useDates() {
  startDates();
  return useQuery({ queryKey: datesKeys.dates, queryFn: async () => (await datesApi.dates()).dates, staleTime: 60_000 });
}

export function useCountdowns() {
  startDates();
  return useQuery({ queryKey: datesKeys.countdowns, queryFn: datesApi.countdowns, staleTime: 5 * 60_000 });
}

export const useStats = (range: StatsRange, user?: string) =>
  useQuery({ queryKey: datesKeys.stats(range, user), queryFn: () => datesApi.stats(range, user), placeholderData: keepPreviousData, retry: false });

export const useTogether = () => useQuery({ queryKey: datesKeys.together, queryFn: datesApi.together, staleTime: 60_000 });

export function useRecaps() {
  startDates();
  return useQuery({ queryKey: datesKeys.recaps, queryFn: datesApi.recaps, staleTime: 5 * 60_000 });
}

export const useRecapNotes = () => useQuery({ queryKey: datesKeys.notes, queryFn: datesApi.notes });

export function refreshDates() {
  for (const key of [["calendar"], datesKeys.dates, datesKeys.countdowns, giftKeys.roomConfig]) void queryClient.invalidateQueries({ queryKey: key });
}
