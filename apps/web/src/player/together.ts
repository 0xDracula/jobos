"use client";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { send, serverNow } from "@/lib/realtime";
import { sessionApi } from "@/lib/sessions";
import { fetchTogether, togetherKey, type TogetherState } from "@/lib/together";
import type { Track } from "@/lib/types";

import { getEngine } from "./engine";
import { selectCurrent, usePlayer, type PlayerState, type QueueItem } from "./store";
import { together, type TogetherHandler } from "./togetherHooks";

const CONTEXT = { type: "queue" as const, id: "together", name: "Listening together" };
const DRIFT_MS = 250;

let me = "";
let room: TogetherState | null = null;
let inSession = false;
let applyTimer: ReturnType<typeof setTimeout> | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;
let rate = 1;
const tracks = new Map<string, Track>();

const command = (action: string, data: Record<string, unknown> = {}) => send("room.command", { action, ...data });
const currentKey = () => selectCurrent(usePlayer.getState())?.uid;
const indexOf = (uid: string) => room?.queue.findIndex((q) => q.key === uid) ?? -1;

export async function startFromQueue(): Promise<string | null> {
  const s = usePlayer.getState();
  const ids = s.queue.slice(Math.max(0, s.index)).map((q) => q.track.id);
  if (!ids.length) return null;
  const { id } = await sessionApi.create({ title: "", scheduled_at: null, track_ids: ids.slice(0, 500) });
  await sessionApi.start(id);
  return id;
}
export const react = (emoji: string) => send("room.react", { emoji });
export const joinSession = () => send("room.join");
export const leaveSession = () => send("room.leave");
export const endSession = () => command("end");

export function targetPosition(r: TogetherState, now = serverNow()): number {
  return r.playing ? r.position_at_start_ms + Math.max(0, now - r.started_at_server_ms) : r.position_at_start_ms;
}

const handler: TogetherHandler = {
  play: () => command("play"),
  pause: () => command("pause"),
  seek: (seconds) => command("seek", { position_ms: Math.round(Math.max(0, seconds) * 1000) }),
  next: () => command("skip", { key: currentKey() }),
  previous: () => {
    if (getEngine().currentTime() > 3) command("seek", { position_ms: 0 });
    else command("skip", { index: -1, key: currentKey() });
  },
  jumpTo: (uid) => {
    const i = indexOf(uid);
    if (i >= 0) command("jump", { index: i });
  },
  playTracks: (ids, start) => command("playnow", { track_ids: ids.slice(Math.max(0, start), Math.max(0, start) + 100) }),
  addToQueue: (ids) => command("queue.add", { track_ids: ids }),
  playNext: (ids) => command("queue.add", { track_ids: ids, at: (room?.index ?? 0) + 1 }),
  remove: (uid) => {
    const i = indexOf(uid);
    if (i >= 0) command("queue.remove", { index: i });
  },
  clear: () => command("queue.clear"),
  reorder: (uids) => command("queue.order", { keys: uids }),
};

function setRate(r: number | null) {
  rate = r ?? 1;
  getEngine().setSyncRate(r);
}

function enter() {
  inSession = true;
  together.handler = handler;
  together.queueEnded = () => {
    const key = currentKey();
    if (key && room && room.queue[room.index]?.key === key) command("skip", { key });
  };
  setRate(1);
  driftTimer ??= setInterval(drift, DRIFT_MS);
}

function exit() {
  inSession = false;
  together.handler = null;
  together.queueEnded = null;
  if (driftTimer) clearInterval(driftTimer);
  driftTimer = null;
  if (applyTimer) clearTimeout(applyTimer);
  setRate(null);
}

async function ensureTracks(ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !tracks.has(id));
  for (let i = 0; i < missing.length; i += 200) {
    const r = await api.tracks(missing.slice(i, i + 200));
    for (const t of r.tracks) tracks.set(t.id, t);
  }
}

async function apply(r: TogetherState | undefined) {
  if (!r) return;
  room = r;
  if (!(r.active && r.members.includes(me))) {
    if (inSession) exit();
    return;
  }
  if (!inSession) enter();
  try {
    await ensureTracks(r.queue.map((q) => q.track_id));
  } catch {
    return; // the next state or reconnect tries again
  }
  if (room !== r) return; // a newer state arrived meanwhile
  const keys = r.queue.map((q) => q.key);
  const s = usePlayer.getState();
  const sameQueue = s.queue.length === keys.length && s.queue.every((q, i) => q.uid === keys[i]);
  const patch: Partial<PlayerState> = {};
  if (!sameQueue) {
    const queue = r.queue.flatMap((q): QueueItem[] => {
      const track = tracks.get(q.track_id);
      return track ? [{ uid: q.key, track }] : [];
    });
    const curUid = selectCurrent(s)?.uid;
    const keep = curUid ? queue.findIndex((q) => q.uid === curUid) : -1;
    if (keep >= 0) usePlayer.setState({ queue, baseline: null, shuffle: false, context: CONTEXT, index: keep });
    else Object.assign(patch, { queue, baseline: null, shuffle: false, context: CONTEXT });
  }
  if (applyTimer) clearTimeout(applyTimer);
  applyTimer = setTimeout(
    () => {
      const cur = usePlayer.getState();
      const moved = cur.index !== r.index || selectCurrent(cur)?.uid !== keys[r.index];
      usePlayer.setState({ ...patch, index: r.index, playing: r.playing, ...(moved ? { position: 0, direction: 1 as const } : {}) });
      const t = targetPosition(r) / 1000;
      if (moved || Math.abs(getEngine().currentTime() - t) > 0.5 || !r.playing) getEngine().seek(t);
    },
    Math.max(0, r.apply_at_server_ms - serverNow()),
  );
}

function drift() {
  const r = room;
  const s = usePlayer.getState();
  const cur = selectCurrent(s);
  if (!r || !inSession || !r.playing || !s.playing || !cur || cur.uid !== r.queue[r.index]?.key || s.buffering) {
    if (rate !== 1) setRate(1);
    return;
  }
  const want = targetPosition(r);
  const duration = s.duration * 1000;
  if (duration && want > duration - 300) return; // the song is ending; the next state takes over
  const diff = getEngine().currentTime() * 1000 - want; // positive: ahead
  const gap = Math.abs(diff);
  if (gap > 500) {
    getEngine().seek(want / 1000);
    setRate(1);
  } else if (gap <= 20 || (gap < 40 && rate === 1)) {
    if (rate !== 1) setRate(1);
  } else {
    setRate(1 - Math.max(-0.03, Math.min(0.03, diff / 2000)));
  }
}

let started = false;

export function startTogetherSync(meId: string) {
  me = meId;
  if (started) return;
  started = true;
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "success" && e.query.queryKey[0] === togetherKey[0]) {
      void apply(e.query.state.data as TogetherState | undefined);
    }
  });
  usePlayer.subscribe((s, prev) => {
    if (!inSession || !room || s.queue !== prev.queue || s.index === prev.index || s.index === room.index) return;
    const prevKey = prev.queue[prev.index]?.uid;
    if (prevKey && prevKey === room.queue[room.index]?.key) command("skip", { key: prevKey });
  });
  void queryClient.query({ queryKey: togetherKey, queryFn: fetchTogether }).then(apply, () => undefined);
}
