"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { City } from "@/lib/types";

import { parseLayout, type RoomLayout } from "./layout";

export const roomKeys = {
  location: ["room", "location"] as const,
  locations: ["room", "locations"] as const,
  weather: (lat: number, lon: number) => ["room", "weather", lat.toFixed(2), lon.toFixed(2)] as const,
  stats: ["room", "stats"] as const,
  notes: ["room", "notes"] as const,
  settings: ["settings"] as const,
};

export const useCity = () => useQuery({ queryKey: roomKeys.location, queryFn: api.location, staleTime: 10 * 60_000 });

export function useSetCity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (city: City | null) => (city ? api.setLocation(city) : api.clearLocation()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.location });
      void qc.invalidateQueries({ queryKey: roomKeys.locations });
    },
    onError: () => toast("City not saved"),
  });
}

export function useWeather(city: City | null | undefined) {
  return useQuery({
    queryKey: roomKeys.weather(city?.lat ?? 0, city?.lon ?? 0),
    queryFn: () => api.weather(city!.lat, city!.lon),
    enabled: !!city,
    staleTime: 30 * 60_000,
    refetchInterval: 30 * 60_000,
  });
}

const KM_PER_DEG = 111;

export function useOtherCity(mine: City | null | undefined) {
  const q = useQuery({ queryKey: roomKeys.locations, queryFn: api.locations, staleTime: 10 * 60_000 });
  const other = q.data?.users.find((u) => !u.me && u.city);
  if (!other?.city) return null;
  if (mine) {
    const dist = Math.hypot(mine.lat - other.city.lat, (mine.lon - other.city.lon) * Math.cos((mine.lat * Math.PI) / 180)) * KM_PER_DEG;
    if (dist < 25 || mine.name === other.city.name) return null;
  }
  return { name: other.display_name, city: other.city };
}

export const useRoomStats = () =>
  useQuery({ queryKey: roomKeys.stats, queryFn: api.roomStats, staleTime: 5 * 60_000, refetchInterval: 10 * 60_000 });

export const useHiddenNotes = () =>
  useQuery({ queryKey: roomKeys.notes, queryFn: async () => (await api.hiddenNotes()).notes, staleTime: 5 * 60_000 });

export async function findNote(id: string) {
  const note = await api.findNote(id);
  void queryClient.invalidateQueries({ queryKey: roomKeys.notes });
  return note;
}

const useSettings = () => useQuery({ queryKey: roomKeys.settings, queryFn: async () => (await api.settings()).settings, staleTime: 60_000 });

export function useRoomLayout(): RoomLayout {
  const q = useSettings();
  return parseLayout(q.data?.["room.layout"]);
}

export async function saveRoomLayout(layout: RoomLayout) {
  queryClient.setQueryData<Record<string, unknown>>(roomKeys.settings, (s) => ({ ...s, "room.layout": layout }));
  try {
    await api.setSetting("room.layout", layout);
  } catch {
    toast("Room not saved");
  }
}

export type Favorites = { flower?: string; color?: string; snack?: string; drink?: string };

export function useFavorites(): Favorites {
  const q = useSettings();
  const raw = q.data?.favorites;
  return raw && typeof raw === "object" ? (raw as Favorites) : {};
}

export type AmbientMix = { name: string; levels: Record<string, number> };

export function useAmbientMixes(): AmbientMix[] {
  const q = useSettings();
  const raw = q.data?.["ambient.mixes"];
  return Array.isArray(raw) ? (raw as AmbientMix[]).filter((m) => m && typeof m.name === "string" && m.levels) : [];
}

export async function saveAmbientMixes(mixes: AmbientMix[]) {
  queryClient.setQueryData<Record<string, unknown>>(roomKeys.settings, (s) => ({ ...s, "ambient.mixes": mixes }));
  try {
    await api.setSetting("ambient.mixes", mixes);
  } catch {
    toast("Mix not saved");
  }
}
