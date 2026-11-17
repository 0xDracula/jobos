import { useQuery } from "@tanstack/react-query";

import { request } from "./api";

export type PlaceholderSet = { name: string; label: string; left: number; admin: string };

export const placeholderKeys = { sets: ["admin", "placeholders"] as const };

export const usePlaceholders = () =>
  useQuery({ queryKey: placeholderKeys.sets, queryFn: async () => (await request<{ sets: PlaceholderSet[] }>("/api/admin/placeholders")).sets });
