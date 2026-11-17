import { mixHex } from "../../sky";
import type { Kit } from "../kit";
import * as S from "../scene";
import { canvas, INK, px, rng } from "../sprites";
import type { Ctx } from "./types";

type Fill = (g: Ctx, x: number, y: number, w: number, h: number) => void;

export const bricks =
  (base = "#9a5644", mortar = "#6e3a34", light = "#b06a52"): Fill =>
  (g, x, y, w, h) => {
    px(g, mortar, x, y, w, h);
    const r = rng(77);
    for (let j = 0; j * 4 < h; j++) {
      for (let i = -1; i * 8 < w; i++) {
        const bx = x + i * 8 + (j % 2 ? 4 : 0);
        const by = y + j * 4;
        const x0 = Math.max(x, bx);
        const x1 = Math.min(x + w, bx + 7);
        if (x1 <= x0) continue;
        const shade = r() < 0.25 ? mixHex(base, INK, 0.12) : r() < 0.2 ? mixHex(base, "#ffffff", 0.08) : base;
        px(g, shade, x0, by, x1 - x0, Math.min(3, y + h - by));
        px(g, light, x0, by, x1 - x0, 1);
      }
    }
  };

export const planks =
  (colors: string[], width = 6, vertical = true): Fill =>
  (g, x, y, w, h) => {
    const r = rng(13);
    if (vertical) {
      for (let i = 0; i * width < w; i++) {
        const col = colors[Math.floor(r() * colors.length)];
        const bw = Math.min(width, w - i * width);
        px(g, col, x + i * width, y, bw, h);
        px(g, mixHex(col, INK, 0.25), x + i * width + bw - 1, y, 1, h);
        if (r() < 0.5) px(g, mixHex(col, INK, 0.2), x + i * width + 2, y + Math.floor(r() * h), 1, 1);
      }
    } else {
      for (let j = 0; j * width < h; j++) {
        const bh = Math.min(width, h - j * width);
        const col = colors[j % colors.length];
        px(g, col, x, y + j * width, w, bh);
        px(g, mixHex(col, INK, 0.28), x, y + j * width + bh - 1, w, 1);
        for (let k = (j * 23) % 37; k < w; k += 37) px(g, mixHex(col, INK, 0.28), x + k, y + j * width, 1, bh - 1);
      }
    }
  };

export const logs =
  (base = "#9c6a44", dark = "#6e4630", light = "#c08a5c"): Fill =>
  (g, x, y, w, h) => {
    for (let j = 0; j * 6 < h; j++) {
      const ly = y + j * 6;
      const lh = Math.min(6, y + h - ly);
      px(g, base, x, ly, w, lh);
      px(g, light, x, ly + 1, w, 1);
      px(g, dark, x, ly + lh - 1, w, 1);
      const r = rng(31 + j);
      for (let k = 0; k < w / 14; k++) px(g, dark, x + Math.floor(r() * w), ly + 2 + Math.floor(r() * 2), 2, 1);
    }
  };

export const checker =
  (a: string, b: string, size = 8): Fill =>
  (g, x, y, w, h) => {
    for (let j = 0; j * size < h; j++)
      for (let i = 0; i * size < w; i++) px(g, (i + j) % 2 ? a : b, x + i * size, y + j * size, Math.min(size, w - i * size), Math.min(size, h - j * size));
  };

export const cobbles =
  (base = "#6f7389", gap = "#3f4256", light = "#8f94aa"): Fill =>
  (g, x, y, w, h) => {
    px(g, gap, x, y, w, h);
    const r = rng(41);
    for (let j = 0; j * 5 < h; j++) {
      for (let i = 0; i * 7 < w + 7; i++) {
        const sx = x + i * 7 - (j % 2 ? 3 : 0);
        const sy = y + j * 5;
        const x0 = Math.max(x, sx + 1);
        const x1 = Math.min(x + w, sx + 6);
        if (x1 <= x0) continue;
        const col = r() < 0.3 ? mixHex(base, INK, 0.15) : base;
        px(g, col, x0, sy + 1, x1 - x0, Math.min(3, y + h - sy - 1));
        px(g, light, x0, sy + 1, Math.min(2, x1 - x0), 1);
      }
    }
  };

export type RoomFrame = {
  wall: Fill;
  floor: Fill;
  cap?: string;
  door?: [string, string];
};

