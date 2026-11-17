import { create } from "zustand";

import { usePrefs } from "@/lib/prefs";
import { getEngine } from "@/player/engine";
import { usePlayer } from "@/player/store";

export const AMBIENT_SOUNDS = [
  { id: "rain", label: "Rain" },
  { id: "thunder", label: "Thunder" },
  { id: "fire", label: "Fireplace" },
  { id: "cafe", label: "Café" },
  { id: "waves", label: "Ocean waves" },
  { id: "birds", label: "Birds" },
  { id: "wind", label: "Wind" },
  { id: "crickets", label: "Night crickets" },
] as const;

export type AmbientId = (typeof AMBIENT_SOUNDS)[number]["id"];

const SR = 24000;
const TAU = Math.PI * 2;

type FilterType = "lowpass" | "highpass" | "bandpass";

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private type: FilterType, freq: number, q = 0.707) {
    this.set(freq, q);
  }
  set(freq: number, q = 0.707) {
    const w = (TAU * Math.min(freq, SR * 0.45)) / SR;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    let b0: number;
    let b1: number;
    let b2: number;
    if (this.type === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (this.type === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else [b0, b1, b2] = [alpha, 0, -alpha];
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const white = () => Math.random() * 2 - 1;

function brown() {
  let b = 0;
  return () => {
    b = (b + 0.02 * white()) / 1.02;
    return b * 3.5;
  };
}

function addAt(L: Float32Array, R: Float32Array, t: number, samples: Float32Array, pan: number) {
  const start = Math.floor(t * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < samples.length; i++) {
    const j = (start + i) % L.length;
    L[j] += samples[i] * gl;
    R[j] += samples[i] * gr;
  }
}

function sweep(seconds: number, f0: number, f1: number, amp: number, vibrato = 0, vibratoHz = 0): Float32Array {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 + (f1 - f0) * t + vibrato * Math.sin((TAU * vibratoHz * i) / SR);
    phase += (TAU * f) / SR;
    out[i] = Math.sin(phase) * amp * Math.sin(Math.PI * t) ** 2;
  }
  return out;
}

function burst(seconds: number, amp: number, decay: number, filter?: Biquad): Float32Array {
  const n = Math.max(1, Math.floor(seconds * SR));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = white() * amp * Math.exp((-i / n) * decay);
    out[i] = filter ? filter.run(x) : x;
  }
  return out;
}

function loop(len: number, render: (L: Float32Array, R: Float32Array) => void, fade = 1.0): [Float32Array, Float32Array] {
  const n = Math.floor(len * SR);
  const f = Math.floor(fade * SR);
  const L = new Float32Array(n + f);
  const R = new Float32Array(n + f);
  render(L, R);
  const outL = L.slice(0, n);
  const outR = R.slice(0, n);
  for (let i = 0; i < f; i++) {
    const a = Math.sin((i / f) * (Math.PI / 2));
    const b = Math.cos((i / f) * (Math.PI / 2));
    outL[i] = L[i] * a + L[n + i] * b;
    outR[i] = R[i] * a + R[n + i] * b;
  }
  return [outL, outR];
}

const RECIPES: Record<AmbientId, () => [Float32Array, Float32Array]> = {
  rain: () =>
    loop(18, (L, R) => {
      for (const [ch, seed] of [[L, 0], [R, 1]] as const) {
        const hp = new Biquad("highpass", 500);
        const lp = new Biquad("lowpass", 5000 - seed * 300);
        const body = new Biquad("lowpass", 800);
        for (let i = 0; i < ch.length; i++) {
          const w = white();
          ch[i] += lp.run(hp.run(w)) * 0.11 + body.run(white()) * 0.05;
        }
      }
      const len = L.length / SR;
      for (let k = 0; k < len * 110; k++) {
        const f = new Biquad("bandpass", 1800 + Math.random() * 4500, 2);
        addAt(L, R, Math.random() * len, burst(0.004 + Math.random() * 0.01, 0.03 + Math.random() ** 2 * 0.25, 6, f), Math.random() * 2 - 1);
      }
    }),
  thunder: () =>
    loop(40, (L, R) => {
      const bed = brown();
      const lowBed = new Biquad("lowpass", 120);
      for (let i = 0; i < L.length; i++) {
        const x = lowBed.run(bed()) * 0.03;
        L[i] += x;
        R[i] += x;
      }
      for (const at of [4 + Math.random() * 8, 22 + Math.random() * 10]) {
        const dur = 5 + Math.random() * 3;
        const n = Math.floor(dur * SR);
        const src = brown();
        const lp = new Biquad("lowpass", 160 + Math.random() * 60);
        const crack = new Biquad("lowpass", 1400);
        const attack = 0.3 + Math.random() * 0.8;
        const rumble = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          const env = t < attack ? (t / attack) ** 2 : Math.exp(-(t - attack) / (dur / 3.5));
          const roll = 0.75 + 0.25 * Math.sin(TAU * 0.9 * t + Math.sin(TAU * 0.37 * t));
          rumble[i] = lp.run(src()) * env * roll * 0.9 + (t < 0.4 ? crack.run(white()) * Math.exp(-t / 0.12) * 0.12 : 0);
        }
        addAt(L, R, at, rumble, Math.random() * 1.2 - 0.6);
      }
    }, 2),
  fire: () =>
    loop(16, (L, R) => {
      const src = brown();
      const lp = new Biquad("lowpass", 420);
      const hiss = new Biquad("bandpass", 3000, 0.5);
      for (let i = 0; i < L.length; i++) {
        const t = i / SR;
        const flicker = 0.6 + 0.4 * Math.sin(TAU * 0.5 * t + Math.sin(TAU * 0.23 * t) * 2);
        const x = lp.run(src()) * 0.2 + hiss.run(white()) * 0.012 * flicker;
        L[i] += x;
        R[i] += x * 0.95;
      }
      const len = L.length / SR;
      for (let k = 0; k < len * 22; k++) {
        const hp = new Biquad("highpass", 1500 + Math.random() * 2500);
        addAt(L, R, Math.random() * len, burst(0.001 + Math.random() * 0.003, 0.05 + Math.random() ** 3 * 0.35, 5, hp), Math.random() * 1.4 - 0.7);
      }
      for (let k = 0; k < len * 0.8; k++) {
        const at = Math.random() * len;
        addAt(L, R, at, burst(0.006 + Math.random() * 0.008, 0.35 + Math.random() * 0.3, 4, new Biquad("highpass", 900)), Math.random() - 0.5);
        addAt(L, R, at, sweep(0.03, 140, 90, 0.18), 0);
      }
    }),
  cafe: () =>
    loop(24, (L, R) => {
      const room = brown();
      const roomLp = new Biquad("lowpass", 300);
      for (let i = 0; i < L.length; i++) {
        const x = roomLp.run(room()) * 0.035;
        L[i] += x;
        R[i] += x;
      }
      const len = L.length / SR;
      for (let v = 0; v < 5; v++) {
        const center = 380 + Math.random() * 600;
        const bp = new Biquad("bandpass", center, 1.6);
        const pan = Math.random() * 1.6 - 0.8;
        const voice = new Float32Array(L.length);
        let t = Math.random() * 2;
        while (t < len) {
          const phraseEnd = t + 1.2 + Math.random() * 2.5;
          while (t < phraseEnd && t < len) {
            const syl = 0.09 + Math.random() * 0.16;
            const start = Math.floor(t * SR);
            const n = Math.floor(syl * SR);
            bp.set(center * (0.8 + Math.random() * 0.5), 1.6);
            const amp = 0.05 + Math.random() * 0.05;
            for (let i = 0; i < n && start + i < voice.length; i++) voice[start + i] += bp.run(white()) * amp * Math.sin((Math.PI * i) / n);
            t += syl + 0.03 + Math.random() * 0.12;
          }
          t += 0.8 + Math.random() * 2.2;
        }
        addAt(L, R, 0, voice, pan);
      }
      for (let t = Math.random() * 3; t < len - 1; t += 2 + Math.random() * 4) {
        const f = 2400 + Math.random() * 1800;
        const clink = sweep(0.25, f, f * 0.995, 0.09 + Math.random() * 0.06);
        for (let i = 0; i < clink.length; i++) clink[i] *= Math.exp((-i / SR) * 18);
        addAt(L, R, t, clink, Math.random() * 1.6 - 0.8);
      }
    }),
  waves: () =>
    loop(24, (L, R) => {
      const period = 8;
      for (const [ch, offset] of [[L, 0], [R, 0.35]] as const) {
        const lp = new Biquad("lowpass", 600);
        const bed = brown();
        for (let i = 0; i < ch.length; i++) {
          const t = i / SR + offset;
          const p = (t % period) / period;
          const swell = p < 0.35 ? Math.sin((p / 0.35) * (Math.PI / 2)) ** 2 : Math.exp(-(p - 0.35) * 4.2);
          if (i % 64 === 0) lp.set(380 + 3200 * swell ** 2, 0.6);
          ch[i] += lp.run(white()) * (0.05 + 0.32 * swell) + bed() * 0.03;
        }
      }
    }, 0.5),
  birds: () =>
    loop(20, (L, R) => {
      const air = new Biquad("bandpass", 600, 0.4);
      for (let i = 0; i < L.length; i++) {
        const x = air.run(white()) * 0.01;
        L[i] += x;
        R[i] += x;
      }
      const len = L.length / SR;
      const songs: (() => Float32Array[])[] = [
        () => Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => sweep(0.07, 2800 + Math.random() * 300, 4200, 0.12)),
        () => [sweep(0.18, 3200, 3150, 0.1, 40, 25), sweep(0.22, 2600, 2580, 0.09, 40, 25)],
        () => Array.from({ length: 10 }, () => sweep(0.025, 4800, 4500, 0.07)),
      ];
      for (let t = Math.random(); t < len - 1.5; t += 0.8 + Math.random() * 2.6) {
        const kind = Math.floor(Math.random() * songs.length);
        const pan = Math.random() * 1.6 - 0.8;
        let at = t;
        for (const note of songs[kind]()) {
          addAt(L, R, at, note, pan);
          at += note.length / SR + (kind === 2 ? 0.015 : 0.09);
        }
      }
    }),
  wind: () =>
    loop(20, (L, R) => {
      const len = 20;
      for (const [ch, phase] of [[L, 0], [R, 1.7]] as const) {
        const bp = new Biquad("bandpass", 500, 0.8);
        const whistle = new Biquad("bandpass", 1400, 5);
        for (let i = 0; i < ch.length; i++) {
          const t = i / SR;
          const m1 = Math.sin((TAU * 2 * t) / len + phase);
          const m2 = Math.sin((TAU * 3 * t) / len + phase * 0.6);
          if (i % 64 === 0) {
            bp.set(520 + 300 * m1 + 120 * m2, 0.8);
            whistle.set(1400 + 300 * m2, 5);
          }
          const gust = 0.55 + 0.3 * m1 + 0.15 * m2;
          ch[i] += bp.run(white()) * 0.16 * gust + whistle.run(white()) * 0.02 * Math.max(0, m2);
        }
      }
    }, 0.5),
  crickets: () =>
    loop(12, (L, R) => {
      const air = new Biquad("lowpass", 2000);
      for (let i = 0; i < L.length; i++) {
        const x = air.run(white()) * 0.004;
        L[i] += x;
        R[i] += x;
      }
      const len = L.length / SR;
      for (const [freq, rate, pan, amp] of [[4300, 2.1, -0.6, 0.06], [4700, 2.6, 0.2, 0.05], [5100, 1.7, 0.7, 0.045]] as const) {
        for (let t = Math.random() / rate; t < len; t += 1 / rate + (Math.random() - 0.5) * 0.04) {
          let at = t;
          for (let p = 0; p < 3; p++) {
            addAt(L, R, at, sweep(0.018, freq, freq * 0.99, amp, 15, 60), pan);
            at += 0.032;
          }
        }
      }
    }),
};

