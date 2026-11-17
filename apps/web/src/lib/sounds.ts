import { usePrefs } from "./prefs";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext({ latencyHint: "interactive" });
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function envelope(c: AudioContext, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(c: AudioContext, freq: number, endFreq: number, peak: number, attack: number, decay: number, type: OscillatorType = "sine") {
  const osc = c.createOscillator();
  osc.type = type;
  const t = c.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
  const g = envelope(c, peak, attack, decay);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

function noise(c: AudioContext, seconds: number, filter: BiquadFilterType, freq: number, q: number, peak: number, attack: number) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, seconds);
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = envelope(c, peak, attack, seconds - attack);
  src.connect(f).connect(g).connect(c.destination);
  src.start();
  return { src, gain: g };
}

export type UiSound = "pop" | "needle" | "lift" | "crackle" | "chime" | "paper";

function crackle(c: AudioContext, seconds: number, level: number) {
  noise(c, seconds, "bandpass", 1800, 0.4, 0.02 * level, 0.05);
  const pops = Math.round(seconds * 14);
  for (let i = 0; i < pops; i++) {
    const at = Math.random() * seconds * 1000;
    const fade = 1 - at / (seconds * 1000);
    setTimeout(() => noise(c, 0.01, "highpass", 2600 + Math.random() * 2000, 1, (0.03 + Math.random() * 0.07) * level * fade, 0.001), at);
  }
}

const RECIPES: Record<UiSound, (c: AudioContext) => void> = {
  pop: (c) => tone(c, 620, 240, 0.22, 0.005, 0.09),
  chime: (c) => {
    tone(c, 880, 870, 0.12, 0.01, 1.3);
    tone(c, 1320, 1310, 0.08, 0.01, 1.1);
    tone(c, 1760, 1750, 0.05, 0.01, 0.9);
  },
  needle: (c) => {
    tone(c, 140, 70, 0.18, 0.003, 0.08);
    noise(c, 0.04, "highpass", 2500, 0.7, 0.3, 0.002);
    crackle(c, 1.8, 1);
  },
  lift: (c) => {
    noise(c, 0.025, "highpass", 3200, 0.8, 0.14, 0.002);
    tone(c, 900, 600, 0.03, 0.002, 0.05);
  },
  crackle: (c) => crackle(c, 2.5, 1),
  paper: (c) => {
    const { gain } = noise(c, 0.32, "bandpass", 3200, 0.8, 0.18, 0.02);
    const t = c.currentTime;
    for (let i = 0; i < 6; i++) gain.gain.setValueAtTime(0.06 + Math.random() * 0.14, t + 0.03 + i * 0.04);
  },
};

export function uiSound(name: UiSound) {
  if (!usePrefs.getState().uiSounds) return;
  const c = audio();
  if (c) RECIPES[name](c);
}

export function purr() {
  const c = audio();
  if (!c) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 1.6);
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 260;
  const am = c.createGain();
  am.gain.value = 0;
  const lfo = c.createOscillator();
  lfo.frequency.value = 25;
  const depth = c.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(am.gain);
  const out = c.createGain();
  const t = c.currentTime;
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
  out.gain.exponentialRampToValueAtTime(0.15, t + 0.75);
  out.gain.exponentialRampToValueAtTime(0.45, t + 1.0);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
  src.connect(low).connect(am).connect(out).connect(c.destination);
  const base = c.createConstantSource();
  base.offset.value = 0.5;
  base.connect(am.gain);
  base.start(t);
  lfo.start(t);
  src.start(t);
  for (const n of [src, lfo, base]) n.stop(t + 1.6);
}
