import { announce } from "@/lib/announce";
import { isIOS } from "@/lib/device";
import { artistLine } from "@/lib/format";
import { eqActive, rateFor, usePrefs, type Prefs } from "@/lib/prefs";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { AudioGraph } from "./graph";
import { nextIndex, selectCurrent, usePlayer, type PlayerState, type QueueItem } from "./store";
import { together } from "./togetherHooks";
import { queueEnd } from "./queueEnd";
import { record } from "./telemetry";

const GAPLESS_LEAD = 0.06;
const PRELOAD_BEFORE = 30;
const TICK_MS = 50;
const SYNC_MS = 250;
const PROGRESS_EVERY = 60;
const SLEEP_FADE = 60;
const MAX_FAILURES = 3;

type Slot = {
  el: HTMLAudioElement;
  uid: string | null;
  trackId: string | null;
  started: boolean;
  fade: number;
  ownPauses: number;
};

export const trackUrl = (t: Track): string | null => t.audio?.url ?? t.stream_url ?? null;

const sleepEndsHere = (s: PlayerState) =>
  s.sleep?.mode === "track" || (s.sleep?.mode === "queue" && s.index >= s.queue.length - 1);

export class Engine {
  private slots: [Slot, Slot];
  private active: 0 | 1 = 0;
  private graph: AudioGraph | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private xfade: { from: 0 | 1; start: number; length: number } | null = null;
  private sleepGain = 1;
  private pendingSeek: number | null = null;
  private failures = 0;
  private lastSync = 0;
  private listened = 0;
  private lastTime: number | null = null;
  private readonly ios = isIOS();

  constructor() {
    this.slots = [this.makeSlot(0), this.makeSlot(1)];
    this.onPrefs(usePrefs.getState(), null);
    usePrefs.subscribe((p, prev) => this.onPrefs(p, prev));
    usePlayer.subscribe((s, prev) => this.onState(s, prev));
    const s = usePlayer.getState();
    if (selectCurrent(s)) this.switchTo(selectCurrent(s), s);
  }

  private get other(): 0 | 1 {
    return this.active === 0 ? 1 : 0;
  }

  private makeSlot(i: 0 | 1): Slot {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.hidden = true;
    document.body.append(el);
    const slot: Slot = { el, uid: null, trackId: null, started: false, fade: i === 0 ? 1 : 0, ownPauses: 0 };
    const isActive = () => this.slots[this.active] === slot;
    el.addEventListener("playing", () => isActive() && this.onPlaying(slot));
    el.addEventListener("play", () => {
      if (isActive() && !usePlayer.getState().playing) usePlayer.setState({ playing: true });
    });
    el.addEventListener("pause", () => {
      if (slot.ownPauses > 0) {
        slot.ownPauses--;
        return;
      }
      if (isActive() && !el.ended && !this.xfade && usePlayer.getState().playing) usePlayer.setState({ playing: false });
    });
    el.addEventListener("waiting", () => isActive() && usePlayer.setState({ buffering: true }));
    el.addEventListener("canplay", () => isActive() && usePlayer.setState({ buffering: false }));
    el.addEventListener("loadedmetadata", () => isActive() && this.onMetadata());
    el.addEventListener("durationchange", () => isActive() && this.syncDuration());
    el.addEventListener("seeked", () => isActive() && this.syncPosition(true));
    el.addEventListener("ended", () => isActive() && this.onEnded());
    el.addEventListener("error", () => {
      if (!el.getAttribute("src")) return;
      if (isActive()) this.onError();
      else slot.uid = null; // a failed preload is loaded again when its turn comes
    });
    return slot;
  }

  private onState(s: PlayerState, prev: PlayerState) {
    const cur = selectCurrent(s);
    if (cur?.uid !== selectCurrent(prev)?.uid) this.switchTo(cur, s);
    else if (s.playing !== prev.playing) {
      if (s.playing) this.resumeActive();
      else this.pauseAll();
    }
    if (s.playing !== prev.playing) this.setTicking(s.playing);
    if (s.sleep !== prev.sleep && this.sleepGain !== 1) {
      this.sleepGain = 1;
      this.applyGains();
    }
  }

