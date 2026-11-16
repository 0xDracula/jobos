import type { PaletteColor } from "./types";

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const chroma = (c: PaletteColor) => Math.hypot(c.lab[1], c.lab[2]);

export function pickAccent(palette: PaletteColor[] | undefined, bg: string): string | null {
  if (!palette?.length) return null;
  const candidates = [...palette].filter((c) => chroma(c) >= 15).sort((a, b) => b.weight - a.weight);
  return candidates.find((c) => contrast(c.hex, bg) >= 3)?.hex ?? null;
}

export function pickWash(palette: PaletteColor[] | undefined): string | null {
  if (!palette?.length) return null;
  const colorful = [...palette].filter((c) => chroma(c) >= 10).sort((a, b) => b.weight - a.weight);
  return (colorful[0] ?? palette[0]).hex;
}
