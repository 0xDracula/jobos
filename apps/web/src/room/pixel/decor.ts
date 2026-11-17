import type { DrinkArt, FilmArt, FlowerArt, FoodArt, PlaceArt, ArtistArt } from "../favorites";
import { mixHex } from "../sky";
import { canvas, COLORS, ellipse, grid, gridSprite, INK, px } from "./sprites";

type Ctx = CanvasRenderingContext2D;

const LEAF = "#5f9e6e";
const LEAF_DARK = "#447e70";
const WHITE = "#faf6ee";
const GOLD = "#e0b870";
const WOOD = COLORS.WOOD;
const WOOD_DARK = COLORS.WOOD_DARK;

const lighten = (c: string, t: number) => mixHex(c, "#ffffff", t);
const darken = (c: string, t: number) => mixHex(c, INK, t);

type Bloom = { rows: string[]; colors: Record<string, string> };

const BLOOMS: Record<Exclude<FlowerArt, "default">, Bloom> = {
  rose: { rows: [".rr.", "rRrr", "rrRr", ".rr."], colors: { r: "#d9435a", R: "#9e2a40" } },
  tulip: { rows: ["t.t.t", "ttttt", "tTttt", ".ttt."], colors: { t: "#f06a8a", T: "#c84468" } },
  sunflower: { rows: [".y.y.", "yybyy", ".bBb.", "yybyy", ".y.y."], colors: { y: "#ffd23f", b: "#8a5a3c", B: "#5e3b28" } },
  lily: { rows: ["w...w", ".wpw.", "..w..", ".w.w."], colors: { w: "#fff8f0", p: "#f2a0b0" } },
  daisy: { rows: [".w.", "wyw", ".w."], colors: { w: "#ffffff", y: "#ffd23f" } },
  lavender: { rows: [".l", "lL", ".l", "lL", ".l"], colors: { l: "#9b77c4", L: "#7656a8" } },
  jasmine: { rows: ["w.w", ".y.", "w.w"], colors: { w: "#ffffff", y: "#fff1a8" } },
  orchid: { rows: ["o.o", "oWo", ".o."], colors: { o: "#c45ab3", W: "#fff0fb" } },
  blossom: { rows: ["p.p", ".P.", "p.p"], colors: { p: "#ffc8d8", P: "#f08aa8" } },
  carnation: { rows: ["c.c.", "cccc", "cCcc", ".cc."], colors: { c: "#f58aa8", C: "#d65f84" } },
  lotus: { rows: ["..l..", ".lLl.", "lLLLl", ".lll."], colors: { l: "#f7a6c4", L: "#e2779e" } },
};

const DEFAULT_BLOOMS: Bloom[] = [
  { rows: [".p.", "pPp", ".p."], colors: { p: "#f7a6c4", P: "#ffe08a" } },
  { rows: [".w.", "wyw", ".w."], colors: { w: "#ffffff", y: "#ffd23f" } },
];

export function flowerBunch(kind: FlowerArt): HTMLCanvasElement {
  const c = canvas(15, 12);
  const g = c.getContext("2d")!;
  const tops: [number, number][] = kind === "sunflower" ? [[3, 1], [10, 0]] : [[2, 2], [7, 0], [11, 3]];
  for (const [x, y] of tops) {
    const sx = 7;
    for (let yy = y + 2; yy < 12; yy++) {
      const t = (yy - y - 2) / Math.max(1, 12 - y - 2);
      px(g, LEAF_DARK, Math.round(x + (sx - x) * t), yy);
    }
  }
  px(g, LEAF, 4, 8, 2, 1);
  px(g, LEAF, 9, 7, 2, 1);
  tops.forEach(([x, y], i) => {
    const b = kind === "default" ? DEFAULT_BLOOMS[i % 2] : BLOOMS[kind];
    const w = Math.max(...b.rows.map((r) => r.length));
    grid(g, b.rows, b.colors, x - Math.floor(w / 2) + 1, y);
  });
  return c;
}