  private onPrefs(p: Prefs, prev: Prefs | null) {
    if (!prev || p.effect !== prev.effect) this.applyRate(p);
    const wantGraph = eqActive(p) || p.effect === "slowed" || p.effect === "8d" || p.vinyl;
    if (wantGraph && !this.graph) {
      try {
        this.graph = new AudioGraph(this.slots.map((s) => s.el));
        if (usePlayer.getState().playing) this.graph.resume();
      } catch (err) {
        console.warn("audio graph", err);
      }
    }
    if (this.graph && (!prev || p.eqGains !== prev.eqGains || p.eqPreset !== prev.eqPreset || p.effect !== prev.effect)) {
      this.graph.setEq(p.eqGains, p.eqPreset === "night");
      this.graph.setReverb(p.effect === "slowed");
      this.graph.setPanning(p.effect === "8d");
    }
    this.applyGains();
  }

  private switchTo(cur: QueueItem | null, s: PlayerState) {
    const act = this.slots[this.active];
    if (cur && act.uid === cur.uid) {
      this.syncDuration();
      this.announceTrack(cur);
      return;
    }
    this.finishCrossfade();
    this.pendingSeek = null;
    this.lastTime = null;
    this.listened = 0;
    if (!cur) {
      for (const slot of this.slots) this.quietPause(slot);
      return;
    }
    const other = this.slots[this.other];
    this.quietPause(act);
    if (other.uid === cur.uid && other.el.getAttribute("src")) {
      this.active = this.other;
      other.el.currentTime = 0;
    } else {
      this.load(act, cur);
    }
    const slot = this.slots[this.active];
    slot.fade = 1;
    this.slots[this.other].fade = 0;
    this.applyGains();
    if (s.playing) this.playSlot(slot);
    this.syncDuration();
    this.announceTrack(cur);
  }

  private load(slot: Slot, item: QueueItem, preload: "auto" | "metadata" = "auto") {
    this.quietPause(slot);
    slot.uid = item.uid;
    slot.trackId = item.track.id;
    slot.started = false;
    if (slot !== this.slots[this.active]) slot.fade = 0;
    const url = trackUrl(item.track);
    if (!url) {
      slot.el.removeAttribute("src");
      slot.el.load();
      return;
    }
    slot.el.preload = preload;
    slot.el.src = url;
    this.applyRate(usePrefs.getState());
  }

  prepare(position: number) {
    const slot = this.slots[this.active];
    if (!slot.uid) return;
    slot.el.preload = "metadata";
    this.pendingSeek = position;
  }

  private playSlot(slot: Slot) {
    this.graph?.resume();
    if (!slot.el.getAttribute("src")) {
      const cur = selectCurrent(usePlayer.getState());
      if (!cur) return;
      this.load(slot, cur);
    }
    slot.el.play()?.catch((err: DOMException) => {
      if (err.name === "NotAllowedError") usePlayer.setState({ playing: false });
    });
    this.applyGains();
  }

  private resumeActive() {
    const slot = this.slots[this.active];
    slot.fade = 1;
    this.playSlot(slot);
  }

  private pauseAll() {
    this.finishCrossfade();
    for (const slot of this.slots) this.quietPause(slot);
    this.syncPosition(true);
    this.graph?.idle();
    this.applyGains();
  }

  private quietPause(slot: Slot) {
    if (slot.el.paused) return;
    slot.ownPauses++;
    slot.el.pause();
  }

  seek(seconds: number) {
    this.finishCrossfade();
    const el = this.slots[this.active].el;
    const duration = Number.isFinite(el.duration) ? el.duration : usePlayer.getState().duration;
    const to = Math.max(0, duration ? Math.min(seconds, duration - 0.25) : seconds);
    if (el.readyState === 0) this.pendingSeek = to;
    else el.currentTime = to;
    this.lastTime = null;
    usePlayer.setState({ position: to });
  }

