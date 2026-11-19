"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import type { Person } from "./people";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { ListeningSession } from "./sessions";
import { toast } from "./toast";

export type TogetherQueueItem = { track_id: string; added_by: string; key: string };

export type TogetherState = {
  active: boolean;
  session_id: string;
  title: string;
  finished: boolean;
  members: string[];
  queue: TogetherQueueItem[];
  index: number;
  playing: boolean;
  started_at_server_ms: number;
  position_at_start_ms: number;
  apply_at_server_ms: number;
  version: number;
  started_by: string;
  jam?: boolean;
  host?: string;
  anyone_add?: boolean;
  anyone_skip?: boolean;
};

export type JamDetail = { jam: ListeningSession; room: TogetherState; people: Person[]; link_token?: string };

export type JamOptions = { invite?: string[]; conversation_id?: string; friends_join?: boolean; anyone_add?: boolean; anyone_skip?: boolean };

export const jamApi = {
  start: (body: JamOptions & { track_ids: string[]; position_ms?: number }) => request<{ id: string }>("/api/jams", json("POST", body)),
  get: (id: string) => request<JamDetail>(`/api/jams/${id}`),
  update: (id: string, body: Pick<JamOptions, "friends_join" | "anyone_add" | "anyone_skip">) => request<null>(`/api/jams/${id}`, json("PATCH", body)),
  invite: (id: string, body: { user_ids?: string[]; conversation_id?: string }) => request<null>(`/api/jams/${id}/invite`, json("POST", body)),
  end: (id: string) => request<null>(`/api/jams/${id}/end`, { method: "POST" }),
  joinLink: (token: string) => request<{ id: string }>(`/api/jams/link/${encodeURIComponent(token)}`, { method: "POST" }),
};

export const jamKey = (id: string) => ["jam", id] as const;
export const useJam = (id: string | null) =>
  useQuery({ queryKey: jamKey(id ?? ""), queryFn: () => jamApi.get(id!), enabled: !!id, staleTime: 10_000 });

export const jamLink = (token: string) => `${typeof location === "undefined" ? "" : location.origin}/jam/?t=${encodeURIComponent(token)}`;

export const togetherKey = ["together"] as const;

const normalize = (s: TogetherState): TogetherState => ({ ...s, members: s.members ?? [], queue: s.queue ?? [] });

export const fetchTogether = async () => normalize((await request<{ room: TogetherState; server_ts: number }>("/api/together")).room);

export const useTogether = () => useQuery({ queryKey: togetherKey, queryFn: fetchTogether, staleTime: Infinity });

export function useInSession(meId: string | undefined): boolean {
  const room = useTogether().data;
  return !!(room?.active && meId && room.members.includes(meId));
}

let wired = false;

export function startTogetherState() {
  if (wired) return;
  wired = true;
  on<TogetherState>("room.state", (e) => {
    const cur = queryClient.getQueryData<TogetherState>(togetherKey);
    const sameRoom = !cur?.active || cur.session_id === e.data.session_id;
    if (!cur || (sameRoom && (e.data.version >= cur.version || !e.data.active)) || (!sameRoom && e.data.active && e.data.members.length > 0 && !cur.members.length)) {
      queryClient.setQueryData(togetherKey, normalize(e.data));
    }
    if (e.data.session_id) void queryClient.invalidateQueries({ queryKey: jamKey(e.data.session_id) });
  });
  on<{ action?: string }>("room.denied", (e) => toast(e.data.action ? "The host controls this" : "This jam is closed to you"));
  on("realtime.open", () => void queryClient.invalidateQueries({ queryKey: togetherKey }));
}
