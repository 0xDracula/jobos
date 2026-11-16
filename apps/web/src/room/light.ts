export type RoomLight = {
  color: string;
  level: number;
  spread: number;
};

export const LAMP_LIGHT = "#ffcf7a";
export const NEUTRAL_LIGHT: RoomLight = { color: LAMP_LIGHT, level: 1, spread: 1 };
export const ALBUM_BLEND = 0.2;

type Swatch = { hex: string; weight: number; lab: [number, number, number] };

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export function albumColor(palette: Swatch[] | undefined | null): string | null {
  if (!palette?.length) return null;
  const colorful = palette.filter((c) => Math.hypot(c.lab[1], c.lab[2]) >= 12).sort((a, b) => b.weight - a.weight);
  return colorful[0]?.hex ?? null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function moodLight(palette: Swatch[] | undefined | null, energy: number | null | undefined, valence: number | null | undefined): RoomLight {
  let color = LAMP_LIGHT;
  const album = albumColor(palette);
  if (album) color = mix(color, album, ALBUM_BLEND);
  let level = 1;
  let spread = 1;
  if (typeof energy === "number" && Number.isFinite(energy)) {
    const e = clamp01(energy);
    level = 0.75 + e * 0.5;
    spread = 1.15 - e * 0.3;
  }
  if (typeof valence === "number" && Number.isFinite(valence)) {
    const v = clamp01(valence) - 0.5;
    color = mix(color, v >= 0 ? "#ffb36b" : "#c9c4ff", Math.abs(v) * 0.2);
  }
  return { color, level, spread };
}

export function distance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) / 255;
}

export function blendLight(a: RoomLight, b: RoomLight, t: number): RoomLight {
  const k = clamp01(t);
  return { color: mix(a.color, b.color, k), level: a.level + (b.level - a.level) * k, spread: a.spread + (b.spread - a.spread) * k };
}

export const LIGHT_SECONDS = 2;
