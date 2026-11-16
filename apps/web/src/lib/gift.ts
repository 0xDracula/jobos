"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import type { CardTrack } from "./social";

export type StarKind = "card" | "dedication" | "mixtape" | "swap" | "note";

export type Star = {
  id: string;
  kind: StarKind;
  track: CardTrack;
  user_id: string;
  at: string;
  note: string | null;
};

export const FAVORITE_CATEGORIES = ["flowers", "food", "drinks", "colors", "places", "films", "artists", "scents"] as const;
export type FavoriteCategory = (typeof FAVORITE_CATEGORIES)[number];
export type FavoriteItems = Partial<Record<FavoriteCategory, string[]>>;
export type FavoriteList = { user_id: string; items: FavoriteItems; updated_at: string | null };

export type UnlockMetric = "hours" | "likes" | "days" | "milestone";

export type Unlockable = {
  id: string;
  label: string;
  metric: UnlockMetric;
  threshold: number;
  milestone?: string;
};

export type Milestone = {
  id: string;
  label: string;
  date: string;
  reached: boolean;
};

export type Holiday = {
  id: string;
  name: string;
  start: string;
  end: string;
  decorations: string[];
  playlist_id: string | null;
};

export type RoomConfig = {
  unlockables: Unlockable[];
  milestones: Milestone[];
  holidays: Holiday[];
  lamp_minutes: number;
};

export type MixtapeSummary = {
  id: string;
  title: string;
  color: string;
  from_user: string;
  to_user: string;
  created_at: string;
  opened_at: string | null;
  track_count: number;
};

export const giftApi = {
  stars: () => request<{ stars: Star[] }>("/api/stars"),
  favorites: () => request<{ lists: FavoriteList[] }>("/api/favorites"),
  setFavorites: (items: FavoriteItems) => request<FavoriteList>("/api/favorites", json("PUT", items)),
  roomConfig: () => request<RoomConfig>("/api/room/config"),
  mixtapes: () => request<{ mixtapes: MixtapeSummary[] }>("/api/mixtapes"),
  setAvatar: (look: Record<string, unknown>) => request<null>("/api/me/avatar", json("PUT", look)),
};

export const giftKeys = {
  stars: ["stars"] as const,
  favorites: ["favorites"] as const,
  roomConfig: ["room", "config"] as const,
  mixtapes: ["mixtapes"] as const,
};

export const useStars = () => useQuery({ queryKey: giftKeys.stars, queryFn: async () => (await giftApi.stars()).stars, staleTime: 5 * 60_000 });

export const useFavoriteLists = () =>
  useQuery({ queryKey: giftKeys.favorites, queryFn: async () => (await giftApi.favorites()).lists, staleTime: 5 * 60_000 });

export const useRoomConfig = () => useQuery({ queryKey: giftKeys.roomConfig, queryFn: giftApi.roomConfig, staleTime: 10 * 60_000 });

export const useMixtapes = () =>
  useQuery({ queryKey: giftKeys.mixtapes, queryFn: async () => (await giftApi.mixtapes()).mixtapes, staleTime: 60_000 });

export const refreshStars = () => void queryClient.invalidateQueries({ queryKey: giftKeys.stars });
