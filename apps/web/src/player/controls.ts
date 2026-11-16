import { usePrefs } from "@/lib/prefs";
import { hiddenSnapshot, isHidden } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { getEngine } from "./engine";
import {
  clearUpcoming,
  insertTracks,
  loadQueue,
  nextIndex,
  playable,
  removeItem,
  replaceUpcoming,
  selectCurrent,
  toggleShuffle,
  usePlayer,
  type Panel,
  type PlayContext,
  type QueueItem,
  type Repeat,
  type SleepTimer,
} from "./store";
import { record } from "./telemetry";

const get = usePlayer.getState;
const set = usePlayer.setState;

function recordSkip() {
  const cur = selectCurrent(get());
  if (!cur) return;
  const position = getEngine().currentTime();
  const duration = get().duration;
  if (!duration || position < duration - 5) record("skip", cur.track.id, position);
}

export function playTracks(tracks: Track[], start: number, context: PlayContext, opts: { shuffle?: boolean } = {}) {
  const picked = start >= 0 ? tracks[start] : undefined;
  if (picked && !playable(picked)) return toast("Unavailable");
  const hidden = hiddenSnapshot();
  const list = tracks.filter((t) => t === picked || (playable(t) && !isHidden(t, hidden)));
  if (!list.length) return toast("Nothing to play");
  const shuffle = opts.shuffle ?? get().shuffle;
  const first = picked ? list.indexOf(picked) : shuffle ? Math.floor(Math.random() * list.length) : 0;
  recordSkip();
  set({ ...loadQueue(list, first, context, shuffle), shuffle, playing: true, position: 0, direction: 1 });
}

export function playNext(tracks: Track[]) {
  const ok = tracks.filter(playable);
  if (!ok.length) return toast("Unavailable");
  set(insertTracks(get(), ok, "next"));
  toast(ok.length === 1 ? "Playing next" : `${ok.length} songs playing next`);
}

export function addToQueue(tracks: Track[]) {
  const ok = tracks.filter(playable);
  if (!ok.length) return toast("Unavailable");
  set(insertTracks(get(), ok, "last"));
  toast(ok.length === 1 ? "Added to queue" : `${ok.length} songs added to queue`);
}

export function jumpTo(uid: string) {
  const s = get();
  const i = s.queue.findIndex((q) => q.uid === uid);
  if (i < 0 || i === s.index) return;
  recordSkip();
  set({ index: i, playing: true, position: 0, direction: i > s.index ? 1 : -1 });
}

export function play() {
  const s = get();
  const cur = selectCurrent(s);
  if (!cur || s.playing) return;
  const sleep = s.sleep?.mode === "time" && s.sleep.endsAt <= Date.now() ? null : s.sleep;
  set({ playing: true, sleep });
  record("resume", cur.track.id, getEngine().currentTime());
}

export function pause() {
  const s = get();
  const cur = selectCurrent(s);
  if (!cur || !s.playing) return;
  set({ playing: false });
  record("pause", cur.track.id, getEngine().currentTime());
}

export function toggle() {
  if (get().playing) pause();
  else play();
}

export function next() {
  const s = get();
  if (s.index < 0) return;
  recordSkip();
  const ni = nextIndex(s);
  if (ni == null) set({ index: 0, playing: false, position: 0, direction: 1 });
  else set({ index: ni, position: 0, direction: 1 });
}

export function previous() {
  const s = get();
  if (s.index < 0) return;
  const prev = s.index > 0 ? s.index - 1 : s.repeat === "all" ? s.queue.length - 1 : -1;
  if (getEngine().currentTime() > 3 || prev < 0) return seek(0);
  recordSkip();
  set({ index: prev, position: 0, direction: -1 });
}

export function seek(seconds: number) {
  const cur = selectCurrent(get());
  if (!cur) return;
  const from = getEngine().currentTime();
  getEngine().seek(seconds);
  if (Math.abs(seconds - from) >= 1) record("seek", cur.track.id, seconds, { from_ms: Math.round(from * 1000) });
}

export function seekBy(delta: number) {
  const s = get();
  if (s.index < 0) return;
  const to = getEngine().currentTime() + delta;
  seek(Math.max(0, s.duration ? Math.min(to, s.duration - 0.5) : to));
}

export function setShuffle(on: boolean) {
  set(toggleShuffle(get(), on));
}

export function cycleRepeat() {
  const order: Repeat[] = ["off", "all", "one"];
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
}

export function removeFromQueue(uid: string) {
  set(removeItem(get(), uid));
}

export function clearQueue() {
  set(clearUpcoming(get()));
}

export function reorderUpcoming(run: QueueItem[]) {
  set(replaceUpcoming(get(), run));
}

export function setVolume(volume: number) {
  usePrefs.getState().set({ volume: Math.max(0, Math.min(1, volume)), muted: false });
}

export function volumeBy(delta: number) {
  const p = usePrefs.getState();
  setVolume((p.muted ? 0 : p.volume) + delta);
}

export function toggleMute() {
  const p = usePrefs.getState();
  p.set({ muted: !p.muted });
}

export function expand(panel?: Panel) {
  if (get().index < 0) return;
  set(panel === undefined ? { expanded: true } : { expanded: true, panel });
}

export function collapse() {
  set({ expanded: false });
}

export function togglePanel(panel: Exclude<Panel, null>) {
  const s = get();
  if (!s.expanded) return expand(panel);
  set({ panel: s.panel === panel ? null : panel });
}

export function setSleep(sleep: SleepTimer) {
  set({ sleep });
  if (sleep) toast(sleep.mode === "time" ? `Sleep timer: ${sleep.minutes} min` : sleep.mode === "track" ? "Sleep timer: end of song" : "Sleep timer: end of queue");
}
