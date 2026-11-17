"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";

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
};

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
    if (!cur || e.data.version >= cur.version || !e.data.active) queryClient.setQueryData(togetherKey, normalize(e.data));
  });
  on("realtime.open", () => void queryClient.invalidateQueries({ queryKey: togetherKey }));
}
