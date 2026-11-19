"use client";

import { useQuery } from "@tanstack/react-query";

import { json, request } from "./api";
import { queryClient } from "./queries";
import { on } from "./realtime";
import type { User } from "./types";

export type PairKind = "partner" | "friend";
export type Mode = "solo" | PairKind;
export type Pair = { id: string; kind: PairKind; created_at: string; partner: User | null };
export type LinkInvite = { id: string; link_kind: PairKind; status: "pending" | "declined"; created_at: string; expires_at: string };
type PairState = { pair: Pair | null; invites: LinkInvite[] };

export const pairKey = ["pair"] as const;
const MODE_KEY = "jobbos.mode";

const rememberMode = (mode: Mode) => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
  }
};

const lastMode = (): Mode | null => {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "solo" || m === "partner" || m === "friend" ? m : null;
  } catch {
    return null;
  }
};

export function usePair() {
  return useQuery({
    queryKey: pairKey,
    queryFn: async () => {
      const s = await request<PairState>("/api/pair");
      rememberMode(s.pair?.kind ?? "solo");
      return s;
    },
    staleTime: 60_000,
  });
}

export function useMode(): Mode {
  const data = usePair().data;
  if (data) return data.pair?.kind ?? "solo";
  return lastMode() ?? "partner";
}

export const isLinked = (mode: Mode) => mode !== "solo";

export function afterPairChange() {
  void queryClient.invalidateQueries();
}

export const pairApi = {
  invite: (kind: PairKind) => request<{ invite: LinkInvite; path: string }>("/api/pair/invites", json("POST", { kind })),
  revoke: (id: string) => request<null>(`/api/pair/invites/${id}`, { method: "DELETE" }),
  unlink: (keep: boolean) => request<null>("/api/pair/unlink", json("POST", { keep })),
  setKind: (kind: PairKind) => request<null>("/api/pair", json("PATCH", { kind })),
  link: (token: string) => request<{ pair: Pair | null; friend?: string }>(`/api/invites/${token}/link`, { method: "POST" }),
};

let wired = false;

export function startPair() {
  if (wired) return;
  wired = true;
  on("pair.update", afterPairChange);
}

export function refreshPair() {
  void queryClient.invalidateQueries({ queryKey: pairKey });
}