export function drawRoomFrame(g: Ctx, kit: Kit, f: RoomFrame) {
  f.floor(g, S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.FLOOR_Y);
  px(g, "rgba(58,58,80,0.2)", S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, 3);
  f.wall(g, S.ROOM_X0, S.WALL_TOP, S.DIVIDER_X - S.ROOM_X0, S.FLOOR_Y - S.WALL_TOP);
  px(g, INK, S.ROOM_X0, S.FLOOR_Y - 3, S.DIVIDER_X - S.ROOM_X0, 1);
  px(g, "#7d5a48", S.ROOM_X0, S.FLOOR_Y - 2, S.DIVIDER_X - S.ROOM_X0, 2);
  px(g, INK, S.ROOM_X0, S.WALL_TOP, 1, S.FLOOR_Y - S.WALL_TOP);
  px(g, INK, S.DIVIDER_X - 1, S.WALL_TOP, 1, S.FLOOR_Y - S.WALL_TOP);
  const cap = f.cap ?? "#f8f8f8";
  kit.wallTop(g, 0, S.WALL_TOP, S.ROOM_X0 + 1, S.FRONT_Y - S.WALL_TOP + 1, cap);
  kit.wallTop(g, S.DIVIDER_X, S.WALL_TOP, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y0 - S.WALL_TOP, cap);
  kit.wallTop(g, S.DIVIDER_X, S.DOOR_Y1, S.ROOF_X0 - S.DIVIDER_X, S.FRONT_Y - S.DOOR_Y1 + 1, cap);
  const [door, doorLight] = f.door ?? ["#b5754d", "#ca8854"];
  px(g, door, S.DIVIDER_X, S.DOOR_Y0, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y1 - S.DOOR_Y0);
  px(g, doorLight, S.DIVIDER_X + 1, S.DOOR_Y0 + 1, S.ROOF_X0 - S.DIVIDER_X - 2, S.DOOR_Y1 - S.DOOR_Y0 - 2);
}

export function drawRailing(g: Ctx, opts: { post: string; rail: string; cap: string; every?: number; solid?: boolean }) {
  const y0 = S.PARAPET_Y;
  const x0 = S.ROOF_X0;
  const x1 = S.SCENE_W - 1;
  const every = opts.every ?? 6;
  px(g, INK, x0 - 1, y0, x1 - x0 + 2, 4);
  px(g, opts.cap, x0, y0 + 1, x1 - x0, 2);
  if (opts.solid) {
    px(g, INK, x0, y0 + 4, x1 - x0, S.FLOOR_Y - y0 - 4);
    px(g, opts.rail, x0, y0 + 4, x1 - x0, S.FLOOR_Y - y0 - 5);
  } else {
    for (let x = x0 + 2; x < x1; x += every) {
      px(g, INK, x - 1, y0 + 4, 3, S.FLOOR_Y - y0 - 4);
      px(g, opts.post, x, y0 + 4, 1, S.FLOOR_Y - y0 - 5);
    }
    px(g, INK, x0, S.FLOOR_Y - 5, x1 - x0, 3);
    px(g, opts.rail, x0, S.FLOOR_Y - 4, x1 - x0, 1);
  }
  px(g, "rgba(58,58,80,0.25)", x0, S.FLOOR_Y, S.ROOF_X1 - x0, 2);
}

export function recolor(src: HTMLCanvasElement, pairs: [string, string][]): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const map = new Map(pairs.map(([a, b]) => [a.toLowerCase(), b]));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const h = "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    const to = map.get(h);
    if (!to) continue;
    const n = parseInt(to.slice(1), 16);
    d[i] = (n >> 16) & 255;
    d[i + 1] = (n >> 8) & 255;
    d[i + 2] = n & 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function colorsOf(src: HTMLCanvasElement): string[] {
  const d = src.getContext("2d")!.getImageData(0, 0, src.width, src.height).data;
  const out = new Set<string>();
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) out.add("#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
  return [...out];
}

export function tint(src: HTMLCanvasElement, test: (r: number, g: number, b: number) => boolean, to: string, amount = 0.85): HTMLCanvasElement {
  const pairs: [string, string][] = [];
  for (const h of colorsOf(src)) {
    const n = parseInt(h.slice(1), 16);
    if (test((n >> 16) & 255, (n >> 8) & 255, n & 255)) {
      const lum = (((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) / 255;
      const target = lum > 0.6 ? mixHex(to, "#ffffff", (lum - 0.6) * 1.2) : mixHex(to, INK, (0.6 - lum) * 0.9);
      pairs.push([h, mixHex(h, target, amount)]);
    }
  }
  return recolor(src, pairs);
}
