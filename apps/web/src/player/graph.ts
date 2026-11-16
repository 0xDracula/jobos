import { EQ_BANDS } from "@/lib/prefs";

const TIME_CONSTANT = 0.02;

export class AudioGraph {
  readonly ctx: AudioContext;
  private elementGains: GainNode[];
  private bands: BiquadFilterNode[];
  private panner: StereoPannerNode;
  private dry: GainNode;
  private wet: GainNode;
  private compressor: DynamicsCompressorNode;
  private reverb: ConvolverNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoDepth: GainNode;
  private crackle: GainNode | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(elements: HTMLMediaElement[]) {
    this.ctx = new AudioContext({ latencyHint: "playback" });
    const input = this.ctx.createGain();
    this.elementGains = elements.map((el) => {
      const gain = this.ctx.createGain();
      this.ctx.createMediaElementSource(el).connect(gain).connect(input);
      return gain;
    });
    this.bands = EQ_BANDS.map((frequency, i) => {
      const band = this.ctx.createBiquadFilter();
      band.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      band.frequency.value = frequency;
      band.Q.value = 1.1;
      return band;
    });
    let node: AudioNode = input;
    for (const band of this.bands) node = node.connect(band);
    this.panner = this.ctx.createStereoPanner();
    node.connect(this.panner);
    this.dry = this.ctx.createGain();
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0;
    this.compressor = this.ctx.createDynamicsCompressor();
    this.setCompression(false);
    this.panner.connect(this.dry).connect(this.compressor);
    this.wet.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
    this.lfoDepth = this.ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfoDepth.connect(this.panner.pan);
  }

  private ramp(param: AudioParam, value: number) {
    param.setTargetAtTime(value, this.ctx.currentTime, TIME_CONSTANT);
  }

  resume() {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
  }

  idle() {
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => void this.ctx.suspend().catch(() => {}), 5_000);
  }

  setElementGain(i: number, value: number) {
    this.ramp(this.elementGains[i].gain, value);
  }

  setEq(gains: readonly number[], night: boolean) {
    gains.forEach((g, i) => this.ramp(this.bands[i].gain, g));
    this.setCompression(night);
  }

  private setCompression(on: boolean) {
    const c = this.compressor;
    const now = this.ctx.currentTime;
    c.threshold.setValueAtTime(on ? -26 : 0, now);
    c.knee.setValueAtTime(on ? 12 : 0, now);
    c.ratio.setValueAtTime(on ? 4 : 1, now);
    c.attack.setValueAtTime(0.01, now);
    c.release.setValueAtTime(0.25, now);
  }

  setReverb(on: boolean) {
    if (on && !this.reverb) {
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = impulseResponse(this.ctx, 2.8, 2.4);
      this.panner.connect(this.reverb).connect(this.wet);
    }
    this.ramp(this.wet.gain, on ? 0.38 : 0);
    this.ramp(this.dry.gain, on ? 0.85 : 1);
  }

  setPanning(on: boolean) {
    if (on && !this.lfo) {
      this.lfo = this.ctx.createOscillator();
      this.lfo.frequency.value = 0.08;
      this.lfo.connect(this.lfoDepth);
      this.lfo.start();
    }
    this.ramp(this.lfoDepth.gain, on ? 0.85 : 0);
  }

  setCrackle(level: number) {
    if (level > 0 && !this.crackle) {
      const source = this.ctx.createBufferSource();
      source.buffer = crackleBuffer(this.ctx);
      source.loop = true;
      this.crackle = this.ctx.createGain();
      this.crackle.gain.value = 0;
      source.connect(this.crackle).connect(this.ctx.destination);
      source.start();
    }
    if (this.crackle) this.ramp(this.crackle.gain, level * 0.5);
  }
}

function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buffer;
}

function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = rate * 6;
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let hiss = 0;
  for (let i = 0; i < length; i++) {
    hiss = hiss * 0.92 + (Math.random() * 2 - 1) * 0.08;
    data[i] = hiss * 0.05;
  }
  const clicks = 6 * 14;
  for (let n = 0; n < clicks; n++) {
    const at = Math.floor(Math.random() * (length - rate * 0.01));
    const loud = Math.random() < 0.08;
    const amplitude = (loud ? 0.5 : 0.12) + Math.random() * (loud ? 0.3 : 0.15);
    const span = Math.floor(rate * (loud ? 0.004 : 0.0015));
    const sign = Math.random() < 0.5 ? -1 : 1;
    for (let k = 0; k < span; k++) data[at + k] += sign * amplitude * Math.exp((-6 * k) / span) * (k % 2 ? -0.6 : 1);
  }
  return buffer;
}