type Voice = { gain: GainNode; source: AudioBufferSourceNode | null };

export const useAmbient = create<{ on: boolean }>(() => ({ on: false }));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const voices = new Map<AmbientId, Voice>();
const buffers = new Map<AmbientId, AudioBuffer>();

function context(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "playback" });
    master = ctx.createGain();
    master.connect(ctx.destination);
    watchSleep();
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

function bufferFor(id: AmbientId): AudioBuffer {
  let b = buffers.get(id);
  if (!b) {
    const [l, r] = RECIPES[id]();
    b = context().createBuffer(2, l.length, SR);
    b.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    buffers.set(id, b);
  }
  return b;
}

const gainFor = (level: number) => level * level * 0.9;

function apply(id: AmbientId, level: number) {
  const c = context();
  let v = voices.get(id);
  if (!v) {
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(master!);
    v = { gain, source: null };
    voices.set(id, v);
  }
  if (level > 0 && !v.source) {
    const source = c.createBufferSource();
    source.buffer = bufferFor(id);
    source.loop = true;
    source.connect(v.gain);
    source.start(c.currentTime, Math.random() * source.buffer.duration);
    v.source = source;
  }
  v.gain.gain.setTargetAtTime(gainFor(level), c.currentTime, 0.25);
  if (level === 0 && v.source) {
    const s = v.source;
    v.source = null;
    s.stop(c.currentTime + 1.5);
  }
}