function frame(w: number, h: number, wood = WOOD): { c: HTMLCanvasElement; g: Ctx } {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  px(g, INK, 0, 0, w, h);
  px(g, wood, 1, 1, w - 2, h - 2);
  px(g, lighten(wood, 0.25), 1, 1, w - 2, 1);
  px(g, INK, 2, 2, w - 4, h - 4);
  return { c, g };
}

function sky(g: Ctx, x: number, y: number, w: number, h: number, top: string, bottom: string) {
  for (let j = 0; j < h; j++) px(g, mixHex(top, bottom, h > 1 ? j / (h - 1) : 0), x, y + j, w, 1);
}

export function placePoster(kind: PlaceArt): HTMLCanvasElement {
  const { c, g } = frame(21, 14);
  const [x, y, w, h] = [3, 3, 15, 8];
  const art: Record<Exclude<PlaceArt, "default">, () => void> = {
    paris: () => {
      sky(g, x, y, w, h, "#f2b5a8", "#ffe2c0");
      grid(g, ["..o..", "..o..", ".ooo.", ".o.o.", ".ooo.", "o...o", "o...o", "o...o"], { o: "#4a3f5a" }, x + 5, y);
    },
    pyramids: () => {
      sky(g, x, y, w, h, "#7fb3e0", "#f6dca0");
      px(g, "#ffd23f", x + 12, y + 1, 2, 2);
      grid(g, ["...a...", "..aAa..", ".aaAAa.", "aaaaAAa"], { a: "#e0b870", A: "#b98a4c" }, x + 1, y + 4);
      grid(g, ["..a..", ".aAa.", "aaaAA"], { a: "#e8c587", A: "#c39a5a" }, x + 8, y + 5);
    },
    sea: () => {
      sky(g, x, y, w, 4, "#8fc4ea", "#d9eef8");
      sky(g, x, y + 4, w, 4, "#3f8fc4", "#2e6f9e");
      px(g, "#ffffff", x + 2, y + 5, 2, 1);
      px(g, "#ffffff", x + 9, y + 6, 3, 1);
      grid(g, ["..w.", ".ww.", "wwww", ".ss."], { w: "#ffffff", s: "#8a5a3c" }, x + 5, y + 1);
    },
    london: () => {
      sky(g, x, y, w, h, "#9fb0c8", "#d7dde6");
      grid(g, [".t.", "ttt", "tct", "ttt", "ttt", "ttt", "ttt", "ttt"], { t: "#8a6a4a", c: "#fff1c4" }, x + 6, y);
      px(g, "#c43d4a", x + 1, y + 6, 4, 2);
    },
    newyork: () => {
      sky(g, x, y, w, h, "#ffb08a", "#ffd9a8");
      const b = "#4a4a68";
      px(g, b, x, y + 4, 3, 4);
      px(g, b, x + 3, y + 2, 2, 6);
      px(g, b, x + 6, y, 1, 2);
      px(g, b, x + 5, y + 2, 3, 6);
      px(g, b, x + 9, y + 3, 3, 5);
      px(g, b, x + 12, y + 5, 3, 3);
      px(g, "#ffe08a", x + 6, y + 4, 1, 1);
      px(g, "#ffe08a", x + 10, y + 5, 1, 1);
    },
    japan: () => {
      sky(g, x, y, w, h, "#ffe0d0", "#cfe3f0");
      ellipse(g, "#e0475a", x + 11, y + 2, 1, 1);
      grid(g, ["...www...", "..wwwww..", ".bbwbwbb.", "bbbbbbbbb"], { w: "#ffffff", b: "#6a7bb0" }, x + 1, y + 4);
    },
    rome: () => {
      sky(g, x, y, w, h, "#8fc4ea", "#f6e4c0");
      const s = "#d9a66a";
      px(g, s, x + 2, y + 3, 11, 5);
      for (let i = 0; i < 4; i++) {
        px(g, "#8a5a3c", x + 3 + i * 3, y + 4, 1, 2);
        px(g, "#8a5a3c", x + 3 + i * 3, y + 7, 1, 1);
      }
      px(g, lighten(s, 0.2), x + 2, y + 3, 11, 1);
    },
    istanbul: () => {
      sky(g, x, y, w, h, "#f6a07a", "#ffd2a0");
      const m = "#5a4a6a";
      ellipse(g, m, x + 7, y + 5, 3, 2);
      px(g, m, x + 3, y + 5, 9, 3);
      px(g, m, x + 1, y + 1, 1, 7);
      px(g, m, x + 13, y + 1, 1, 7);
      px(g, m, x + 7, y + 2, 1, 1);
    },
    mountains: () => {
      sky(g, x, y, w, h, "#9fc8ec", "#e4f2fb");
      grid(g, ["....w.....", "...wwg....", "..wgggg.w.", ".gggggggwg", "gggggggggg"], { w: "#ffffff", g: "#6f7f9e" }, x + 2, y + 3);
    },
    santorini: () => {
      sky(g, x, y, w, 4, "#7fc0ec", "#cdeafb");
      sky(g, x, y + 5, w, 3, "#2f86c8", "#2a6fa8");
      grid(g, [".b..b.", "bbbwbb", "wwwwww", "wbwwbw"], { b: "#2f6fc0", w: "#ffffff" }, x + 4, y + 2);
    },
    desert: () => {
      sky(g, x, y, w, h, "#3a3a70", "#c97a6a");
      px(g, "#fff1c4", x + 11, y + 1, 2, 2);
      grid(g, ["......ddd......", "...dddDDDdd....", "ddddDDDDDDdddd.", "DDDDDDDDDDDDDDD"], { d: "#e0a560", D: "#c4844a" }, x, y + 4);
      grid(g, ["l.l", ".t.", ".t."], { l: LEAF, t: "#8a5a3c" }, x + 2, y + 2);
    },
  };
  if (kind === "default") return c;
  art[kind]();
  return c;
}

