const INK = "#3a3a50";
const FUR = "#ec9a4f";
const STRIPE = "#c97234";
const LIGHT = "#ffe1b8";
const PINK = "#f49ab0";
const RED = "#e0475a";
const TEAR = "#7fc4ec";
const GOLD = "#ffd23f";
const STEEL = "#5d5f7a";
const STEEL_LIGHT = "#8f92b0";
const WHITE = "#ffffff";
const EYE = "#2b2a3a";

export const STICKERS = [
  { id: "kitten-happy", label: "Happy" },
  { id: "kitten-love", label: "Love" },
  { id: "kitten-laugh", label: "Laughing" },
  { id: "kitten-shy", label: "Shy" },
  { id: "kitten-music", label: "Music" },
  { id: "kitten-wow", label: "Surprised" },
  { id: "kitten-sleepy", label: "Sleepy" },
  { id: "kitten-cry", label: "Crying" },
] as const;

export type StickerId = (typeof STICKERS)[number]["id"];

type G = CanvasRenderingContext2D;

const px = (g: G, color: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
};

function ellipse(g: G, color: string, cx: number, cy: number, rx: number, ry: number) {
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.3))));
    px(g, color, cx - w, cy + y, w * 2 + 1, 1);
  }
}

function grid(g: G, rows: string[], colors: Record<string, string>, x: number, y: number) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => colors[ch] && px(g, colors[ch], x + i, y + j)));
}

const HEART = ["rr.rr", "rrrrr", ".rrr.", "..r.."];
const HEART_SMALL = ["r.r", "rrr", ".r."];

function base(g: G) {
  ellipse(g, INK, 16, 27, 9, 5);
  ellipse(g, FUR, 16, 27, 8, 4);
  ellipse(g, LIGHT, 16, 28, 4, 3);
  ellipse(g, INK, 11, 30, 3, 2);
  ellipse(g, INK, 21, 30, 3, 2);
  ellipse(g, LIGHT, 11, 30, 2, 1);
  ellipse(g, LIGHT, 21, 30, 2, 1);
  grid(g, ["oo......", "ofo.....", "offo....", "ofpfo...", "ofppfo..", "offppfo.", "offfffoo"], { o: INK, f: FUR, p: PINK }, 5, 2);
  grid(g, ["......oo", ".....ofo", "....offo", "...ofpfo", "..ofppfo", ".ofppffo", "ooffffo."], { o: INK, f: FUR, p: PINK }, 19, 2);
  ellipse(g, INK, 16, 15, 12, 9);
  ellipse(g, FUR, 16, 15, 11, 8);
  px(g, STRIPE, 13, 8, 1, 2);
  px(g, STRIPE, 16, 7, 1, 3);
  px(g, STRIPE, 19, 8, 1, 2);
  px(g, STRIPE, 5, 15, 2, 1);
  px(g, STRIPE, 5, 17, 2, 1);
  px(g, STRIPE, 26, 15, 2, 1);
  px(g, STRIPE, 26, 17, 2, 1);
  ellipse(g, LIGHT, 16, 19, 4, 2);
  px(g, PINK, 15, 17, 3, 1);
  px(g, PINK, 16, 18);
}

const eyesHappy = (g: G) => {
  for (const x of [9, 20]) grid(g, [".oo.", "o..o"], { o: INK }, x, 14);
};
const eyesClosed = (g: G) => {
  for (const x of [9, 20]) px(g, INK, x, 15, 4, 1);
};
const mouthCat = (g: G) => grid(g, ["o.o.o", ".o.o."], { o: INK }, 14, 19);
const cheeks = (g: G, wide = false) => {
  px(g, PINK, 7, 18, wide ? 3 : 2, 1);
  px(g, PINK, wide ? 22 : 23, 18, wide ? 3 : 2, 1);
};

const DRAW: Record<StickerId, (g: G) => void> = {
  "kitten-happy": (g) => {
    eyesHappy(g);
    mouthCat(g);
    cheeks(g);
  },
  "kitten-love": (g) => {
    for (const x of [8, 19]) grid(g, HEART, { r: RED }, x, 13);
    mouthCat(g);
    cheeks(g);
    grid(g, HEART_SMALL, { r: RED }, 26, 3);
    grid(g, HEART_SMALL, { r: PINK }, 29, 7);
  },
  "kitten-laugh": (g) => {
    for (const x of [9, 20]) grid(g, ["o...", ".oo.", "o..."].map((r) => (x > 16 ? [...r].reverse().join("") : r)), { o: INK }, x, 13);
    grid(g, ["ooooooo", "okkkkko", ".okppo.", "..ooo.."], { o: INK, k: EYE, p: PINK }, 13, 19);
    px(g, TEAR, 7, 14, 1, 2);
    px(g, TEAR, 25, 14, 1, 2);
    cheeks(g);
  },
  "kitten-shy": (g) => {
    for (const x of [10, 21]) px(g, EYE, x, 15, 2, 2);
    grid(g, ["p.p.p", ".p.p."], { p: "#e7708f" }, 6, 17);
    grid(g, ["p.p.p", ".p.p."], { p: "#e7708f" }, 22, 17);
    grid(g, [".o.", "o.o"], { o: INK }, 15, 20);
    grid(g, HEART_SMALL, { r: RED }, 27, 5);
  },
  "kitten-music": (g) => {
    eyesHappy(g);
    mouthCat(g);
    grid(g, ["....oooooooooooooooo....", "...ossssssssssssssssso..", "..os..................so.", ".os....................so"].map((r) => r.slice(0, 24)), { o: INK, s: STEEL_LIGHT }, 4, 2);
    for (const x of [2, 26]) {
      px(g, INK, x, 11, 4, 8);
      px(g, STEEL, x + 1, 12, 2, 6);
      px(g, PINK, x + 1, 13, 2, 4);
    }
    grid(g, [".oo", ".o.", "oo."], { o: GOLD }, 28, 1);
    grid(g, ["oo", "o.", "o."], { o: PINK }, 1, 4);
  },
  "kitten-wow": (g) => {
    for (const x of [9, 20]) {
      grid(g, [".kk.", "kkkk", "kkkk", ".kk."], { k: EYE }, x, 12);
      px(g, WHITE, x + 1, 13);
    }
    grid(g, [".o.", "oko", ".o."], { o: INK, k: EYE }, 15, 20);
    grid(g, ["y", "y", "y", ".", "y"], { y: GOLD }, 28, 2);
  },
  "kitten-sleepy": (g) => {
    eyesClosed(g);
    grid(g, [".o.", "o.o", ".o."], { o: INK }, 15, 20);
    grid(g, ["ooooo", "...o.", "..o..", ".o...", "ooooo"], { o: STEEL_LIGHT }, 24, 1);
    grid(g, ["ooo", "..o", "o..", "ooo"], { o: STEEL_LIGHT }, 29, 7);
  },
  "kitten-cry": (g) => {
    for (const x of [9, 20]) grid(g, ["oooo", "....", ".bb."], { o: INK, b: TEAR }, x, 14);
    for (const x of [10, 22]) px(g, TEAR, x, 17, 1, 6);
    grid(g, [".ooo.", "o...o"], { o: INK }, 14, 20);
  },
};

const cache = new Map<string, string>();

export function stickerURL(id: string): string | null {
  const draw = DRAW[id as StickerId];
  if (!draw || typeof document === "undefined") return null;
  let url = cache.get(id);
  if (!url) {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    base(g);
    draw(g);
    url = c.toDataURL("image/png");
    cache.set(id, url);
  }
  return url;
}

export const isBuiltInSticker = (id: string): id is StickerId => id in DRAW;
