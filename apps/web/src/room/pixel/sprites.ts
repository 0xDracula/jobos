export type SheetName = "interiors" | "builder";
export type Cut = { sheet: SheetName; x: number; y: number; w: number; h: number };
export type Sheets = Record<SheetName, CanvasImageSource>;

const cut = (sheet: SheetName, x: number, y: number, w: number, h: number): Cut => ({ sheet, x, y, w, h });

export const CUTS = {
  bed_teal: cut("interiors", 92, 16, 41, 32),
  bed_white: cut("interiors", 92, 48, 41, 32),
  bookcase: cut("interiors", 80, 224, 32, 32),
  bookcase_b: cut("interiors", 160, 1094, 32, 34),
  window_curtains: cut("interiors", 70, 391, 34, 26),
  window_small: cut("interiors", 52, 217, 25, 15),
  dresser: cut("interiors", 80, 949, 32, 21),
  lamp_cream: cut("interiors", 176, 887, 15, 25),
  lamp_wood: cut("interiors", 193, 904, 13, 33),
  plant_small: cut("interiors", 2, 790, 12, 14),
  plant_bush: cut("interiors", 193, 722, 14, 23),
  plant_tree: cut("interiors", 167, 713, 18, 31),
  plant_palm: cut("interiors", 213, 704, 23, 31),
  pot_qulla: cut("interiors", 1, 1068, 15, 16),
  pot_gold: cut("interiors", 17, 1068, 15, 16),
  pot_bowl: cut("interiors", 1, 1100, 15, 16),
  pot_green: cut("interiors", 17, 1100, 15, 16),
  frame_cat: cut("interiors", 38, 394, 21, 14),
  frame_flowers: cut("interiors", 2, 1226, 13, 15),
  frame_hills: cut("interiors", 2, 1162, 13, 15),
  board: cut("interiors", 208, 616, 31, 21),
  globe: cut("interiors", 209, 577, 13, 21),
  sofa_red: cut("interiors", 128, 288, 48, 26),
  table_low: cut("interiors", 33, 827, 30, 18),
  boxes: cut("interiors", 130, 964, 25, 23),
  cushions_warm: cut("interiors", 176, 1243, 30, 14),
  cushions_cool: cut("interiors", 210, 1243, 27, 14),
  rug_red: cut("interiors", 114, 244, 60, 40),
  rug_blue: cut("interiors", 211, 334, 24, 18),
  rug_green: cut("interiors", 180, 286, 24, 18),
} as const;

export type CutName = keyof typeof CUTS;

