"use client";

import { json, request } from "@/lib/api";
import { likedSnapshot } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { playTracks } from "./controls";
import { insertTracks, usePlayer } from "./store";
import { together } from "./togetherHooks";

export type RadioSeed = { type: "track" | "artist" | "playlist" | "mood"; id?: string; mood?: string; name: string };

export const MOODS: [string, string][] = [
  ["calm", "Calm"],
  ["upbeat", "Upbeat"],
  ["melancholy", "Melancholy"],
  ["late_night", "Late night"],
];

const RADIO_ID = "radio";
const BATCH = 10;

let session: { seed: RadioSeed; key: string; skipped: Set<string>; fetching: boolean; lastFetch: number; exhausted: boolean } | null = null;

async function batch(exclude: string[], recent: string[]): Promise<Track[]> {
  if (!session) return [];
  const liked = likedSnapshot();
  const r = await request<{ tracks: Track[] }>(
    "/api/radio",
    json("POST", {
      seed: { type: session.seed.type, id: session.seed.id, mood: session.seed.mood },
      exclude,
      skipped: [...session.skipped],
      liked: exclude.filter((id) => liked.has(id)),
      recent,
      limit: BATCH,
      session: session.key,
    }),
  );
  return r.tracks;
}

export async function startRadio(seed: RadioSeed): Promise<boolean> {
  session = { seed, key: crypto.randomUUID(), skipped: new Set(), fetching: true, lastFetch: Date.now(), exhausted: false };
  try {
    const tracks = await batch(seed.type === "track" && seed.id ? [seed.id] : [], []);
    if (!tracks.length) {
      toast("Nothing to play");
      return false;
    }
    playTracks(tracks, 0, { type: "queue", id: RADIO_ID, name: `Radio · ${seed.name}` });
    return usePlayer.getState().context?.id === RADIO_ID;
  } catch {
    toast("Radio unavailable");
    return false;
  } finally {
    if (session) session.fetching = false;
  }
}

async function refill() {
  const s = usePlayer.getState();
  if (!session || session.fetching || session.exhausted || Date.now() - session.lastFetch < 5000) return;
  session.fetching = true;
  session.lastFetch = Date.now();
  try {
    const ids = s.queue.map((q) => q.track.id);
    const recent = s.queue.slice(Math.max(0, s.index - 3), s.index + 1).map((q) => q.track.id);
    const more = await batch(ids, recent);
    if (!more.length) {
      session.exhausted = true;
      return;
    }
    if (together.handler) together.handler.addToQueue(more.map((t) => t.id));
    else usePlayer.setState(insertTracks(usePlayer.getState(), more, "last"));
  } catch {
  } finally {
    if (session) session.fetching = false;
  }
}

let wired = false;

export function startRadioWatch() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  usePlayer.subscribe((s, prev) => {
    if (s.context?.id !== RADIO_ID) {
      if (session && prev.context?.id === RADIO_ID) session = null;
      return;
    }
    if (!session) return;
    if (s.index !== prev.index && prev.index >= 0) {
      const left = prev.queue[prev.index];
      if (left && prev.duration && prev.duration - prev.position > 5 && s.index > prev.index) session.skipped.add(left.track.id);
    }
    if (s.queue.length - s.index - 1 <= 3) void refill();
  });
}
