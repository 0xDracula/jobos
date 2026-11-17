import { lookKey, recolor, RULES, type AvatarLook, type AvatarStyle } from "./look";
import type { AvatarFrames } from "./types";

export const AVATAR_SHEET = "/room/avatars/characters.png";
const ROW: Record<AvatarStyle, number> = { amelia: 0, alex: 1, adam: 2, bob: 3 };
const INK = "#3a3a50";
const FRAMES = 18;

let sheet: Promise<HTMLImageElement> | null = null;
const cache = new Map<string, Promise<AvatarFrames>>();

function loadSheet(): Promise<HTMLImageElement> {
  sheet ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      sheet = null;
      reject(new Error("avatar sheet failed to load"));
    };
    img.src = AVATAR_SHEET;
  });
  return sheet;
}

const hexOf = (d: Uint8ClampedArray, o: number) => "#" + [d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");

function paint(d: Uint8ClampedArray, w: number, x: number, y: number, hex: string) {
  if (x < 0 || y < 0 || x >= w) return;
  const o = (y * w + x) * 4;
  if (o < 0 || o + 3 >= d.length) return;
  const n = parseInt(hex.slice(1), 16);
  d[o] = (n >> 16) & 255;
  d[o + 1] = (n >> 8) & 255;
  d[o + 2] = n & 255;
  d[o + 3] = 255;
}

function eyesOf(src: Uint8ClampedArray, style: AvatarStyle, fx: number, w: number): [number, number][] {
  const skin = new Set(RULES[style].find((r) => r.role === "skin")!.colors);
  const isSkin = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    return src[o + 3] > 0 && skin.has(hexOf(src, o));
  };
  const out: [number, number][] = [];
  for (let y = 16; y <= 22; y++) {
    for (let x = fx + 1; x < fx + 15; x++) {
      const o = (y * w + x) * 4;
      if (src[o + 3] === 0 || hexOf(src, o) !== INK) continue;
      const n = [isSkin(x - 1, y), isSkin(x + 1, y), isSkin(x, y - 1), isSkin(x, y + 1)].filter(Boolean).length;
      if (n >= 2) out.push([x, y]);
    }
    if (out.length >= 2) break;
    out.length = 0;
  }
  return out;
}

function frameCanvas(img: ImageData, fx: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 32;
  c.getContext("2d")!.putImageData(img, -fx, 0, fx, 0, 16, 32);
  return c;
}

function withHeadphones(frame: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.drawImage(frame, 0, 0);
  const img = g.getImageData(0, 0, 16, 32);
  const d = img.data;
  const top = (x: number) => {
    for (let y = 0; y < 32; y++) if (d[(y * 16 + x) * 4 + 3] > 0) return y;
    return 32;
  };
  const band = "#f4f1f8";
  const shade = "#c6cbe0";
  for (let x = 2; x <= 13; x++) {
    const y = top(x);
    if (y < 32) {
      paint(d, 16, x, y, INK);
      paint(d, 16, x, y + 1, band);
    }
  }
  for (const x of [1, 14]) for (let y = top(x) + 1; y < 16; y++) paint(d, 16, x, y, band);
  for (const [x0, x1] of [[0, 2], [13, 15]] as const) {
    for (let y = 15; y <= 20; y++) {
      for (let x: number = x0; x <= x1; x++) {
        const edge = y === 15 || y === 20 || x === x0 || x === x1;
        paint(d, 16, x, y, edge ? INK : y === 16 ? band : "#f08aa8");
      }
    }
    paint(d, 16, x0 + 1, 19, shade);
  }
  g.putImageData(img, 0, 0);
  return c;
}

async function build(look: AvatarLook): Promise<AvatarFrames> {
  const img = await loadSheet();
  const w = 16 * FRAMES;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 32;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, ROW[look.style] * 32, w, 32, 0, 0, w, 32);
  const data = g.getImageData(0, 0, w, 32);
  const src = new Uint8ClampedArray(data.data);
  const d = data.data;
  const memo = new Map<string, string | null>();
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3] === 0) continue;
      const hex = hexOf(d, o);
      const band = y <= 22 ? 0 : 1;
      const k = `${hex}${band}`;
      let to = memo.get(k);
      if (to === undefined) {
        to = recolor(look.style, look, hex, y);
        memo.set(k, to);
      }
      if (to) paint(d, w, x, y, to);
    }
  }
  if (look.glasses) {
    for (let f = 0; f < FRAMES; f++) {
      const eyes = eyesOf(src, look.style, f * 16, w);
      if (eyes.length < 2) continue;
      const [[ax, ay], [bx]] = eyes;
      const rim = "#2b2833";
      const glint = "#c6cbe0";
      for (const x of [ax, bx]) {
        paint(d, w, x - 1, ay - 1, rim);
        paint(d, w, x + 1, ay - 1, rim);
        paint(d, w, x - 1, ay, rim);
        paint(d, w, x + 1, ay, glint);
        paint(d, w, x - 1, ay + 1, rim);
        paint(d, w, x, ay + 1, rim);
        paint(d, w, x + 1, ay + 1, rim);
      }
      for (let x = ax + 2; x <= bx - 2; x++) paint(d, w, x, ay, rim);
    }
  }
  const frames = Array.from({ length: FRAMES }, (_, i) => frameCanvas(data, i * 16));
  const stand = frames.slice(0, 6);
  return { stand, standPhones: stand.map(withHeadphones), sitRight: frames.slice(6, 12), sitLeft: frames.slice(12, 18) };
}

export function avatarFrames(look: AvatarLook): Promise<AvatarFrames> {
  const key = lookKey(look);
  let p = cache.get(key);
  if (!p) {
    p = build(look);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