export function filmPoster(kind: FilmArt): HTMLCanvasElement {
  const { c, g } = frame(13, 15, "#a85f46");
  const [x, y, w, h] = [3, 3, 7, 9];
  const art: Record<Exclude<FilmArt, "default">, () => void> = {
    ship: () => {
      sky(g, x, y, w, h, "#2a3466", "#4a6aa0");
      px(g, "#fffbea", x + 1, y + 1);
      grid(g, ["..f.f..", ".ffffff", "kkkkkkk", ".kkkkk."], { f: "#e0b870", k: "#26263a" }, x, y + 4);
      px(g, "#7fb8e0", x, y + 8, w, 1);
    },
    wizard: () => {
      sky(g, x, y, w, h, "#2b2350", "#4a3a7a");
      grid(g, ["...h...", "..hh...", "..hhh..", ".hhyhh.", "hhhhhhh"], { h: "#3d2f6a", y: "#ffd23f" }, x, y + 2);
      px(g, "#ffd23f", x + 5, y + 1);
      px(g, "#fffbea", x + 1, y + 1);
    },
    spirit: () => {
      sky(g, x, y, w, h, "#9ad0a8", "#5f9e6e");
      grid(g, ["..ww..", ".wwww.", ".wkwk.", ".wwww.", "wwwwww", ".w..w."], { w: "#2b2b3c", k: "#ffffff" }, x, y + 2);
    },
    starry: () => {
      sky(g, x, y, w, h, "#3a2f7a", "#7a5ab0");
      for (const [sx, sy] of [[1, 1], [5, 2], [3, 4], [6, 5]] as const) px(g, "#fff1a8", x + sx, y + sy);
      px(g, "#ffd23f", x + 1, y + 5, 1, 4);
      px(g, "#fff1a8", x, y + 5, 3, 1);
      px(g, "#26263a", x + 4, y + 7, 1, 2);
      px(g, "#e88fa3", x + 5, y + 6, 1, 3);
    },
    snowflake: () => {
      sky(g, x, y, w, h, "#8fc8f0", "#d8f0ff");
      grid(g, ["w.w.w", ".www.", "wwwww", ".www.", "w.w.w"], { w: "#ffffff" }, x + 1, y + 2);
    },
    space: () => {
      sky(g, x, y, w, h, "#12162e", "#2a2f5a");
      ellipse(g, "#e8924a", x + 3, y + 4, 2, 2);
      px(g, "#ffd8a8", x, y + 4, 7, 1);
      for (const [sx, sy] of [[0, 0], [6, 1], [5, 7], [1, 8]] as const) px(g, "#fffbea", x + sx, y + sy);
    },
    lion: () => {
      sky(g, x, y, w, h, "#ffb35a", "#e8604a");
      ellipse(g, "#ffd23f", x + 3, y + 3, 2, 2);
      grid(g, ["....kk.", "...kkkk", "kkkkkkk", "kkkkkkk"], { k: "#3a2a3a" }, x, y + 5);
    },
    lantern: () => {
      sky(g, x, y, w, h, "#1e2450", "#3a3a7a");
      for (const [lx, ly] of [[1, 1], [4, 3], [2, 6], [5, 7]] as const) {
        px(g, "#ffb347", x + lx, y + ly, 2, 2);
        px(g, "#ffe08a", x + lx, y + ly, 1, 1);
      }
    },
    heart: () => {
      sky(g, x, y, w, h, "#ffd1dc", "#f7a6c4");
      grid(g, [".rr.rr.", "rRrrrrr", "rrrrrrr", ".rrrrr.", "..rrr..", "...r..."], { r: "#d9435a", R: "#ff8fa3" }, x, y + 2);
    },
    toy: () => {
      sky(g, x, y, w, h, "#7fc0ec", "#bfe2f8");
      px(g, "#ffffff", x, y + 1, 3, 1);
      px(g, "#ffffff", x + 4, y + 3, 3, 1);
      grid(g, ["..bb...", ".bbbb..", "bbbbbbb"], { b: "#a8783a" }, x, y + 5);
      px(g, "#e0475a", x + 1, y + 8, 5, 1);
    },
    guitar: () => {
      sky(g, x, y, w, h, "#ffa040", "#e05a3a");
      grid(g, ["....n", "...n.", "..n..", ".oo..", "oOoo.", "ooo..", ".o..."], { n: "#3a2a2a", o: "#8a5a3c", O: "#26263a" }, x + 1, y + 1);
    },
  };
  if (kind === "default") return c;
  art[kind]();
  return c;
}