  currentTime(): number {
    return this.pendingSeek ?? this.slots[this.active].el.currentTime;
  }

  private onPlaying(slot: Slot) {
    this.failures = 0;
    usePlayer.setState({ buffering: false });
    if (!slot.started && slot.trackId) {
      slot.started = true;
      record("start", slot.trackId, slot.el.currentTime);
    }
  }

  private onMetadata() {
    const el = this.slots[this.active].el;
    if (this.pendingSeek != null) {
      el.currentTime = Number.isFinite(el.duration) ? Math.min(this.pendingSeek, el.duration - 0.25) : this.pendingSeek;
      this.pendingSeek = null;
    }
    this.syncDuration();
    this.syncPosition(true);
  }

  private onEnded() {
    const s = usePlayer.getState();
    const slot = this.slots[this.active];
    if (slot.trackId) record("complete", slot.trackId, slot.el.currentTime);
    if (sleepEndsHere(s)) return this.endSleep();
    if (s.repeat === "one") {
      slot.started = false;
      slot.el.currentTime = 0;
      this.playSlot(slot);
      return;
    }
    const ni = nextIndex(s);
    if (ni == null) {
      together.queueEnded?.();
      usePlayer.setState({ playing: false, position: 0 });
      slot.el.currentTime = 0;
      if (!together.handler) queueEnd.handler?.();
      return;
    }
    const other = this.slots[this.other];
    if (other.uid === s.queue[ni].uid && other.el.getAttribute("src")) this.advance(ni, 0, false);
    else usePlayer.setState({ index: ni, direction: 1, position: 0 });
  }

  private onError() {
    const s = usePlayer.getState();
    const cur = selectCurrent(s);
    this.failures++;
    toast(cur ? `Playback failed: ${cur.track.title}` : "Playback failed");
    const ni = nextIndex(s);
    if (this.failures >= MAX_FAILURES || ni == null || !s.playing) {
      this.failures = 0;
      usePlayer.setState({ playing: false, buffering: false });
      return;
    }
    usePlayer.setState({ index: ni, direction: 1, position: 0 });
  }