export function startAmbient(levels = usePrefs.getState().ambient) {
  const c = context();
  master!.gain.cancelScheduledValues(c.currentTime);
  master!.gain.setTargetAtTime(1, c.currentTime, 0.3);
  for (const s of AMBIENT_SOUNDS) apply(s.id, levels[s.id] ?? 0);
  useAmbient.setState({ on: true });
}

export function stopAmbient(fadeSeconds = 1.5) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(0, t, fadeSeconds / 4);
  for (const [, v] of voices) {
    v.source?.stop(t + fadeSeconds + 0.5);
    v.source = null;
  }
  useAmbient.setState({ on: false });
}

export function setAmbientLevel(id: AmbientId, level: number) {
  const p = usePrefs.getState();
  p.set({ ambient: { ...p.ambient, [id]: level } });
  if (useAmbient.getState().on || level > 0) {
    if (!useAmbient.getState().on) startAmbient({ ...p.ambient, [id]: level });
    else apply(id, level);
  }
}

export function setAmbientLevels(levels: Record<string, number>) {
  usePrefs.getState().set({ ambient: levels });
  startAmbient(levels);
}

let beforeSleep: { on: boolean } | null = null;

export function startSleepAmbient(levels: Record<string, number>) {
  beforeSleep ??= { on: useAmbient.getState().on };
  startAmbient(levels);
}

export function endSleepAmbient() {
  const before = beforeSleep;
  beforeSleep = null;
  if (!before) return;
  if (before.on) startAmbient();
  else stopAmbient();
}

function watchSleep() {
  setInterval(() => {
    const s = usePlayer.getState();
    if (!master || !ctx || !useAmbient.getState().on || !s.sleep) return;
    let left = Infinity;
    if (s.sleep.mode === "time") left = (s.sleep.endsAt - Date.now()) / 1000;
    else if (s.sleep.mode === "track" || s.index >= s.queue.length - 1) left = Math.max(0, s.duration - getEngine().currentTime());
    if (left < 60) master.gain.setTargetAtTime(Math.max(0, left / 60), ctx.currentTime, 0.3);
  }, 1000);
  usePlayer.subscribe((s, prev) => {
    if (!prev.sleep || s.sleep) return;
    if (!s.playing) {
      beforeSleep = null;
      stopAmbient(3);
    } else endSleepAmbient();
  });
}