export function artistPoster(kind: ArtistArt): HTMLCanvasElement {
  const { c, g } = frame(13, 15, "#ca8854");
  const [x, y, w, h] = [3, 3, 7, 9];
  const art: Record<Exclude<ArtistArt, "default">, () => void> = {
    oud: () => {
      sky(g, x, y, w, h, "#f6d08a", "#e0965a");
      grid(g, ["....kk", "...k..", "..oo..", ".oOOo.", "oOkOOo", "oOOOOo", ".oooo."], { k: "#3a2a2a", o: "#8a5a3c", O: "#b07a4a" }, x, y + 1);
    },
    piano: () => {
      sky(g, x, y, w, h, "#3a2f5a", "#5a4a8a");
      px(g, "#ffffff", x, y + 4, w, 4);
      for (let i = 1; i < w; i += 2) px(g, "#26263a", x + i, y + 4, 1, 2);
    },
    guitar: () => {
      sky(g, x, y, w, h, "#e8604a", "#ffb35a");
      grid(g, ["....n", "...n.", "..n..", ".oo..", "oOoo.", "ooo..", ".o..."], { n: "#3a2a2a", o: "#e0b870", O: "#26263a" }, x + 1, y + 1);
    },
    violin: () => {
      sky(g, x, y, w, h, "#f2e0c8", "#e0c0a0");
      grid(g, ["...k...", "...k...", "..ooo..", "..oOo..", ".oooo..", ".oOOo..", "..oo..."], { k: "#3a2a2a", o: "#a8502c", O: "#7d3322" }, x, y + 1);
    },
    tarab: () => {
      sky(g, x, y, w, h, "#2b2350", "#5a3a6a");
      grid(g, ["..gg.", ".gGGg", ".gGGg", "..gg.", "...s.", "...s.", "..sss"], { g: "#e0b870", G: "#fff1c4", s: "#c6cbe0" }, x + 1, y + 1);
    },
    band: () => {
      sky(g, x, y, w, h, "#1e1e3a", "#3a2a5a");
      grid(g, ["..y..", ".yyy.", "yyyyy", ".y.y.", "y...y"], { y: "#ffd23f" }, x + 1, y + 2);
    },
  };
  if (kind === "default") return c;
  art[kind]();
  return c;
}