export const WALL_BANDS: Record<string, number> = { rose: 80, butter: 112, mint: 144, oak: 176, walnut: 208, cherry: 240, slate: 272, linen: 304 };
export const FLOOR_TILES: Record<string, Cut> = {
  brick: cut("builder", 176, 80, 48, 32),
  tiles: cut("builder", 176, 112, 48, 32),
  aqua: cut("builder", 176, 144, 48, 32),
  concrete: cut("builder", 176, 176, 48, 32),
  parquet: cut("builder", 176, 208, 48, 32),
  oak: cut("builder", 64, 176, 48, 16),
  walnut: cut("builder", 64, 208, 48, 16),
  cherry: cut("builder", 64, 240, 48, 16),
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite sheet ${src} failed to load`));
    img.src = src;
  });
}

export async function loadSheets(base = "/room/limezu"): Promise<Sheets> {
  const [interiors, builder] = await Promise.all([loadImage(`${base}/interiors.png`), loadImage(`${base}/room-builder.png`)]);
  return { interiors, builder };
}

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

type Ctx = CanvasRenderingContext2D;

export const px = (g: Ctx, color: string, x: number, y: number, w = 1, h = 1) => {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
};

export function grid(g: Ctx, rows: readonly string[], colors: Record<string, string>, x = 0, y = 0) {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const c = colors[row[i]];
      if (c) px(g, c, x + i, y + j);
    }
  }
}

export function gridSprite(rows: readonly string[], colors: Record<string, string>): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const c = canvas(w, rows.length);
  grid(c.getContext("2d")!, rows, colors);
  return c;
}

export function ellipse(g: Ctx, color: string, cx: number, cy: number, rx: number, ry: number) {
  g.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.25))));
    g.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

export function outlined(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const c = canvas(src.width + 2, src.height + 2);
  const g = c.getContext("2d")!;
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) g.drawImage(src, dx, dy);
  g.globalCompositeOperation = "source-in";
  px(g, color, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  g.drawImage(src, 1, 1);
  return c;
}

export function cutSprite(sheets: Sheets, c: Cut): HTMLCanvasElement {
  const out = canvas(c.w, c.h);
  out.getContext("2d")!.drawImage(sheets[c.sheet], c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  return out;
}

export const INK = "#3a3a50";
export const INK_2 = "#565972";
const WHITE = "#faf6ee";
const WOOD = "#ca8854";
const WOOD_LIGHT = "#e0b870";
const WOOD_DARK = "#a85f46";
const STEEL = "#a2a8be";
const STEEL_LIGHT = "#c6cbe0";
const STEEL_DARK = "#7c8099";

const CAT_COLORS = { o: INK, f: "#ec9a4f", s: "#c97234", l: "#ffe1b8", p: "#f49ab0", w: "#ffffff" };

const CAT_SIT = [
  "..............",
  ".o.......o....",
  "ofo.....ofo...",
  "ofpooooopfo...",
  "offfsfsfffo...",
  "offfffffffo...",
  "offofffoffo...",
  "offofffoffo...",
  "olfffpffflo...",
  ".offofoffo..o.",
  ".oollllloo.ofo",
  "offlllllffoofo",
  "offslllsffoofo",
  "offfffffffffo.",
  ".ooloooolooo..",
];

const withRows = (base: string[], rows: Record<number, string>) => base.map((r, i) => rows[i] ?? r);

const CAT_YAWN = withRows(CAT_SIT, {
  6: "offfffffffo...",
  7: "ofoofffoofo...",
  8: "olffoooffl o..".replace(" ", "o").slice(0, 14),
  9: ".offpPpffo..o.",
  10: ".oolooolloo.ofo".slice(0, 14),
});

const CAT_BACK = [
  "..............",
  ".o.......o....",
  "ofo.....ofo...",
  "offooooooffo..",
  "offfsfsffffo..",
  "offfffffffffo.",
  "offsfffffsffo.",
  "offfffffffffo.",
  ".offfsfsfffo..",
  "..offfffffo...",
  ".offfsfsfffo..",
  "offfffffffffo.",
  "offsffffffsffo",
  "offfffffffffffo".slice(0, 14),
  ".oooooooooooo.",
];

const CAT_STRETCH = [
  "..................o.",
  ".................ofo",
  "..............oooofo",
  "...o..o......offfffo",
  "..ofoofo....offsfffo",
  "..offfffooooffffsffo",
  ".offfoffffsffffffffo",
  "olffffpfffffsffffffo",
  ".oolllooooooooofffo.",
  "oolllo.........ofo..",
  "ooooo..........oo...",
];
const CAT_STAND = [
  "..................o.",
  ".................ofo",
  "...o..o.........ofo.",
  "..ofoofo.......ofo..",
  "..offfffooooooofo...",
  ".offfofffffsffffo...",
  "olffffpffsfffsffo...",
  ".oolllfffffffffffo..",
  "..olffoooooooolffo..",
  "..ollo........ollo..",
  "..ooo.........ooo...",
];

export function kittenFrames() {
  const blink = withRows(CAT_SIT, { 6: "offfffffffo...", 7: "ofoofffoofo..." });
  const tail = withRows(CAT_SIT, { 9: ".offofoffo....", 10: ".oollllloo..oo", 11: "offlllllffooso", 12: "offslllsffofo." });
  const ear = withRows(CAT_SIT, { 1: ".o............", 2: "ofo.....ooo...", 3: "ofpooooooffo.." .slice(0, 14) });
  const colors = { ...CAT_COLORS, P: "#c45a78" };
  return {
    sit: gridSprite(CAT_SIT, CAT_COLORS),
    blink: gridSprite(blink, CAT_COLORS),
    tail: gridSprite(tail, CAT_COLORS),
    ear: gridSprite(ear, CAT_COLORS),
    yawn: gridSprite(CAT_YAWN, colors),
    back: gridSprite(CAT_BACK, CAT_COLORS),
    stretch: gridSprite(CAT_STRETCH, CAT_COLORS),
    stand: gridSprite(CAT_STAND, CAT_COLORS),
    sleep: gridSprite(CAT_SLEEP, CAT_COLORS),
    sleep2: gridSprite(CAT_SLEEP_2, CAT_COLORS),
  };
}

export type KittenFrames = ReturnType<typeof kittenFrames>;

const CAT_SLEEP = [
  "................",
  "..o..o..........",
  ".ofoofo.........",
  ".offffooooooo...",
  "ofsfsffffsffffo.",
  "ofoofffffffsffo.",
  "olffpfffffffffo.",
  "ollloooolllllfo.",
  ".oooo....ooooo..",
];
const CAT_SLEEP_2 = [
  "................",
  "..o..o..........",
  ".ofoofo.ooooo...",
  ".offffofffffoo..",
  "ofsfsffffsffffo.",
  "ofoofffffffsffo.",
  "olffpfffffffffo.",
  "ollloooolllllfo.",
  ".oooo....ooooo..",
];

const HEART = [".oo.oo.", "opposso", "oppppso", ".oppso.", "..oso..", "...o..."];
export const heartSprite = () => gridSprite(HEART, { o: INK, p: "#ff8fab", s: "#e0607e" });

const SPARKLE = ["..w..", "..y..", "wyWyw", "..y..", "..w.."];
export const sparkleSprite = () => gridSprite(SPARKLE, { w: "#fff3c4", y: "#ffd27a", W: "#ffffff" });

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function widen(src: HTMLCanvasElement, width: number, from: number, to: number): HTMLCanvasElement {
  const c = canvas(width, src.height);
  const g = c.getContext("2d")!;
  const right = src.width - to;
  g.drawImage(src, 0, 0, to, src.height, 0, 0, to, src.height);
  for (let x = to; x < width - right; x += to - from) {
    const w = Math.min(to - from, width - right - x);
    g.drawImage(src, from, 0, w, src.height, x, 0, w, src.height);
  }
  g.drawImage(src, to, 0, right, src.height, width - right, 0, right, src.height);
  return c;
}

export function breakfastTray(): HTMLCanvasElement {
  return gridSprite([
    ".......oo.........",
    "......oSSo........",
    ".oo..oSSSSo.oooo..",
    "otto..oSSo.obbbbo.",
    "oTTo.ooooo.obBBbo.",
    "oTTo.oyWWo..oooo..",
    "ooooooWWWyooojjo.o",
    "oggggggggggggggggo",
    ".oooooooooooooooo.",
  ], { o: INK, S: STEEL, t: "#f4d3a0", T: "#b3472a", g: STEEL_LIGHT, b: "#e0a560", B: "#f2c98a", y: "#ffd23f", W: "#fff6e8", j: "#c43d5a" });
}

export function waterTank(): HTMLCanvasElement {
  const c = canvas(24, 40);
  const g = c.getContext("2d")!;
  px(g, INK, 3, 18, 18, 3);
  px(g, STEEL, 4, 19, 16, 1);
  for (const x of [3, 18]) {
    px(g, INK, x, 21, 3, 19);
    px(g, STEEL, x + 1, 21, 1, 18);
  }
  for (let i = 0; i < 12; i++) {
    px(g, STEEL_DARK, 6 + i, 23 + i, 1, 1);
    px(g, STEEL_DARK, 17 - i, 23 + i, 1, 1);
  }
  ellipse(g, INK, 12, 4, 9, 4);
  px(g, INK, 2, 4, 21, 14);
  ellipse(g, INK, 12, 17, 10, 2);
  ellipse(g, "#2b2b3c", 12, 4, 8, 3);
  px(g, "#2b2b3c", 3, 4, 19, 13);
  ellipse(g, "#2b2b3c", 12, 16, 9, 1);
  px(g, "#3d3d52", 4, 4, 2, 12);
  px(g, "#54546e", 5, 5, 1, 9);
  for (const y of [8, 13]) px(g, "#1f1f2c", 3, y, 19, 1);
  ellipse(g, "#3d3d52", 12, 2, 4, 1);
  px(g, INK, 10, 0, 5, 1);
  px(g, STEEL_DARK, 15, 18, 1, 22);
  return c;
}

export function satelliteDish(): HTMLCanvasElement {
  const c = canvas(16, 18);
  const g = c.getContext("2d")!;
  grid(g, [
    "...oooo.........",
    ".ooggggoo.......",
    "oggwwgggggo.....",
    "ogwwggggggo.....",
    "oggggggggggo....",
    "oggggggggggo....",
    ".ogggggggggo..o.",
    ".oGggggggggo.ogo",
    "..oGGgggggo.ogo.",
    "...ooGGGoo.ogo..",
    ".....oooooogo...",
    "......oSSoo.....",
    ".......oSo......",
    ".......oSo......",
    ".......oSo......",
    ".......oSo......",
    ".....ooSSSoo....",
    ".....ooooooo....",
  ], { o: INK, g: "#d8dbe8", w: "#ffffff", G: STEEL, S: STEEL_DARK });
  return c;
}

export function speaker(): HTMLCanvasElement {
  const c = canvas(18, 26);
  const g = c.getContext("2d")!;
  grid(g, [
    ".oooooooooooooo.",
    ".oKKKKKKKKKKKKo.",
    ".oKkkkkkkkkkkKo.",
    ".oKkooookkkkkKo.",
    ".oKkoGGokkGkkKo.",
    ".oKkoGGokkkkkKo.",
    ".oKkooookkkkkKo.",
    ".oKkkkkkkkkkkKo.",
    ".oKkkoooooookKo.",
    ".oKkoGGGGGGokKo.",
    ".oKkoGGwGGGokKo.",
    ".oKkoGGGGGGokKo.",
    ".oKkkoooooookKo.",
    ".oooooooooooooo.",
  ], { o: INK, K: "#4a4a64", k: "#5d5f7a", G: "#2b2b3c", w: STEEL_LIGHT });
  for (const [y, h] of [[14, 6], [20, 6]] as const) {
    px(g, INK, 0, y, 18, h);
    px(g, WOOD, 1, y + 1, 16, h - 2);
    px(g, WOOD_LIGHT, 1, y + 1, 16, 1);
    px(g, WOOD_DARK, 1, y + h - 2, 16, 1);
    for (const x of [5, 12]) px(g, WOOD_DARK, x, y + 1, 1, h - 2);
  }
  return c;
}

export function teaTray(): HTMLCanvasElement {
  return gridSprite([
    "......oo........",
    ".....oSSo.......",
    ".oo.oSSSSoo.oo..",
    "otto.oSSSo.otto.",
    "oTTo.oSSSo.oTTo.",
    "oTTo.ooooo.oTTo.",
    "ooooooooooooooooo".slice(0, 16),
    ".oggggggggggggo.",
  ], { o: INK, S: STEEL, t: "#f4d3a0", T: "#b3472a", g: STEEL_LIGHT });
}

export function petBed(accent: string): HTMLCanvasElement {
  const c = canvas(20, 9);
  const g = c.getContext("2d")!;
  ellipse(g, INK, 10, 4, 9, 4);
  ellipse(g, accent, 10, 4, 8, 3);
  ellipse(g, "#fff1dc", 10, 5, 6, 2);
  px(g, mixHex(accent, "#ffffff", 0.35), 4, 2, 12, 1);
  return c;
}

export function fairyJar(): HTMLCanvasElement {
  return gridSprite([
    "..oooo..",
    "..oSSo..",
    ".oggggo.",
    "ogyggygo",
    "oggyyggo",
    "ogyggygo",
    "oggggggo",
    ".oooooo.",
  ], { o: INK, S: WOOD, g: "#cfe6f5", y: "#fff1a8" });
}

export function moonLamp(): HTMLCanvasElement {
  return gridSprite([
    "..oooo..",
    ".oyyyyo.",
    "oyYyyyyo",
    "oyyyyYyo",
    "oyyYyyyo",
    ".oyyyyo.",
    "..oooo..",
    "...oo...",
    ".oSSSSo.",
    ".oooooo.",
  ], { o: INK, y: "#fff1c4", Y: "#e8d49a", S: WOOD });
}

export function hangingPlant(): HTMLCanvasElement {
  return gridSprite([
    ".....o......",
    ".....o......",
    "....ooo.....",
    "...o...o....",
    "..ooooooo...",
    "..oPPPPPo...",
    ".lLoPPPoLl..",
    "lLl.ooo.lLl.",
    "Ll.......Ll.",
    "l.........L.",
    "L.........l.",
  ], { o: INK, P: "#e8a77a", l: "#6fb07a", L: "#447e70" });
}

export function beanBag(accent: string): HTMLCanvasElement {
  const c = canvas(20, 14);
  const g = c.getContext("2d")!;
  ellipse(g, INK, 10, 8, 9, 5);
  ellipse(g, accent, 10, 8, 8, 4);
  ellipse(g, mixHex(accent, "#ffffff", 0.3), 8, 6, 4, 2);
  px(g, mixHex(accent, INK, 0.3), 3, 11, 14, 1);
  return c;
}

export function discoBall(): HTMLCanvasElement {
  const c = canvas(12, 18);
  const g = c.getContext("2d")!;
  px(g, INK, 5, 0, 1, 6);
  ellipse(g, INK, 5, 11, 5, 5);
  ellipse(g, "#c6cbe0", 5, 11, 4, 4);
  for (let y = 7; y <= 15; y += 2) for (let x = 2; x <= 9; x += 2) px(g, (x + y) % 4 === 0 ? "#ffffff" : "#9097b1", x, y);
  return c;
}

export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export const COLORS = { WHITE, WOOD, WOOD_LIGHT, WOOD_DARK, STEEL, STEEL_LIGHT, STEEL_DARK };