  private setTicking(on: boolean) {
    if (on && !this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const s = usePlayer.getState();
    const slot = this.slots[this.active];
    const el = slot.el;
    if (this.xfade) this.stepCrossfade();
    this.countListening(slot);
    this.updateSleep(s, el);
    if (s.playing && !el.paused && Number.isFinite(el.duration) && el.duration > 0) this.maybeAdvance(s, el);
    if (performance.now() - this.lastSync >= SYNC_MS) this.syncPosition();
  }

  private maybeAdvance(s: PlayerState, el: HTMLAudioElement) {
    if (s.repeat === "one" || sleepEndsHere(s)) return;
    const ni = nextIndex(s);
    if (ni == null) return;
    const next = s.queue[ni];
    const remaining = (el.duration - el.currentTime) / (el.playbackRate || 1);
    const crossfade = this.crossfadeLength(selectCurrent(s), next);
    const other = this.slots[this.other];
    if (other.uid !== next.uid && !this.xfade && remaining <= Math.max(PRELOAD_BEFORE, crossfade + 10)) this.load(other, next);
    if (remaining > (crossfade > 0 ? crossfade : GAPLESS_LEAD)) return;
    if (other.uid !== next.uid || other.el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    this.advance(ni, crossfade > 0 ? remaining : 0, true);
  }

  private crossfadeLength(cur: QueueItem | null, next: QueueItem): number {
    const seconds = usePrefs.getState().crossfade;
    if (!seconds || this.ios || !cur) return 0;
    if (cur.track.album_id && cur.track.album_id === next.track.album_id) return 0;
    return seconds;
  }

  private advance(ni: number, crossfade: number, complete: boolean) {
    const from = this.active;
    const outgoing = this.slots[from];
    const incoming = this.slots[this.other];
    if (complete && outgoing.trackId) record("complete", outgoing.trackId, outgoing.el.currentTime);
    incoming.fade = crossfade > 0 ? 0 : 1;
    this.active = this.other;
    if (crossfade > 0) this.xfade = { from, start: performance.now(), length: crossfade };
    this.lastTime = null;
    this.listened = 0;
    this.playSlot(incoming);
    usePlayer.setState({ index: ni, direction: 1, position: 0 });
  }

  private stepCrossfade() {
    const { from, start, length } = this.xfade!;
    const p = Math.min(1, (performance.now() - start) / (length * 1000));
    this.slots[from].fade = Math.cos((p * Math.PI) / 2);
    this.slots[this.active].fade = Math.sin((p * Math.PI) / 2);
    this.applyGains();
    if (p >= 1) this.finishCrossfade();
  }

  private finishCrossfade() {
    if (!this.xfade) return;
    const outgoing = this.slots[this.xfade.from];
    this.xfade = null;
    this.quietPause(outgoing);
    outgoing.fade = 0;
    this.slots[this.active].fade = 1;
    this.applyGains();
  }

  private countListening(slot: Slot) {
    const t = slot.el.currentTime;
    if (this.lastTime != null && !slot.el.paused) {
      const step = t - this.lastTime;
      if (step > 0 && step < 1) this.listened += step; // larger jumps are seeks
    }
    this.lastTime = t;
    if (this.listened >= PROGRESS_EVERY && slot.trackId) {
      this.listened -= PROGRESS_EVERY;
      record("progress", slot.trackId, t);
    }
  }

  private updateSleep(s: PlayerState, el: HTMLAudioElement) {
    const sleep = s.sleep;
    let gain = 1;
    if (sleep?.mode === "time") {
      const left = (sleep.endsAt - Date.now()) / 1000;
      if (left <= 0) return this.endSleep();
      gain = Math.min(1, left / SLEEP_FADE);
    } else if (sleepEndsHere(s) && Number.isFinite(el.duration)) {
      const left = (el.duration - el.currentTime) / (el.playbackRate || 1);
      gain = Math.max(0, Math.min(1, left / SLEEP_FADE));
    }
    if (Math.abs(gain - this.sleepGain) > 0.004) {
      this.sleepGain = gain;
      this.applyGains();
    }
  }

  private endSleep() {
    usePlayer.setState({ playing: false, sleep: null });
    this.sleepGain = 1;
    this.applyGains();
  }

  private applyGains() {
    const p = usePrefs.getState();
    const volume = p.muted ? 0 : p.volume ** 2;
    this.slots.forEach((slot, i) => {
      const gain = volume * slot.fade * this.sleepGain;
      if (this.graph) {
        this.graph.setElementGain(i, gain);
        slot.el.volume = 1;
      } else {
        slot.el.volume = Math.max(0, Math.min(1, gain));
      }
    });
    this.graph?.setCrackle(p.vinyl && usePlayer.getState().playing ? volume * this.sleepGain : 0);
  }

  private syncRate: number | null = null;

  setSyncRate(rate: number | null) {
    if (rate === this.syncRate) return;
    this.syncRate = rate;
    this.applyRate(usePrefs.getState());
  }

  private applyRate(p: Prefs) {
    const effect = this.syncRate == null ? rateFor(p.effect) : 1;
    const rate = effect * (this.syncRate ?? 1);
    for (const { el } of this.slots) {
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
      el.preservesPitch = effect === 1;
    }
  }

  private syncDuration() {
    const s = usePlayer.getState();
    const el = this.slots[this.active].el;
    const fallback = (selectCurrent(s)?.track.duration_ms ?? 0) / 1000;
    const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : fallback;
    if (duration !== s.duration) usePlayer.setState({ duration });
  }

  private syncPosition(force = false) {
    const now = performance.now();
    if (!force && now - this.lastSync < SYNC_MS) return;
    this.lastSync = now;
    const position = this.currentTime();
    if (position !== usePlayer.getState().position) usePlayer.setState({ position });
  }

  private announceTrack(item: QueueItem) {
    announce(`${item.track.title}, ${artistLine(item.track.artists)}`);
  }
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  engine ??= new Engine();
  return engine;
}