const SNACKS: Record<FoodArt, [string[], Record<string, string>]> = {
  default: [["..cc...", ".cCcc..", "..cccc.", "sssssss", ".sssss."], { c: "#d9a066", C: "#8a5a3c", s: "#e8eaf2" }],
  cookies: [["..cc...", ".cCcc..", "..cccc.", "sssssss", ".sssss."], { c: "#d9a066", C: "#5e3b28", s: "#e8eaf2" }],
  cake: [["..r....", ".wwww..", "wwwwwww", "ppppppp", "kkkkkkk", ".sssss."], { r: "#e0475a", w: "#fff6e8", p: "#f7a6c4", k: "#d9a066", s: "#e8eaf2" }],
  chocolate: [["..o....", ".oCCo..", "oCcCCo.", ".oCCCCo", "..oooo."], { o: INK, C: "#6a3d2a", c: "#8a5a3c" }],
  strawberries: [[".g.g...", "rrgrr..", "rRrrRr.", "sssssss", ".sssss."], { g: LEAF, r: "#e0475a", R: "#ffd23f", s: "#e8eaf2" }],
  donut: [[".pppp..", "pPp.pp.", "pppppp.", ".dddd.."], { p: "#f7a6c4", P: "#ffffff", d: "#d9a066" }],
  croissant: [["..ccc..", ".cCcCc.", "ccCcCcc", ".s...s."], { c: "#e8b060", C: "#c4844a", s: "#e8eaf2" }],
  pizza: [["yyyyyy.", "yryyry.", ".yyry..", "..yy...", "...y..."], { y: "#ffd23f", r: "#d9435a" }],
  icecream: [[".pp....", "pPpp...", ".ww....", ".cc....", "..c...."], { p: "#f7a6c4", P: "#ffffff", w: "#fff6e8", c: "#d9a066" }],
  popcorn: [[".wwww..", "wwwwww.", "rWrWr..", "rWrWr..", "rWrWr.."], { w: "#fff6e8", r: "#e0475a", W: "#ffffff" }],
  fruit: [[".oag...", "oOaAgg.", "bbbbbbb", ".bbbbb."], { o: "#e8924a", O: "#ffb35a", a: "#d9435a", A: "#ff8f8f", g: "#8fb85a", b: "#c4844a" }],
  sweets: [["ooooooo", "oOoOoOo", "ooooooo", "sssssss"], { o: "#e8924a", O: "#ffd23f", s: "#c6cbe0" }],
  koshary: [[".rrrr..", "rbbbbr.", "bbBbbb.", ".bbbb..", "..ss..."], { r: "#c43d3a", b: "#b07a4a", B: "#e0b870", s: "#e8eaf2" }],
  pancakes: [["..y....", "ccccc..", "CCCCC..", "ccccc..", "sssssss"], { y: "#ffd23f", c: "#e8b060", C: "#c4844a", s: "#e8eaf2" }],
};

export function snackSprite(kind: FoodArt): HTMLCanvasElement {
  const [rows, colors] = SNACKS[kind] ?? SNACKS.default;
  return gridSprite(rows, colors);
}

