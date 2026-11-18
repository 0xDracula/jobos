"use client";

import { json, request } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { likedSnapshot } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { playTracks } from "./controls";
import { queueEnd } from "./queueEnd";
import { insertTracks, usePlayer } from "./store";
import { together } from "./togetherHooks";

export type RadioSeed = { type: "track" | "artist" | "playlist" | "mood" | "recent"; id?: string; ids?: string[]; mood?: string; name: string };

export const MOODS: [string, string][] = [
  ["calm", "Calm"],
  ["upbeat", "Upbeat"],
  ["melancholy", "Melancholy"],
  ["late_night", "Late night"],
];

const RADIO_ID = "radio";
const AUTOPLAY_ID = "autoplay";
const isRadio = (id: string | undefined) => id === RADIO_ID || id === AUTOPLAY_ID;
const BATCH = 10;

let session: { seed: RadioSeed; key: string; skipped: Set<string>; fetching: boolean; lastFetch: number; exhausted: boolean } | null = null;

async function batch(exclude: string[], recent: string[]): Promise<Track[]> {
  if (!session) return [];
  const liked = likedSnapshot();
  const r = await request<{ tracks: Track[] }>(
    "/api/radio",
    json("POST", {
      seed: { type: session.seed.type, id: session.seed.id, ids: session.seed.ids, mood: session.seed.mood },
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

export async function startRadio(seed: RadioSeed, opts: { exclude?: string[]; autoplay?: boolean } = {}): Promise<boolean> {
  session = { seed, key: crypto.randomUUID(), skipped: new Set(), fetching: true, lastFetch: Date.now(), exhausted: false };
  const id = opts.autoplay ? AUTOPLAY_ID : RADIO_ID;
  try {
    const exclude = [...(opts.exclude ?? []), ...(seed.type === "track" && seed.id ? [seed.id] : [])];
    const tracks = await batch(exclude, seed.ids ?? []);
    if (!tracks.length) {
      if (!opts.autoplay) toast("Nothing to play");
      return false;
    }
    playTracks(tracks, 0, { type: "queue", id, name: opts.autoplay ? "Autoplay" : `Radio · ${seed.name}` });
    return usePlayer.getState().context?.id === id;
  } catch {
    if (!opts.autoplay) toast("Radio unavailable");
    return false;
  } finally {
    if (session) session.fetching = false;
  }
}

function autoplay() {
  const s = usePlayer.getState();
  if (!usePrefs.getState().autoplay || isRadio(s.context?.id) || !s.queue.length) return;
  const played = s.queue.map((q) => q.track.id);
  void startRadio({ type: "recent", ids: played.slice(-5), name: "Autoplay" }, { exclude: played, autoplay: true });
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
  queueEnd.handler = autoplay;
  usePlayer.subscribe((s, prev) => {
    if (!isRadio(s.context?.id)) {
      if (session && isRadio(prev.context?.id)) session = null;
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
