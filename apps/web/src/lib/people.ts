"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { PlaylistSummary, Track } from "./types";

export type Relation = {
  following: boolean;
  requested: boolean;
  follows_you: boolean;
  requested_you: boolean;
  friend: boolean;
  partner: boolean;
  self: boolean;
};

export type Person = {
  id: string;
  username: string;
  display_name: string;
  avatar?: unknown;
  private: boolean;
  relation: Relation;
  note?: string;
};

export type NowPlaying = { track_id: string; title: string; artists: string[]; artwork_thumb_url: string | null; position_ms: number; device: string; at: string };

export type Profile = {
  person: Person;
  counts: { followers: number; following: number; friends: number; playlists: number };
  visible: boolean;
  playlists?: PlaylistSummary[];
  mutual?: Person[];
  top?: (Track & { plays: number })[];
  playing?: NowPlaying;
};

export type FriendActivity = {
  person: Person;
  online: boolean | null;
  playing?: NowPlaying;
  last?: { track: Track; at: string };
  jam_id?: string;
};

export type JamSummary = { id: string; host: Person; members: string[]; track: Track | null; playing: boolean; joined: boolean };

export type Privacy = {
  private: boolean;
  searchable: boolean;
  activity_audience: "followers" | "friends" | "partner" | "none";
  messages_from: "friends" | "everyone";
  jam_invites_from: "friends" | "everyone";
  private_session_until: string | null;
};

export const peopleKeys = {
  all: ["people"] as const,
  search: (q: string) => ["people", "search", q] as const,
  suggested: ["people", "suggested"] as const,
  profile: (who: string) => ["people", "profile", who] as const,
  list: (who: string, kind: "followers" | "following") => ["people", kind, who] as const,
  requests: ["people", "requests"] as const,
  friends: ["friends"] as const,
  privacy: ["privacy"] as const,
};

const enc = encodeURIComponent;

export const peopleApi = {
  search: async (q: string) => (await request<{ people: Person[] }>(`/api/people?q=${enc(q)}`)).people,
  suggested: async () => (await request<{ people: Person[] }>("/api/people/suggested")).people,
  profile: (who: string) => request<Profile>(`/api/people/${enc(who)}`),
  list: async (who: string, kind: "followers" | "following") => (await request<{ people: Person[] }>(`/api/people/${enc(who)}/${kind}`)).people,
  follow: (id: string) => request<{ status: "accepted" | "requested" }>(`/api/people/${id}/follow`, { method: "PUT" }),
  unfollow: (id: string) => request<null>(`/api/people/${id}/follow`, { method: "DELETE" }),
  removeFollower: (id: string) => request<null>(`/api/people/${id}/follower`, { method: "DELETE" }),
  accept: (id: string) => request<null>(`/api/people/${id}/accept`, { method: "POST" }),
  requests: async () => (await request<{ people: Person[] }>("/api/follow-requests")).people,
  friends: () => request<{ friends: FriendActivity[]; jams: JamSummary[] }>("/api/friends"),
  privacy: () => request<Privacy>("/api/privacy"),
  setPrivacy: (p: Partial<Privacy> & { private_session_hours?: number }) => request<Privacy>("/api/privacy", json("PUT", p)),
  playlistVisibility: (id: string, visibility: PlaylistVisibility) => request<null>(`/api/playlists/${id}/visibility`, json("PUT", { visibility })),
};

export type PlaylistVisibility = "public" | "friends" | "partner" | "private";
export const VISIBILITY_LABELS: Record<PlaylistVisibility, string> = { public: "Public", friends: "Friends", partner: "Partner", private: "Only you" };

export const usePeopleSearch = (q: string) =>
  useQuery({ queryKey: peopleKeys.search(q), queryFn: () => peopleApi.search(q), enabled: q.trim().length >= 1, staleTime: 30_000 });
export const useSuggested = () => useQuery({ queryKey: peopleKeys.suggested, queryFn: peopleApi.suggested, staleTime: 5 * 60_000 });
export const usePersonProfile = (who: string | null) =>
  useQuery({ queryKey: peopleKeys.profile(who ?? ""), queryFn: () => peopleApi.profile(who!), enabled: !!who, staleTime: 30_000 });
export const useFollowList = (who: string | null, kind: "followers" | "following") =>
  useQuery({ queryKey: peopleKeys.list(who ?? "", kind), queryFn: () => peopleApi.list(who!, kind), enabled: !!who, staleTime: 30_000 });
export const useFollowRequests = () => useQuery({ queryKey: peopleKeys.requests, queryFn: peopleApi.requests, staleTime: 60_000 });
export const useFriends = () => useQuery({ queryKey: peopleKeys.friends, queryFn: peopleApi.friends, staleTime: 30_000, refetchInterval: 60_000 });
export const usePrivacy = () => useQuery({ queryKey: peopleKeys.privacy, queryFn: peopleApi.privacy, staleTime: 60_000 });

export function afterFollowChange() {
  void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
  void queryClient.invalidateQueries({ queryKey: peopleKeys.friends });
  void queryClient.invalidateQueries({ queryKey: ["conversations"] });
}

export function followLabel(r: Relation): string {
  if (r.following) return r.friend ? "Friends" : "Following";
  if (r.requested) return "Requested";
  return r.follows_you ? "Follow back" : "Follow";
}

export function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "Now";
  if (mins < 60) return `${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h`;
  return h < 48 ? "Yesterday" : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

let wired = false;

export function startPeople() {
  if (wired) return;
  wired = true;
  on("people.update", afterFollowChange);
  on("activity.update", () => void queryClient.invalidateQueries({ queryKey: peopleKeys.friends }));
  on("realtime.open", () => void queryClient.invalidateQueries({ queryKey: peopleKeys.friends }));
}