const DRINK_COLORS: Record<Exclude<DrinkArt, "default">, { cup: "glass" | "mug"; liquid: string; top: string; pot: string }> = {
  tea: { cup: "glass", liquid: "#b3472a", top: "#f4d3a0", pot: COLORS.STEEL },
  coffee: { cup: "mug", liquid: "#5e3b28", top: "#c4844a", pot: "#e8eaf2" },
  juice: { cup: "glass", liquid: "#ff9a3a", top: "#ffd08a", pot: "#cfe6f5" },
  lemonade: { cup: "glass", liquid: "#e8e47a", top: "#fffbc4", pot: "#cfe6f5" },
  karkade: { cup: "glass", liquid: "#9e1f3a", top: "#d9435a", pot: "#cfe6f5" },
  milk: { cup: "mug", liquid: "#f2ece0", top: "#8a5a3c", pot: "#e8eaf2" },
  matcha: { cup: "glass", liquid: "#8fbf6a", top: "#d8f0b8", pot: "#cfe6f5" },
  soda: { cup: "glass", liquid: "#4a2a2a", top: "#c6cbe0", pot: "#9e2a40" },
};

export function drinkTray(kind: DrinkArt): HTMLCanvasElement {
  const d = DRINK_COLORS[kind === "default" ? "tea" : kind];
  const rows =
    d.cup === "glass"
      ? ["......oo........", ".....oPPo.......", ".oo.oPPPPoo.oo..", "otto.oPPPo.otto.", "oTTo.oPPPo.oTTo.", "oTTo.ooooo.oTTo.", "oooooooooooooooo", ".oggggggggggggo."]
      : ["......oo........", ".....oPPo.......", ".....oPPPo......", "oooo.oPPPo.oooo.", "otto.oPPPo.otto.", "oTTooooooooTToo.", "oooooooooooooooo", ".oggggggggggggo."];
  return gridSprite(rows, { o: INK, P: d.pot, t: d.top, T: d.liquid, g: COLORS.STEEL_LIGHT });
}

