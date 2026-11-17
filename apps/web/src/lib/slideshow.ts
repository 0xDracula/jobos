export const SLIDE_MS = 6000;

export function beatInterval(beats: number[]): number | null {
  if (beats.length < 2) return null;
  const gaps = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
  if (!gaps.length) return null;
  return gaps[Math.floor(gaps.length / 2)];
}

export function beatsPerSlide(intervalMs: number, targetMs = SLIDE_MS): number {
  return Math.max(1, Math.round(targetMs / (intervalMs * 4))) * 4;
}

function firstAtOrAfter(beats: number[], ms: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nextChangeAt(beats: number[] | null | undefined, startMs: number, targetMs = SLIDE_MS): number {
  const interval = beats && beats.length >= 8 ? beatInterval(beats) : null;
  if (!beats || !interval) return startMs + targetMs;
  const n = beatsPerSlide(interval, targetMs);
  const i = firstAtOrAfter(beats, startMs - Math.min(80, interval / 4));
  const j = i + n;
  if (j < beats.length) return beats[j];
  const last = beats[beats.length - 1];
  const from = Math.max(last, startMs);
  return from + (j - Math.max(i, beats.length - 1)) * interval;
}

export type Pose = { scale: number; x: number; y: number };

export function kenBurns(n: number): { from: Pose; to: Pose } {
  const dirs = [
    [1, 0.4],
    [-1, -0.3],
    [0.5, -1],
    [-0.4, 1],
  ];
  const [dx, dy] = dirs[n % dirs.length];
  const near = { scale: 1.14, x: dx * 3, y: dy * 2 };
  const far = { scale: 1.02, x: -dx * 1, y: -dy * 1 };
  return n % 2 === 0 ? { from: far, to: near } : { from: near, to: far };
}
