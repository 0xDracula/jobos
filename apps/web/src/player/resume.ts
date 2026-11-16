import { api, ApiError } from "@/lib/api";
import { deviceId, forgetDevice, knownDeviceId } from "@/lib/device";
import { load, save } from "@/lib/storage";
import type { PlaybackState, Track } from "@/lib/types";

import { getEngine } from "./engine";
import { flush, record } from "./telemetry";
import { selectCurrent, usePlayer, type PlayContext, type QueueItem, type Repeat } from "./store";

const KEY = "jobbos.player";
const SERVER_EVERY_MS = 10_000;
const LEAVING_QUEUE = 1200;

type Snapshot = {
  v: 1;
  queue: QueueItem[];
  baseline: string[] | null;
  index: number;
  context: PlayContext | null;
  shuffle: boolean;
  repeat: Repeat;
  position: number;
  savedAt: number;
};

const slim = (t: Track): Track => (t.audio?.waveform ? { ...t, audio: { ...t.audio, waveform: undefined } } : t);

export function saveLocal() {
  const s = usePlayer.getState();
  if (s.index < 0) return;
  const snapshot: Snapshot = {
    v: 1,
    queue: s.queue.map((q) => ({ ...q, track: slim(q.track) })),
    baseline: s.baseline?.map((q) => q.uid) ?? null,
    index: s.index,
    context: s.context,
    shuffle: s.shuffle,
    repeat: s.repeat,
    position: getEngine().currentTime(),
    savedAt: Date.now(),
  };
  save(KEY, snapshot);
}

export const localSavedAt = () => load<Snapshot | null>(KEY, null)?.savedAt ?? 0;

let restored = false;

export function restoreLocal(): boolean {
  if (restored) return false;
  restored = true;
  const snap = load<Snapshot | null>(KEY, null);
  if (!snap || snap.v !== 1 || !snap.queue?.length || !snap.queue[snap.index]) return false;
  const byUid = new Map(snap.queue.map((q) => [q.uid, q]));
  const baseline = snap.baseline?.map((uid) => byUid.get(uid)).filter((q): q is QueueItem => !!q) ?? null;
  usePlayer.setState({
    queue: snap.queue,
    baseline: snap.shuffle && baseline?.length === snap.queue.length ? baseline : null,
    index: snap.index,
    context: snap.context,
    shuffle: snap.shuffle && !!baseline,
    repeat: snap.repeat,
    position: snap.position,
    playing: false,
  });
  getEngine().prepare(snap.position);
  return true;
}

function body(device: string, leaving: boolean): PlaybackState | null {
  const s = usePlayer.getState();
  const cur = selectCurrent(s);
  if (!cur) return null;
  let queue = s.queue;
  let index = s.index;
  if (leaving && queue.length > LEAVING_QUEUE) {
    const start = Math.max(0, index - 200);
    queue = queue.slice(start, start + LEAVING_QUEUE);
    index -= start;
  }
  return {
    device_id: device,
    device_name: "",
    track_id: cur.track.id,
    position_ms: Math.round(getEngine().currentTime() * 1000),
    queue: queue.map((q) => q.track.id),
    queue_index: index,
    shuffle: s.shuffle,
    repeat: s.repeat,
    playing: s.playing,
    updated_at: "",
  };
}

export async function saveRemote(retry = true): Promise<void> {
  try {
    const id = await deviceId();
    const state = body(id, false);
    if (!state) return;
    const { device_name: _n, updated_at: _u, ...payload } = state;
    await api.savePlayback(payload);
  } catch (err) {
    if (retry && err instanceof ApiError && err.status === 404) {
      forgetDevice();
      return saveRemote(false);
    }
  }
}

function saveLeaving() {
  saveLocal();
  void flush(true);
  const id = knownDeviceId();
  const state = id ? body(id, true) : null;
  if (!state) return;
  const { device_name: _n, updated_at: _u, ...payload } = state;
  void fetch("/api/playback", {
    method: "PUT",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

export function startResume(): () => void {
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = usePlayer.subscribe((s, prev) => {
    const changed = s.queue !== prev.queue || s.index !== prev.index || s.shuffle !== prev.shuffle || s.repeat !== prev.repeat;
    if (changed) {
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(saveLocal, 1000);
    }
    if (s.playing !== prev.playing && !s.playing) {
      saveLocal();
      void saveRemote();
    }
    if (s.index !== prev.index && s.playing) void saveRemote();
  });
  const interval = setInterval(() => {
    if (!usePlayer.getState().playing) return;
    saveLocal();
    void saveRemote();
  }, SERVER_EVERY_MS);
  const onHide = () => document.visibilityState === "hidden" && saveLeaving();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", saveLeaving);
  return () => {
    unsubscribe();
    clearInterval(interval);
    if (localTimer) clearTimeout(localTimer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", saveLeaving);
  };
}

export async function continueFrom(state: PlaybackState): Promise<boolean> {
  if (!state.track_id || !state.queue.length) return false;
  const { tracks } = await api.tracks(state.queue);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const queue = state.queue.map((id) => byId.get(id)).filter((t): t is Track => !!t);
  let index = -1;
  queue.forEach((t, i) => {
    if (t.id === state.track_id && (index < 0 || Math.abs(i - state.queue_index) < Math.abs(index - state.queue_index))) index = i;
  });
  if (index < 0) return false;
  const elapsed = state.playing ? Date.now() - Date.parse(state.updated_at) : 0;
  const duration = queue[index].duration_ms ?? Infinity;
  const position = Math.min(state.position_ms + Math.max(0, elapsed), duration - 1000) / 1000;
  const items = queue.map((track, i) => ({ uid: `${Date.now().toString(36)}c${i}`, track }));
  usePlayer.setState({
    queue: items,
    baseline: null,
    index,
    context: { type: "queue", name: "Continue here" },
    shuffle: false,
    repeat: state.repeat,
    position: Math.max(0, position),
    playing: true,
    direction: 1,
  });
  getEngine().seek(Math.max(0, position));
  record("resume", queue[index].id, position, { continued_from: state.device_id });
  return true;
}