export function recolorBooks(src: HTMLCanvasElement, colors: string[]): HTMLCanvasElement {
  const c = canvas(src.width, src.height);
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  if (!colors.length) return c;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hexAt = (o: number) => "#" + [d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
  const y0 = Math.floor(src.height * 0.55);
  const y1 = Math.floor(src.height * 0.78);
  const frame = new Set<string>();
  for (let y = 0; y < c.height; y++) {
    if (y >= y0 && y < y1) continue;
    for (let x = 0; x < c.width; x++) {
      const o = (y * c.width + x) * 4;
      if (d[o + 3] >= 200) frame.add(hexAt(o));
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < c.width; x++) {
      const o = (y * c.width + x) * 4;
      if (d[o + 3] < 200 || frame.has(hexAt(o))) continue;
      const col = colors[Math.floor(x / 2) % colors.length];
      const lum = (d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11) / 255;
      const out = lum > 0.55 ? lighten(col, Math.min(0.6, (lum - 0.55) * 1.4)) : darken(col, Math.min(0.5, (0.55 - lum) * 0.9));
      const n = parseInt(out.slice(1), 16);
      d[o] = (n >> 16) & 255;
      d[o + 1] = (n >> 8) & 255;
      d[o + 2] = n & 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function cassetteTray(): HTMLCanvasElement {
  return gridSprite([
    "..oooo.oooo",
    "..oppo.obbo",
    ".ooppoooboo",
    "owwwwwwwwwo",
    "oWWWWWWWWWo",
    "ooooooooooo",
  ], { o: INK, p: "#e88fa3", b: "#4985cc", w: GOLD, W: WOOD });
}

export function wrappedCassette(color: string): HTMLCanvasElement {
  return gridSprite([
    "...rr.rr..",
    "....rrr...",
    "ooooorooo.",
    "oppppRpppo",
    "oPPPPrPPPo",
    "orrrrrrrro",
    "oppppRpppo",
    "oooooooooo",
  ], { o: INK, p: color, P: lighten(color, 0.25), r: "#fff6dc", R: "#ffe08a" });
}

export function tinCan(): HTMLCanvasElement {
  return gridSprite([
    "..o..",
    ".ooo.",
    "ossso",
    "oSSSo",
    "orrro",
    "oRRRo",
    "oSSSo",
    ".ooo.",
  ], { o: INK, s: COLORS.STEEL_LIGHT, S: COLORS.STEEL, r: "#e0475a", R: "#b8364a" });
}

export function pinnedRecord(): HTMLCanvasElement {
  return gridSprite([
    "..ooooooo.",
    ".okkkkpppo",
    "okkkkpppppo".slice(0, 10),
    "okkWkpphpo",
    "okkkkphhpo",
    "okkkkpphpo",
    ".okkkpppo.",
    "..ooopppo.",
    ".ooooooooo",
    ".oWWWWWWWo",
  ], { o: INK, k: "#26263a", W: GOLD, p: "#f7a6c4", h: "#d9435a" });
}

export function cushion(color: string): HTMLCanvasElement {
  const c = canvas(16, 6);
  const g = c.getContext("2d")!;
  ellipse(g, INK, 8, 3, 7, 2);
  ellipse(g, color, 8, 2, 6, 1);
  px(g, lighten(color, 0.3), 4, 2, 6, 1);
  px(g, darken(color, 0.25), 3, 4, 10, 1);
  return c;
}

export function anniversaryCake(): HTMLCanvasElement {
  return gridSprite([
    "......y......",
    "......f......",
    "......w......",
    "...ooooooo...",
    "..owwwwwwwo..",
    "..opwpwpwpo..",
    "..opppppppo..",
    "..okkkkkkko..",
    ".ooooooooooo.",
    "oggggggggggo.".slice(0, 13),
    ".ooooooooooo.",
    "....oWWo.....",
    "....oWWo.....",
    "....oWWo.....",
    "....oWWo.....",
    "...oWWWWo....",
    "..oWWWWWWo...",
    "..oooooooo...",
  ], { o: INK, y: "#ffe08a", f: "#ff9a3a", w: "#fff6e8", p: "#f7a6c4", k: "#d9a066", g: COLORS.STEEL_LIGHT, W: WOOD });
}

export function starLantern(): HTMLCanvasElement {
  return gridSprite([
    "....o....",
    "...oyo...",
    "...oyo...",
    "ooooYoooo",
    "oyyYYYyyo",
    ".oyYYYyo.",
    "..oyyyo..",
    ".oyo.oyo.",
    ".oo...oo.",
  ], { o: INK, y: "#ffe9a8", Y: "#fff8dc" });
}

export function roseBouquet(): HTMLCanvasElement {
  const c = canvas(11, 18);
  const g = c.getContext("2d")!;
  grid(g, [
    "..rr...rr..",
    ".rRrr.rRrr.",
    ".rrRr.rrRr.",
    "..rr.r.rr..",
    "...grRrg...",
    "..g.rrr.g..",
    ".gg..g..gg.",
    "....ggg....",
  ], { r: "#d9435a", R: "#9e2a40", g: LEAF });
  grid(g, [
    "...ooooo...",
    "...ovvvo...",
    "..ovVvvvo..",
    "..ovVvvvo..",
    "..ovvvvvo..",
    "..ovvvvvo..",
    "...ovvvo...",
    "...ooooo...",
    "...ooooo...",
    "...ooooo...",
  ].slice(0, 10), { o: INK, v: "#cfe6f5", V: "#ffffff" }, 0, 8);
  return c;
}

export function polaroid(i: number): HTMLCanvasElement {
  const photos = [["#7fb3e0", "#e0b870"], ["#f7a6c4", "#5f9e6e"], ["#ffd08a", "#4985cc"], ["#9b77c4", "#ffe08a"], ["#e8924a", "#447e70"]];
  const [a, b] = photos[i % photos.length];
  return gridSprite(["oooo", "oabo", "obao", "owwo", "oooo"], { o: INK, a, b, w: WHITE });
}

export function banner(): HTMLCanvasElement {
  const c = canvas(40, 9);
  const g = c.getContext("2d")!;
  px(g, INK, 0, 1, 40, 7);
  px(g, "#f7a6c4", 1, 2, 38, 5);
  px(g, "#ffd1dc", 1, 2, 38, 1);
  g.clearRect(0, 3, 2, 3);
  g.clearRect(38, 3, 2, 3);
  px(g, INK, 1, 3, 1, 3);
  px(g, INK, 38, 3, 1, 3);
  for (let i = 0; i < 6; i++) {
    const x = 5 + i * 6;
    if (i % 2 === 0) grid(g, ["r.r", "rrr", ".r."], { r: "#d9435a" }, x, 3);
    else grid(g, [".y.", "yyy", ".y."], { y: "#fff6dc" }, x, 3);
  }
  px(g, INK, 4, 0, 1, 1);
  px(g, INK, 35, 0, 1, 1);
  return c;
}

export function balloons(colors = ["#e0475a", "#ffd23f", "#4985cc"]): HTMLCanvasElement {
  const c = canvas(13, 22);
  const g = c.getContext("2d")!;
  const at: [number, number][] = [[3, 4], [9, 3], [6, 8]];
  for (const [x, y] of at) for (let yy = y + 4; yy < 21; yy++) px(g, "#c6cbe0", Math.round(x + ((6 - x) * (yy - y - 4)) / (21 - y - 4)), yy);
  at.forEach(([x, y], i) => {
    ellipse(g, INK, x, y, 3, 4);
    ellipse(g, colors[i % colors.length], x, y, 2, 3);
    px(g, lighten(colors[i % colors.length], 0.5), x - 1, y - 2, 1, 2);
    px(g, INK, x, y + 4, 1, 1);
  });
  px(g, INK, 5, 21, 3, 1);
  return c;
}

export function lantern(glass = "#ffcf5a"): HTMLCanvasElement {
  return gridSprite([
    "...o...",
    "..ooo..",
    ".ogggo.",
    "ooooooo",
    "oyGyGyo",
    "oGyGyGo",
    "oyGyGyo",
    "ooooooo",
    ".ogggo.",
    "..ooo..",
    "...o...",
  ], { o: INK, g: GOLD, y: glass, G: "#e8604a" });
}

export function crescent(): HTMLCanvasElement {
  return gridSprite([
    "..ooo......",
    ".oyyo......",
    "oyyo....o..",
    "oyyo...oyo.",
    "oyyo..ooyoo",
    "oyyo...oyo.",
    "oyyyo...o..",
    ".oyyyoo....",
    "..oyyyyo...",
    "...ooooo...",
  ], { o: INK, y: "#ffd86a" });
}

export function holidayTree(): HTMLCanvasElement {
  return gridSprite([
    ".......y.......",
    "......yYy......",
    ".......o.......",
    "......ogo......",
    ".....ogggo.....",
    "....ogrgggo....",
    ".....ogggo.....",
    "....oggggbo....",
    "...ogggggggo...",
    "..oggyggggggo..",
    "....ogggggo....",
    "...ogggrggggo..".slice(0, 15),
    "..ogggggggbggo.",
    ".oggbgggggggggo",
    "...ogggggyggo..",
    "..ogggggggggggo".slice(0, 15),
    ".ogggrggggggbggo".slice(0, 15),
    "ooooooooooooooo",
    "......oWo......",
    ".....ooooo.....",
    ".....oPPPo.....",
    ".....oPPPo.....",
    "......ooo......",
  ], { o: INK, g: "#447e70", y: "#ffd23f", Y: "#fff6dc", r: "#e0475a", b: "#4985cc", W: WOOD_DARK, P: "#c4844a" });
}

export const FLAG_COLORS = ["#e0475a", "#ffd23f", "#4985cc", "#5aa37e", "#f7a6c4", "#ff9a3a"];

export const HEART_SMALL = gridSpriteLazy(["o.o", "ooo", ".o."]);

function gridSpriteLazy(rows: string[]) {
  const cache: Record<string, HTMLCanvasElement> = {};
  return (color: string) => (cache[color] ??= gridSprite(rows, { o: color }));
}
