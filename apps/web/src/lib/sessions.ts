"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { Track } from "./types";

export type SessionStatus = "planned" | "live" | "ended";

export type SessionItem = {
  key: string;
  position: number;
  track_id: string;
  added_by: string | null;
  note: string;
  played_at: string | null;
  track?: Track;
};

export type ListeningSession = {
  id: string;
  title: string;
  created_by: string;
  status: SessionStatus;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  current_key: string | null;
  position_ms: number;
  together_ms: number;
  members: string[];
  item_count: number;
  played_count: number;
  covers: string[];
  created_at: string;
  items?: SessionItem[];
};

export const sessionKeys = {
  all: ["sessions"] as const,
  one: (id: string) => ["sessions", id] as const,
};

export const sessionApi = {
  list: async () => (await request<{ sessions: ListeningSession[] }>("/api/sessions")).sessions,
  get: (id: string) => request<ListeningSession>(`/api/sessions/${id}`),
  create: (body: { title: string; scheduled_at: string | null; track_ids?: string[] }) => request<{ id: string }>("/api/sessions", json("POST", body)),
  update: (id: string, body: { title: string; scheduled_at: string | null }) => request<null>(`/api/sessions/${id}`, json("PATCH", body)),
  remove: (id: string) => request<null>(`/api/sessions/${id}`, { method: "DELETE" }),
  add: (id: string, trackIds: string[], opts: { at?: number; next?: boolean } = {}) =>
    request<null>(`/api/sessions/${id}/items`, json("POST", { track_ids: trackIds, ...opts })),
  removeItem: (id: string, key: string) => request<null>(`/api/sessions/${id}/items/${encodeURIComponent(key)}`, { method: "DELETE" }),
  order: (id: string, keys: string[]) => request<null>(`/api/sessions/${id}/items/order`, json("PUT", { keys })),
  note: (id: string, key: string, note: string) => request<null>(`/api/sessions/${id}/items/${encodeURIComponent(key)}`, json("PATCH", { note })),
  start: (id: string) => request<null>(`/api/sessions/${id}/start`, { method: "POST" }),
  end: (id: string) => request<null>(`/api/sessions/${id}/end`, { method: "POST" }),
  copy: (id: string) => request<{ id: string }>(`/api/sessions/${id}/copy`, { method: "POST" }),
  invite: (id: string) => request<null>(`/api/sessions/${id}/invite`, { method: "POST" }),
};

export const useSessions = () => useQuery({ queryKey: sessionKeys.all, queryFn: sessionApi.list, staleTime: 30_000 });

export const useListeningSession = (id: string | null) =>
  useQuery({ queryKey: sessionKeys.one(id ?? ""), queryFn: () => sessionApi.get(id!), enabled: !!id, staleTime: 10_000 });

export function openSessions(list: ListeningSession[] | undefined): ListeningSession[] {
  const time = (s: ListeningSession) => (s.scheduled_at ? Date.parse(s.scheduled_at) : Date.parse(s.created_at));
  return (list ?? []).filter((s) => s.status !== "ended").sort((a, b) => (a.status === "live" ? -1 : b.status === "live" ? 1 : time(a) - time(b)));
}

export const sessionTitle = (s: Pick<ListeningSession, "title">) => s.title || "Listening together";

export function sessionWhen(iso: string | null): string {
  if (!iso) return "Now";
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export type SessionReaction = { session_id: string; from: string; emoji: string };
export const reactionListeners = new Set<(r: SessionReaction) => void>();

let wired = false;

export function startSessionEvents() {
  if (wired) return;
  wired = true;
  on<{ id: string }>("session.update", (e) => {
    void queryClient.invalidateQueries({ queryKey: sessionKeys.all, exact: true });
    void queryClient.invalidateQueries({ queryKey: sessionKeys.one(e.data.id) });
  });
  on<SessionReaction>("session.reaction", (e) => {
    for (const fn of reactionListeners) fn(e.data);
  });
  on("realtime.open", () => void queryClient.invalidateQueries({ queryKey: sessionKeys.all }));
}
