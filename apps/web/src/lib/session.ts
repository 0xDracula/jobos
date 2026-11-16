"use client";

import { useQuery } from "@tanstack/react-query";

import { api, ApiError } from "./api";
import { queryClient } from "./queries";

export const PUBLIC_PATHS = ["/login", "/invite", "/reset"];

export const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => (await api.me()).user,
    staleTime: 5 * 60_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });
}

export const useIsAdmin = () => useMe().data?.role === "admin";

export function useMembers() {
  return useQuery({ queryKey: ["members"], queryFn: async () => (await api.members()).users, staleTime: 10 * 60_000 });
}

export async function signOut() {
  try {
    await api.logout();
  } finally {
    queryClient.clear();
    window.location.assign("/login/");
  }
}

export function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !isPublicPath(next) ? next : "/";
}
