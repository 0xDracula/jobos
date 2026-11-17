"use client";

import { api } from "@/lib/api";
import { keys, queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";

import { playTracks, seek } from "./controls";

export async function playFrom(trackId: string, ms?: number | null, name = "Song") {
  try {
    const t = await queryClient.query({ queryKey: keys.track(trackId), queryFn: () => api.track(trackId), staleTime: 60_000 });
    playTracks([t], 0, { type: "queue", name });
    if (ms && ms > 0) setTimeout(() => seek(ms / 1000), 350);
  } catch {
    toast("Song unavailable");
  }
}
