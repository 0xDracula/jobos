import { create } from "zustand";

import type { Track } from "@/lib/types";

import { spreadShuffle } from "./shuffle";

export type QueueItem = {
  uid: string;
  track: Track;
  user?: boolean;
};

export type PlayContext = {
  type: "playlist" | "album" | "artist" | "likes" | "history" | "search" | "queue";
  id?: string;
  name: string;
};

export type Repeat = "off" | "all" | "one";
export type Panel = "queue" | "lyrics" | "sound" | null;
export type SleepTimer = { mode: "time"; endsAt: number; minutes: number } | { mode: "track" } | { mode: "queue" } | null;

export type PlayerState = {
  queue: QueueItem[];
  baseline: QueueItem[] | null;
  index: number;
  context: PlayContext | null;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  expanded: boolean;
  panel: Panel;
  direction: 1 | -1;
  sleep: SleepTimer;
};

export const INITIAL_PLAYER: PlayerState = {
  queue: [],
  baseline: null,
  index: -1,
  context: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: "off",
  expanded: false,
  panel: null,
  direction: 1,
  sleep: null,
};

export const usePlayer = create<PlayerState>(() => INITIAL_PLAYER);

let counter = 0;
export const newUid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export const selectCurrent = (s: PlayerState): QueueItem | null => (s.index >= 0 ? (s.queue[s.index] ?? null) : null);
export const selectTrack = (s: PlayerState): Track | null => selectCurrent(s)?.track ?? null;

export const playable = (t: Track) => !!(t.audio || t.stream_url);

export const artistKey = (item: QueueItem) =>
  item.track.artist_ids[0] ?? item.track.artists[0]?.toLowerCase() ?? item.track.id;

export function nextIndex(s: Pick<PlayerState, "index" | "queue" | "repeat">): number | null {
  if (s.index < 0 || !s.queue.length) return null;
  if (s.index + 1 < s.queue.length) return s.index + 1;
  return s.repeat === "all" ? 0 : null;
}

export function loadQueue(tracks: Track[], start: number, context: PlayContext, shuffle: boolean): Partial<PlayerState> {
  const items = tracks.map((track) => ({ uid: newUid(), track }));
  const first = items[start] ?? items[0];
  if (!shuffle) return { queue: items, baseline: null, index: items.indexOf(first), context };
  const rest = items.filter((i) => i !== first);
  return { queue: spreadShuffle(rest, artistKey, first), baseline: items, index: 0, context };
}

function afterAdded(queue: QueueItem[], index: number): number {
  let p = index + 1;
  while (p < queue.length && queue[p].user) p++;
  return p;
}

export function insertTracks(s: PlayerState, tracks: Track[], mode: "next" | "last"): Partial<PlayerState> {
  const items = tracks.map((track) => ({ uid: newUid(), track, user: true }));
  if (s.index < 0) return { queue: items, baseline: s.shuffle ? items : null, index: 0, context: { type: "queue", name: "Queue" } };
  const at = (queue: QueueItem[], index: number) => (mode === "next" ? index + 1 : afterAdded(queue, index));
  const pos = at(s.queue, s.index);
  const queue = [...s.queue.slice(0, pos), ...items, ...s.queue.slice(pos)];
  let baseline = s.baseline;
  if (baseline) {
    const b = at(baseline, baseline.indexOf(s.queue[s.index]));
    baseline = [...baseline.slice(0, b), ...items, ...baseline.slice(b)];
  }
  return { queue, baseline };
}

export function removeItem(s: PlayerState, uid: string): Partial<PlayerState> {
  const i = s.queue.findIndex((q) => q.uid === uid);
  if (i < 0) return {};
  const queue = s.queue.filter((q) => q.uid !== uid);
  const baseline = s.baseline?.filter((q) => q.uid !== uid) ?? null;
  if (!queue.length) return { queue, baseline, index: -1, playing: false };
  const index = i < s.index ? s.index - 1 : Math.min(s.index, queue.length - 1);
  return { queue, baseline, index };
}

export function clearUpcoming(s: PlayerState): Partial<PlayerState> {
  if (s.index < 0) return {};
  const queue = s.queue.slice(0, s.index + 1);
  const keep = new Set(queue.map((q) => q.uid));
  return { queue, baseline: s.baseline?.filter((q) => keep.has(q.uid)) ?? null };
}

export function replaceUpcoming(s: PlayerState, run: QueueItem[]): Partial<PlayerState> {
  const start = s.index + 1;
  return { queue: [...s.queue.slice(0, start), ...run, ...s.queue.slice(start + run.length)] };
}

export function toggleShuffle(s: PlayerState, on: boolean): Partial<PlayerState> {
  if (on === s.shuffle) return {};
  const cur = selectCurrent(s);
  if (!cur) return { shuffle: on, baseline: null };
  if (on) {
    const rest = s.queue.filter((q) => q !== cur);
    return { shuffle: true, baseline: s.queue, queue: spreadShuffle(rest, artistKey, cur), index: 0 };
  }
  const queue = s.baseline ?? s.queue;
  return { shuffle: false, baseline: null, queue, index: Math.max(0, queue.indexOf(cur)) };
}
