import type { Weather } from "@/lib/types";

import type { Season } from "../calendar";
import { DECORATIONS, placementOf, type RoomLayout } from "../layout";
import { mixHex, skyPoint, type SkyState } from "../sky";
import * as S from "./scene";
import {
  beanBag,
  canvas,
  CUTS,
  cutSprite,
  discoBall,
  ellipse,
  fairyJar,
  FLOOR_TILES,
  hangingPlant,
  heartSprite,
  INK,
  kittenFrames,
  moonLamp,
  petBed,
  px,
  recordPlayer,
  satelliteDish,
  sparkleSprite,
  speaker,
  teaTray,
  WALL_BANDS,
  waterTank,
  type CutName,
  type Sheets,
} from "./sprites";

export type RoomInput = {
  sky: SkyState;
  weather: Weather | null;
  season: Season | null;
  layout: RoomLayout;
  plantStage: number;
  unlocked: Set<string>;
  notes: Set<string>;
  accent: string | null;
  lampOn: boolean;
  otherSky: SkyState | null;
  weekendTray: boolean;
  highlight: string | null;
  selected: string | null;
  reducedMotion: boolean;
};

export type FrameInput = { awake: boolean; pets: number; pulse: number; playing: number };

type Cache = { key: string; canvas: HTMLCanvasElement };

const GLASS = new Set(["#c4dae8", "#cfe6f5", "#dbeef9", "#b9d4e6", "#e3f3fb", "#a9cbe0", "#d5ecf7", "#bfdcea"]);

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const CITY = { x: -260, y: -40, w: 840, h: 700 };
const WORLD = { x: -16, y: 40, w: 352, h: 620 };

type NearBuilding = { x: number; w: number; top: number; face: number; roof: "tank" | "dish" | "laundry" | "antenna" | "" };

export class PixelRenderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private sheets: Sheets;
  private sprites = new Map<string, HTMLCanvasElement>();
  private kitten: ReturnType<typeof kittenFrames>;
  private heart: HTMLCanvasElement;
  private sparkle: HTMLCanvasElement;
  private input: RoomInput | null = null;

  cam = { x: 0, y: 0, w: 1, h: 1, scale: 1, dpr: 1 };
  private userPan: number | null = null;
  private buf = canvas(1, 1);
  private bg: CanvasRenderingContext2D;
  private world = canvas(1, 1);
  private wg: CanvasRenderingContext2D;
  private city = canvas(1, 1);
  private cg: CanvasRenderingContext2D;

  private skyCache: Cache | null = null;
  private cityCache: (Cache & { lights: HTMLCanvasElement }) | null = null;
  private worldCache: Cache | null = null;
  private cloudCache: (Cache & { sprites: HTMLCanvasElement[] }) | null = null;

  private far: { x: number; w: number; h: number }[] = [];
  private near: NearBuilding[] = [];
  private stars: { x: number; y: number; v: number; p: number; big: boolean }[] = [];
  private drops: { x: number; y: number; v: number; s: number }[] = [];
  private hearts: { born: number; dx: number }[] = [];
  private lastPets = 0;
  private shooting = { start: -1, next: 25, x: 0, y: 0 };
  private storm = { start: -1, next: 12 };
  private moonPos: { x: number; y: number } | null = null;
  private starPos: { x: number; y: number } | null = null;
  private kittenPos = { x: S.KITTEN.asleep.x, y: S.KITTEN.asleep.y, w: 16, h: 9 };
  private last = 0;

  constructor(target: HTMLCanvasElement, sheets: Sheets) {
    this.canvas = target;
    this.g = target.getContext("2d")!;
    this.sheets = sheets;
    this.bg = this.buf.getContext("2d")!;
    this.wg = this.world.getContext("2d")!;
    this.cg = this.city.getContext("2d")!;
    this.kitten = kittenFrames();
    this.heart = heartSprite();
    this.sparkle = sparkleSprite();
    for (const name of Object.keys(CUTS) as CutName[]) this.sprites.set(name, cutSprite(sheets, CUTS[name]));
    this.clearGlass("window_curtains");
    this.clearGlass("window_small");
    this.sprites.set("water_tank", waterTank());
    this.sprites.set("satellite_dish", satelliteDish());
    this.sprites.set("speaker", speaker());
    this.sprites.set("tea_tray", teaTray());
    this.sprites.set("fairy_jar", fairyJar());
    this.sprites.set("moon_lamp", moonLamp());
    this.sprites.set("hanging_plant", hangingPlant());
    this.sprites.set("disco_ball", discoBall());
    this.buildCity();
    const r = rng(42);
    for (let i = 0; i < 260; i++) this.stars.push({ x: -260 + r() * 840, y: -420 + r() * 520, v: 0.5 + r() * 2, p: r() * 6.3, big: r() < 0.08 });
    const d = rng(7);
    for (let i = 0; i < 160; i++) this.drops.push({ x: d() * 900, y: d() * 900, v: 90 + d() * 60, s: d() });
  }

  private clearGlass(name: string) {
    const c = this.sprites.get(name);
    if (!c) return;
    const g = c.getContext("2d")!;
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      const h = hex(d[i], d[i + 1], d[i + 2]);
      const blue = d[i + 2] >= d[i] + 8 && d[i + 2] > 190 && d[i + 1] > 180;
      if (GLASS.has(h) || blue) d[i + 3] = 0;
    }
    g.putImageData(img, 0, 0);
  }

  setInput(input: RoomInput) {
    const prev = this.input;
    this.input = input;
    if (!prev || prev.layout !== input.layout || prev.plantStage !== input.plantStage || prev.unlocked !== input.unlocked || prev.weekendTray !== input.weekendTray || !prev.otherSky !== !input.otherSky) {
      this.worldCache = null;
    }
  }

  resize(cssW: number, cssH: number, dpr: number, inset: number) {
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    const portrait = cssW < cssH * 0.9;
    let scale = Math.max(1, Math.round(dw / (portrait ? 160 : S.SCENE_W + 24)));
    const fitsHeight = (k: number) => Math.ceil(dh / k) - Math.ceil((inset * dpr) / k) >= 150;
    while (scale > 1 && !fitsHeight(scale)) scale--;
    const w = Math.ceil(dw / scale);
    const h = Math.ceil(dh / scale);
    const insetScene = Math.ceil((inset * dpr) / scale);
    if (this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas.width = dw;
      this.canvas.height = dh;
    }
    if (this.buf.width !== w || this.buf.height !== h) {
      this.buf.width = this.world.width = this.city.width = w;
      this.buf.height = this.world.height = this.city.height = h;
    }
    const changed = w !== this.cam.w || h !== this.cam.h || scale !== this.cam.scale;
    this.cam.w = w;
    this.cam.h = h;
    this.cam.scale = scale;
    this.cam.dpr = dpr;
    this.cam.y = S.BASE_BOTTOM + insetScene - h;
    this.placeCamera();
    if (changed) this.skyCache = null;
  }

  private placeCamera() {
    const { w } = this.cam;
    if (w >= S.SCENE_W + 8) {
      this.cam.x = Math.round((S.SCENE_W - w) / 2);
      return;
    }
    const min = -6;
    const max = S.SCENE_W + 6 - w;
    const want = this.userPan ?? min;
    this.cam.x = Math.round(Math.min(max, Math.max(min, want)));
  }

  panBy(dxCss: number): boolean {
    if (this.cam.w >= S.SCENE_W + 8) return false;
    const before = this.cam.x;
    this.userPan = this.cam.x - (dxCss * this.cam.dpr) / this.cam.scale;
    this.placeCamera();
    this.userPan = this.cam.x;
    return this.cam.x !== before;
  }

  reveal(id: string) {
    const a = this.anchorScene(id);
    if (!a || this.cam.w >= S.SCENE_W + 8) return;
    if (a.x < this.cam.x + 16 || a.x > this.cam.x + this.cam.w - 16) {
      this.userPan = Math.round(a.x - this.cam.w / 2);
      this.placeCamera();
    }
  }

  canPan() {
    return this.cam.w < S.SCENE_W + 8;
  }

  hiddenSides(): { room: boolean; roof: boolean } {
    if (!this.canPan()) return { room: false, roof: false };
    return { room: this.cam.x > 40, roof: this.cam.x + this.cam.w < S.ROOF_X1 - 30 };
  }

  show(side: "room" | "roof") {
    this.userPan = side === "room" ? -6 : S.SCENE_W;
    this.placeCamera();
    this.userPan = this.cam.x;
  }

  private anchorScene(id: string): { x: number; y: number } | null {
    if (id === "moon") return this.moonPos;
    if (id === "shooting_star") return this.starPos;
    if (id === "kitten") return { x: this.kittenPos.x + this.kittenPos.w / 2, y: this.kittenPos.y };
    const a = S.ANCHORS[id];
    return a ? { x: a[0], y: a[1] } : null;
  }

  anchor(id: string): { x: number; y: number } | null {
    const a = this.anchorScene(id);
    if (!a) return null;
    const k = this.cam.scale / this.cam.dpr;
    const x = (a.x - this.cam.x) * k;
    const y = (a.y - this.cam.y) * k;
    const cssW = this.canvas.width / this.cam.dpr;
    const cssH = this.canvas.height / this.cam.dpr;
    if (x < 8 || y < 8 || x > cssW - 8 || y > cssH - 8) return null;
    return { x, y };
  }

  hit(cssX: number, cssY: number, ids: string[]): string | null {
    const k = this.cam.dpr / this.cam.scale;
    const sx = this.cam.x + cssX * k;
    const sy = this.cam.y + cssY * k;
    const kp = this.kittenPos;
    if (ids.includes("kitten") && sx >= kp.x - 3 && sx <= kp.x + kp.w + 3 && sy >= kp.y - 3 && sy <= kp.y + kp.h + 3) return "kitten";
    if (ids.includes("moon") && this.moonPos && Math.hypot(sx - this.moonPos.x, sy - this.moonPos.y) < 10) return "moon";
    for (const id of ids) {
      const r = S.HIT[id];
      if (r && sx >= r[0] && sx <= r[0] + r[2] && sy >= r[1] && sy <= r[1] + r[3]) return id;
    }
    return null;
  }

  private buildCity() {
    const r = rng(11);
    for (let x = CITY.x; x < CITY.x + CITY.w; ) {
      const w = 8 + Math.floor(r() * 20);
      this.far.push({ x, w, h: 10 + Math.floor(r() * 34) });
      x += w;
    }
    const n = rng(29);
    const roofs: NearBuilding["roof"][] = ["tank", "dish", "laundry", "antenna", "", "tank", "dish"];
    for (let x = CITY.x; x < CITY.x + CITY.w; ) {
      const w = 26 + Math.floor(n() * 46);
      const gap = n() < 0.35 ? 6 + Math.floor(n() * 18) : 0;
      const behind = x + w > -10 && x < S.SCENE_W + 10;
      const window = x + w > 48 && x < 100;
      const top = window ? 118 : behind ? 44 + Math.floor(n() * 50) : 70 + Math.floor(n() * 70);
      this.near.push({ x, w, top, face: Math.floor(n() * 4), roof: roofs[Math.floor(n() * roofs.length)] });
      x += w + gap;
    }
  }

  private cityKey(sky: SkyState) {
    const q = (c: string) => c.slice(0, 6);
    return `${q(sky.horizon)}|${q(sky.tint)}|${Math.round(sky.night * 10)}`;
  }

  private drawCity(sky: SkyState) {
    const key = this.cityKey(sky);
    if (this.cityCache?.key === key) return this.cityCache;
    const c = this.cityCache?.canvas ?? canvas(CITY.w, CITY.h);
    const lights = this.cityCache?.lights ?? canvas(CITY.w, CITY.h);
    const g = c.getContext("2d")!;
    const lg = lights.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    lg.clearRect(0, 0, lights.width, lights.height);
    const ox = -CITY.x;
    const oy = -CITY.y;
    const H = S.HORIZON + oy;
    const far = mixHex(sky.horizon, "#232847", 0.42 + sky.night * 0.25);
    for (const b of this.far) px(g, far, b.x + ox, H - b.h, b.w, 40);
    const minaret = (x: number, top: number) => {
      const t = top + oy;
      px(g, far, x + ox, t, 1, 3);
      px(g, far, x - 1 + ox, t + 3, 3, 5);
      px(g, far, x - 2 + ox, t + 8, 5, 1);
      px(g, far, x - 1 + ox, t + 9, 3, 12);
      px(g, far, x - 2 + ox, t + 21, 5, 1);
      px(g, far, x - 2 + ox, t + 22, 5, H - t);
    };
    const dome = (cx: number, r: number) => {
      const base = H - 16;
      px(g, far, cx - r - 3 + ox, base, r * 2 + 7, 30);
      ellipse(g, far, cx + ox, base, r, r);
      px(g, far, cx + ox, base - r - 4, 1, 4);
    };
    minaret(30, 36);
    minaret(228, 26);
    minaret(-150, 44);
    minaret(470, 40);
    dome(110, 12);
    dome(392, 10);
    {
      const x = 300 + ox;
      const t = 52 + oy;
      px(g, far, x + 4, t, 1, 3);
      px(g, far, x + 1, t + 3, 7, 3);
      px(g, far, x, t + 6, 9, 12);
      for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) g.clearRect(x + 2 + i * 2, t + 8 + j * 2, 1, 1);
      px(g, far, x + 1, t + 18, 1, 40);
      px(g, far, x + 7, t + 18, 1, 40);
    }
    const lit = mixHex("#ffd27a", far, 0.25);
    const lr = rng(5);
    for (const b of this.far) {
      for (let i = 0; i < b.w * b.h * 0.02; i++) {
        const on = lr() < sky.night * 0.7;
        const wx = b.x + 2 + Math.floor(lr() * Math.max(1, b.w - 4));
        const wy = S.HORIZON - b.h + 3 + Math.floor(lr() * Math.max(1, b.h - 4));
        if (on) px(lg, lit, wx + ox, wy + oy, 1, 1);
      }
    }
    const faces = ["#8d7f88", "#7c7d96", "#9a8a7c", "#6f7a8c"];
    const wr = rng(17);
    for (const b of this.near) {
      const face = faces[b.face];
      const x = b.x + ox;
      const t = b.top + oy;
      px(g, INK, x, t, b.w, CITY.h);
      px(g, face, x + 1, t + 1, b.w - 2, CITY.h);
      px(g, mixHex(face, "#ffffff", 0.18), x + 1, t + 1, b.w - 2, 2);
      px(g, mixHex(face, INK, 0.22), x + b.w - 4, t + 3, 3, CITY.h);
      for (let wy = t + 8; wy < CITY.h; wy += 12) {
        for (let wx = x + 5; wx + 6 < x + b.w - 4; wx += 10) {
          const r1 = wr();
          const r2 = wr();
          px(g, INK, wx - 1, wy - 1, 6, 8);
          const on = r1 < 0.15 + sky.night * 0.5;
          const glass = mixHex("#9fb4c9", sky.horizon, 0.4);
          px(g, glass, wx, wy, 4, 6);
          if (on && sky.night > 0.15) px(lg, r2 < 0.25 ? "#ffe6a0" : r2 < 0.5 ? "#ffd08a" : "#f6b56a", wx, wy, 4, 6);
          else if (r2 < 0.3) px(g, "#c9a7a0", wx, wy, 4, 2);
        }
      }
      const rx = x + 6;
      if (b.roof === "tank") {
        px(g, INK, rx, t - 11, 12, 9);
        px(g, "#2b2b3c", rx + 1, t - 10, 10, 7);
        px(g, "#3d3d52", rx + 2, t - 10, 2, 6);
        px(g, INK, rx + 2, t - 2, 1, 2);
        px(g, INK, rx + 9, t - 2, 1, 2);
      } else if (b.roof === "dish") {
        ellipse(g, INK, rx + 4, t - 6, 4, 3);
        ellipse(g, "#cfd2e0", rx + 4, t - 6, 3, 2);
        px(g, INK, rx + 4, t - 3, 1, 3);
      } else if (b.roof === "laundry") {
        px(g, INK, rx, t - 10, 1, 10);
        px(g, INK, rx + 22, t - 10, 1, 10);
        px(g, INK, rx, t - 10, 23, 1);
        const colors = ["#e88fa3", "#faf6ee", "#4985cc", "#e0b870", "#447e70"];
        for (let i = 0; i < 4; i++) px(g, colors[(b.x + i) % colors.length], rx + 2 + i * 5, t - 9, 3, 4 + (i % 2) * 2);
      } else if (b.roof === "antenna") {
        px(g, INK, rx + 3, t - 14, 1, 14);
        px(g, INK, rx, t - 12, 7, 1);
        px(g, INK, rx + 1, t - 9, 5, 1);
      }
    }
    this.cityCache = { key, canvas: c, lights };
    return this.cityCache;
  }

  private tileRect(g: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number) {
    const t = FLOOR_TILES[name] ?? FLOOR_TILES.walnut;
    const img = this.sheets[t.sheet];
    for (let ty = 0; ty < h; ty += t.h) {
      for (let tx = 0; tx < w; tx += t.w) {
        const cw = Math.min(t.w, w - tx);
        const ch = Math.min(t.h, h - ty);
        g.drawImage(img, t.x, t.y, cw, ch, x + tx, y + ty, cw, ch);
      }
    }
  }

  private wall(g: CanvasRenderingContext2D, style: string, x: number, y: number, w: number) {
    const by = WALL_BANDS[style] ?? WALL_BANDS.slate;
    const img = this.sheets.builder;
    for (let tx = 0; tx < w; tx += 16) {
      const cw = Math.min(16, w - tx);
      g.drawImage(img, 16, by, cw, 6, x + tx, y, cw, 6);
      g.drawImage(img, 80, by, cw, 16, x + tx, y + 6, cw, 16);
      g.drawImage(img, 16, by + 6, cw, 26, x + tx, y + 22, cw, 26);
    }
    px(g, INK, x, y, 1, 48);
    px(g, INK, x + w - 1, y, 1, 48);
  }

  private wallTop(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    px(g, INK, x, y, w, h);
    px(g, "#f8f8f8", x + 1, y + 1, w - 2, h - 2);
  }

  private sprite(name: string): HTMLCanvasElement | undefined {
    return this.sprites.get(name);
  }

  private put(g: CanvasRenderingContext2D, name: string, x: number, y: number, flip = false) {
    const s = this.sprite(name);
    if (!s) return;
    if (!flip) {
      g.drawImage(s, Math.round(x), Math.round(y));
      return;
    }
    g.save();
    g.translate(Math.round(x) + s.width, Math.round(y));
    g.scale(-1, 1);
    g.drawImage(s, 0, 0);
    g.restore();
  }

  private drawWorld(input: RoomInput) {
    const { layout } = input;
    const key = `${layout.look.wall}|${layout.look.floor}|${layout.look.accent}|${input.plantStage}|${[...input.unlocked].sort().join(",")}|${input.weekendTray}|${!!input.otherSky}|${JSON.stringify(layout.items)}`;
    if (this.worldCache?.key === key) return this.worldCache.canvas;
    const c = this.worldCache?.canvas ?? canvas(WORLD.w, WORLD.h);
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.translate(-WORLD.x, -WORLD.y);

    const facade = "#6d6478";
    px(g, INK, -1, S.FRONT_Y + 6, S.SCENE_W + 2, WORLD.h);
    px(g, facade, 0, S.FRONT_Y + 7, S.SCENE_W, WORLD.h);
    px(g, mixHex(facade, "#ffffff", 0.12), 0, S.FRONT_Y + 7, S.SCENE_W, 1);
    const fr = rng(3);
    for (let y = S.FRONT_Y + 22; y < WORLD.y + WORLD.h; y += 30) {
      for (let x = 22; x < S.SCENE_W - 20; x += 48) {
        px(g, INK, x - 1, y - 1, 18, 20);
        px(g, "#3d4361", x, y, 16, 18);
        px(g, "#58607e", x + 1, y + 1, 14, 2);
        if (fr() < 0.35) {
          px(g, INK, x + 18, y + 4, 10, 8);
          px(g, "#c9cbd8", x + 19, y + 5, 8, 6);
          px(g, "#9097b1", x + 20, y + 7, 6, 1);
        }
        px(g, INK, x - 2, y + 18, 20, 2);
      }
    }

    this.tileRect(g, layout.look.floor, S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.FLOOR_Y);
    this.tileRect(g, "concrete", S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, S.FRONT_Y - S.FLOOR_Y);
    px(g, "rgba(58,58,80,0.18)", S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, 3);
    px(g, "rgba(58,58,80,0.18)", S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, 3);
    px(g, INK, 0, S.FRONT_Y, S.SCENE_W, 7);
    px(g, "#c9cbd3", 0, S.FRONT_Y + 1, S.SCENE_W, 3);
    px(g, "#9a9cab", 0, S.FRONT_Y + 4, S.SCENE_W, 2);

    this.wall(g, layout.look.wall, S.ROOM_X0, S.WALL_TOP, S.DIVIDER_X - S.ROOM_X0);
    this.wallTop(g, 0, S.WALL_TOP, S.ROOM_X0 + 1, S.FRONT_Y - S.WALL_TOP + 1);
    this.wallTop(g, S.DIVIDER_X, S.WALL_TOP, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y0 - S.WALL_TOP);
    this.wallTop(g, S.DIVIDER_X, S.DOOR_Y1, S.ROOF_X0 - S.DIVIDER_X, S.FRONT_Y - S.DOOR_Y1 + 1);
    px(g, "#b5754d", S.DIVIDER_X, S.DOOR_Y0, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y1 - S.DOOR_Y0);
    px(g, "#ca8854", S.DIVIDER_X + 1, S.DOOR_Y0 + 1, S.ROOF_X0 - S.DIVIDER_X - 2, S.DOOR_Y1 - S.DOOR_Y0 - 2);

    const py = S.PARAPET_Y;
    px(g, INK, S.ROOF_X0 - 1, py, S.SCENE_W - S.ROOF_X0 + 1, S.FLOOR_Y - py + 1);
    px(g, "#d6d3dc", S.ROOF_X0, py + 1, S.SCENE_W - S.ROOF_X0 - 1, 3);
    px(g, INK, S.ROOF_X0, py + 4, S.SCENE_W - S.ROOF_X0, 1);
    px(g, "#b3b0bf", S.ROOF_X0, py + 5, S.SCENE_W - S.ROOF_X0 - 1, S.FLOOR_Y - py - 5);
    for (let x = S.ROOF_X0 + 4; x < S.SCENE_W - 8; x += 10) {
      px(g, "#7d7a8f", x, py + 8, 7, 7);
      px(g, "#5d5a70", x, py + 8, 7, 1);
      px(g, "#5d5a70", x, py + 8, 1, 7);
      px(g, "#c9c6d3", x + 3, py + 11, 1, 1);
    }
    px(g, "#9c99aa", S.ROOF_X0, S.FLOOR_Y - 2, S.SCENE_W - S.ROOF_X0 - 1, 2);
    this.wallTop(g, S.ROOF_X1, py, S.SCENE_W - S.ROOF_X1, S.FRONT_Y - py + 1);

    const F = S.FURNITURE;
    this.put(g, F.window.sprite, F.window.x, F.window.y);
    this.put(g, F.frame.sprite, F.frame.x, F.frame.y);
    this.put(g, F.flowers.sprite, F.flowers.x, F.flowers.y);
    if (input.otherSky) this.put(g, F.second_window.sprite, F.second_window.x, F.second_window.y);
    else this.put(g, "frame_hills", F.second_window.x + 6, F.second_window.y);
    this.put(g, F.dish.sprite, F.dish.x, F.dish.y);

    const decos = DECORATIONS.filter((d) => !d.unlock || input.unlocked.has(d.unlock)).map((d) => ({ d, p: placementOf(d, layout.items[d.id]) })).filter(({ p }) => !p.hidden);
    for (const { p } of decos.filter(({ p }) => p.sprite.startsWith("rug"))) {
      const s = this.sprite(p.sprite);
      if (s) this.put(g, p.sprite, p.x - s.width / 2, p.y - s.height / 2, p.flip);
    }

    type Item = { bottom: number; draw: () => void };
    const items: Item[] = [];
    const add = (name: string, x: number, y: number, flip = false) => {
      const s = this.sprite(name);
      if (s) items.push({ bottom: y + s.height, draw: () => this.put(g, name, x, y, flip) });
    };
    for (const id of ["dresser", "bed", "lamp", "bookcase", "plant_shelf", "tank", "speaker", "table", "pet_bed"] as const) {
      const f = F[id];
      if (id === "pet_bed") {
        const bed = petBed(layout.look.accent);
        items.push({ bottom: f.y + bed.height, draw: () => g.drawImage(bed, f.x, f.y) });
      } else add(f.sprite, f.x, f.y);
    }
    if (input.weekendTray) add(F.tray.sprite, F.tray.x, F.tray.y);
    else {
      const s = this.sprite("tea_tray")!;
      items.push({ bottom: 999, draw: () => g.drawImage(s, 0, 0, 16, 6, F.tray.x, F.tray.y + 2, 16, 6) });
    }
    const stage = S.PLANT_STAGES[Math.max(0, Math.min(S.PLANT_STAGES.length - 1, input.plantStage))];
    let px0 = S.PLANTS.x;
    for (const name of stage) {
      const s = this.sprite(name);
      if (!s) continue;
      add(name, px0, S.PLANTS.base - s.height);
      px0 += s.width - 2;
    }
    for (const { d, p } of decos) {
      if (p.sprite.startsWith("rug")) continue;
      if (d.id === "bunting") continue;
      const name = p.sprite === "bean_bag" ? "__bean" : p.sprite;
      const s = name === "__bean" ? beanBag(layout.look.accent) : this.sprite(name);
      if (!s) continue;
      if (d.id === "hanging_plant") {
        items.push({ bottom: -1, draw: () => this.put(g, name, p.x - s.width / 2, S.WALL_TOP + 6, p.flip) });
        continue;
      }
      const x = p.x - s.width / 2;
      const y = p.y - s.height;
      items.push({ bottom: p.y, draw: () => (name === "__bean" ? g.drawImage(s, Math.round(x), Math.round(y)) : this.put(g, name, x, y, p.flip)) });
    }
    items.sort((a, b) => a.bottom - b.bottom);
    for (const it of items) it.draw();

    const bunting = decos.find(({ d }) => d.id === "bunting");
    if (bunting) {
      const colors = [layout.look.accent, "#faf6ee", "#e0b870", "#4985cc"];
      const [x0, y0, x1, y1] = [S.ROOF_X0 + 2, 92, 282, 88];
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / (x1 - x0);
        px(g, INK, x, Math.round(y0 + (y1 - y0) * u + 8 * 4 * u * (1 - u)));
      }
      for (let x = x0 + 6, i = 0; x < x1 - 4; x += 9, i++) {
        const u = (x - x0) / (x1 - x0);
        const y = Math.round(y0 + (y1 - y0) * u + 8 * 4 * u * (1 - u)) + 1;
        const col = colors[i % colors.length];
        for (let j = 0; j < 5; j++) px(g, j === 0 ? INK : col, x - 2 + Math.floor(j / 2), y + j, 5 - j, 1);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.worldCache = { key, canvas: c };
    return c;
  }

  private drawSky(sky: SkyState, weather: Weather | null) {
    const { w, h, y: top } = this.cam;
    const grey = weather && ["rain", "drizzle", "thunderstorm", "fog"].includes(weather.condition);
    const cover = grey ? 0.45 : weather?.condition === "clouds" ? 0.2 : 0;
    const key = `${w}x${h}@${top}|${sky.top}|${sky.horizon}|${cover}`;
    if (this.skyCache?.key === key) return this.skyCache.canvas;
    const c = this.skyCache?.canvas.width === w && this.skyCache.canvas.height === h ? this.skyCache.canvas : canvas(w, h);
    const g = c.getContext("2d")!;
    const toGrey = (col: string) => (cover ? mixHex(col, sky.night > 0.5 ? "#1d2131" : "#8e94a1", cover) : col);
    const stops = [toGrey(sky.top), toGrey(mixHex(sky.top, sky.horizon, 0.45)), toGrey(sky.horizon)];
    const N = 8;
    const bands = Array.from({ length: N }, (_, i) => {
      const t = i / (N - 1);
      return t < 0.6 ? mixHex(stops[0], stops[1], t / 0.6) : mixHex(stops[1], stops[2], (t - 0.6) / 0.4);
    });
    const rgb = bands.map((b) => [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)));
    const img = g.createImageData(w, h);
    const d = img.data;
    const y0 = S.HORIZON - 150;
    for (let row = 0; row < h; row++) {
      const sy = top + row;
      const p = Math.max(0, Math.min(1, (sy - y0) / (S.HORIZON - y0))) * (N - 1);
      const i = Math.min(N - 2, Math.floor(p));
      const f = p - i;
      for (let x = 0; x < w; x++) {
        const col = f * 16 > BAYER[(sy & 3) * 4 + ((x + this.cam.x) & 3)] + 0.5 ? rgb[i + 1] : rgb[i];
        const o = (row * w + x) * 4;
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.skyCache = { key, canvas: c };
    return c;
  }

  private skyY(altitude: number) {
    const topY = Math.max(this.cam.y + 16, -260);
    const span = S.HORIZON - 12 - topY;
    return S.HORIZON - 12 - (Math.max(0, altitude) / 90) * span;
  }

  private drawMoon(g: CanvasRenderingContext2D, sky: SkyState, x: number, y: number) {
    const r = 6;
    const { phase } = sky.moon;
    const k = Math.cos(2 * Math.PI * phase);
    const waxing = phase < 0.5;
    const moon = "#f7f0d6";
    const dark = mixHex(moon, sky.top, 0.78);
    const glow = g.createRadialGradient(x + 0.5, y + 0.5, r - 1, x + 0.5, y + 0.5, r * 3.5);
    glow.addColorStop(0, rgba(moon, 0.25 * sky.night));
    glow.addColorStop(1, rgba(moon, 0));
    g.fillStyle = glow;
    g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    const day = sky.night < 0.4;
    g.globalAlpha = day ? 0.7 : 1;
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.sqrt(r * r - dy * dy);
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r * 0.6) continue;
        const lit = waxing ? dx > k * half - 0.5 : dx < -k * half + 0.5;
        if (lit) px(g, moon, x + dx, y + dy);
        else if (!day) px(g, dark, x + dx, y + dy);
      }
    }
    g.globalAlpha = 1;
    if (sky.moon.fraction > 0.3) {
      px(g, "#e3d9b8", x - 2, y - 1, 2, 2);
      px(g, "#e3d9b8", x + 2, y + 2, 1, 1);
    }
  }

  private cloudSprites(sky: SkyState, weather: Weather | null) {
    const heavy = weather && ["rain", "drizzle", "thunderstorm"].includes(weather.condition);
    const cover = weather ? (heavy ? 100 : weather.cloud_cover) : 25;
    const count = Math.round((cover / 100) * 9);
    const light = sky.night > 0.5 ? mixHex(sky.top, "#8a90b8", 0.35) : mixHex(sky.horizon, "#ffffff", heavy ? 0.1 : 0.55);
    const key = `${count}|${light}|${heavy}`;
    if (this.cloudCache?.key === key) return this.cloudCache.sprites;
    const shade = mixHex(light, sky.night > 0.5 ? sky.top : "#7d8296", heavy ? 0.45 : 0.3);
    const r = rng(19);
    const sprites: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const w = 26 + Math.floor(r() * (heavy ? 60 : 40));
      const h = Math.round(w * 0.38) + 2;
      const c = canvas(w, h);
      const g = c.getContext("2d")!;
      const n = Math.max(3, Math.round(w / 8));
      const discs: [number, number, number][] = [];
      for (let j = 0; j < n; j++) {
        const u = (j + 0.5) / n;
        const rad = Math.max(2, Math.round((h - 2) * (0.45 + 0.55 * Math.sin(Math.PI * u)) * (0.75 + r() * 0.25)));
        discs.push([Math.round(2 + u * (w - 5)), h - 1 - Math.round(rad * 0.55), rad]);
      }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (discs.some(([cx, cy, rr]) => (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr + rr * 0.5)) px(g, y >= h - 3 ? shade : light, x, y);
      sprites.push(c);
    }
    this.cloudCache = { key, canvas: sprites[0] ?? canvas(1, 1), sprites };
    return sprites;
  }

  frame(t: number, f: FrameInput) {
    const input = this.input;
    if (!input) return;
    const still = input.reducedMotion;
    const tt = still ? 0 : t;
    const dt = Math.min(0.25, Math.max(0, t - this.last));
    this.last = t;
    const { sky, weather } = input;
    const { w, h, x: cx, y: cy } = this.cam;
    const g = this.bg;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;

    g.drawImage(this.drawSky(sky, weather), 0, 0);
    const clear = !weather || ["clear", "clouds"].includes(weather.condition);
    if (sky.night > 0.05 && clear) {
      for (const s of this.stars) {
        const x = Math.round((((s.x + 260) % 840) / 840) * Math.max(w, 340)) ;
        const y = s.y - cy;
        if (x < 0 || y < 0 || x >= w || y >= h || s.y > S.HORIZON - 4) continue;
        const b = (0.55 + 0.45 * Math.sin(tt * s.v + s.p)) * sky.night;
        g.globalAlpha = b;
        px(g, "#fffbea", x, y);
        if (s.big && b > 0.7) {
          g.globalAlpha = b * 0.4;
          px(g, "#fffbea", x - 1, y);
          px(g, "#fffbea", x + 1, y);
          px(g, "#fffbea", x, y - 1);
          px(g, "#fffbea", x, y + 1);
        }
      }
      g.globalAlpha = 1;
    }
    this.moonPos = null;
    const across = (x: number) => Math.round(cx + w / 2 + x * Math.max(40, w / 2 - 18));
    if (sky.moon.altitude > -2 && (sky.night > 0.2 || sky.moon.altitude > 10)) {
      const p = skyPoint(sky.moon.altitude, sky.moon.azimuth);
      const mx = across(p.x);
      const my = Math.round(this.skyY(sky.moon.altitude));
      this.moonPos = { x: mx, y: my };
      if (clear || weather?.condition === "fog") this.drawMoon(g, sky, mx - cx, my - cy);
    }
    if (sky.sunAltitude > -3 && clear) {
      const p = skyPoint(sky.sunAltitude, sky.sunAzimuth);
      const sx = across(p.x) - cx;
      const sy = Math.round(this.skyY(sky.sunAltitude)) - cy;
      const low = sky.sunAltitude < 8;
      const col = low ? "#ffc88a" : "#fff4d8";
      const glow = g.createRadialGradient(sx, sy, 4, sx, sy, low ? 40 : 26);
      glow.addColorStop(0, rgba(col, low ? 0.5 : 0.35));
      glow.addColorStop(1, rgba(col, 0));
      g.fillStyle = glow;
      g.fillRect(sx - 44, sy - 44, 88, 88);
      ellipse(g, col, sx, sy, low ? 8 : 6, low ? 8 : 6);
    }
    const clouds = this.cloudSprites(sky, weather);
    const wind = 0.6 + (weather?.wind_kmh ?? 8) * 0.06;
    const cr = rng(23);
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const span = 840 + c.width;
      const baseX = -260 + cr() * 840;
      const y = Math.round(-60 + cr() * 150 + (i % 3) * 12) - cy;
      const x = Math.round((((baseX + 260 + tt * wind * (0.7 + (i % 3) * 0.2)) % span) + span) % span - 260 - c.width) - Math.round(cx * 0.2);
      if (x > w || x + c.width < 0 || y > h) continue;
      g.drawImage(c, x, y);
    }
    if (weather?.condition === "thunderstorm" && !still) {
      if (this.storm.start < 0 && t > this.storm.next) this.storm.start = t;
      if (this.storm.start >= 0) {
        const k = (t - this.storm.start) / 3;
        if (k >= 1) {
          this.storm.start = -1;
          this.storm.next = t + 14 + Math.random() * 20;
        } else {
          const glow = g.createRadialGradient(w * 0.6, 20, 4, w * 0.6, 20, 140);
          glow.addColorStop(0, `rgba(210,215,255,${Math.sin(k * Math.PI) * 0.22})`);
          glow.addColorStop(1, "rgba(210,215,255,0)");
          g.fillStyle = glow;
          g.fillRect(0, 0, w, h);
        }
      }
    }
    this.drawShootingStar(g, input, t, still);

    const tint = this.tint(input);
    const city = this.drawCity(sky);
    const cg = this.cg;
    cg.globalCompositeOperation = "source-over";
    cg.clearRect(0, 0, w, h);
    cg.drawImage(city.canvas, cx - CITY.x, cy - CITY.y, w, h, 0, 0, w, h);
    if (tint.a > 0.01) {
      cg.globalCompositeOperation = "source-atop";
      cg.fillStyle = rgba(tint.color, tint.a);
      cg.fillRect(0, 0, w, h);
      cg.globalCompositeOperation = "source-over";
    }
    cg.drawImage(city.lights, cx - CITY.x, cy - CITY.y, w, h, 0, 0, w, h);
    g.drawImage(this.city, 0, 0);

    const wg = this.wg;
    wg.globalCompositeOperation = "source-over";
    wg.globalAlpha = 1;
    wg.clearRect(0, 0, w, h);
    wg.drawImage(this.drawWorld(input), cx - WORLD.x, cy - WORLD.y, w, h, 0, 0, w, h);
    if (input.otherSky) this.drawOtherWindow(wg, input.otherSky);
    const label = input.accent ?? "#e88fa3";
    wg.drawImage(recordPlayer(label, f.playing > 0.5 && !still ? Math.floor(t * 6) : 0), S.RECORD_PLAYER.x - cx, S.RECORD_PLAYER.y - cy);
    this.drawKitten(wg, input, t, f);
    this.drawLightsWire(wg);
    if (tint.a > 0.01) {
      wg.globalCompositeOperation = "source-atop";
      wg.fillStyle = rgba(tint.color, tint.a);
      wg.fillRect(0, 0, w, h);
      wg.globalCompositeOperation = "source-over";
    }
    g.drawImage(this.world, 0, 0);

    this.drawLights(g, input, tt, f);
    this.drawNotes(g, input, tt);
    this.drawHearts(g, t, f.pets, still);
    this.drawWeather(g, input, tt, still);
    this.drawHighlight(g, input, t);

    this.g.imageSmoothingEnabled = false;
    this.g.drawImage(this.buf, 0, 0, w * this.cam.scale, h * this.cam.scale);
    void dt;
  }

  private tint(input: RoomInput) {
    const { sky, weather } = input;
    let color = sky.tint;
    let a = sky.tintAlpha;
    if (weather && ["rain", "drizzle", "thunderstorm", "fog", "snow"].includes(weather.condition)) {
      color = mixHex(color, "#56607a", a > 0.3 ? 0.4 : 0.8);
      a = Math.min(0.7, a + 0.12);
    }
    return { color, a };
  }

  private drawOtherWindow(g: CanvasRenderingContext2D, other: SkyState) {
    const f = S.FURNITURE.second_window;
    const x = f.x - this.cam.x;
    const y = f.y - this.cam.y;
    g.save();
    g.globalCompositeOperation = "destination-over";
    const grad = g.createLinearGradient(0, y, 0, y + 15);
    grad.addColorStop(0, other.top);
    grad.addColorStop(1, other.horizon);
    g.fillStyle = grad;
    g.fillRect(x, y, 25, 15);
    g.restore();
    if (other.night > 0.5) {
      g.save();
      g.globalCompositeOperation = "source-atop";
      px(g, "#fffbea", x + 6, y + 4);
      px(g, "#fffbea", x + 15, y + 6);
      px(g, "#fffbea", x + 19, y + 3);
      g.restore();
    }
  }

  private drawKitten(g: CanvasRenderingContext2D, input: RoomInput, t: number, f: FrameInput) {
    const still = input.reducedMotion;
    const awake = f.awake;
    const k = this.kitten;
    let s: HTMLCanvasElement;
    let x: number;
    let y: number;
    if (!awake) {
      s = !still && Math.floor(t / 1.6) % 2 ? k.sleep2 : k.sleep;
      x = S.KITTEN.asleep.x;
      y = S.KITTEN.asleep.y;
    } else {
      const cycle = still ? 0 : t % 9;
      s = cycle > 8.7 ? k.blink : cycle > 5 && cycle < 6 ? k.tail : cycle > 3 && cycle < 3.3 ? k.ear : k.sit;
      x = S.KITTEN.awake.x;
      y = S.KITTEN.awake.y + (f.pulse > 0.5 && !still ? 1 : 0);
    }
    this.kittenPos = { x, y, w: s.width, h: s.height };
    g.drawImage(s, x - this.cam.x, y - this.cam.y);
  }

  private wireY(x: number) {
    const L = S.LIGHTS;
    const u = (x - L.x0) / (L.x1 - L.x0);
    return L.y0 + (L.y1 - L.y0) * u + L.sag * 4 * u * (1 - u);
  }

  private drawLightsWire(g: CanvasRenderingContext2D) {
    const L = S.LIGHTS;
    const { x: cx, y: cy } = this.cam;
    px(g, INK, L.x1 - 1 - cx, L.y1 - 2 - cy, 3, S.FLOOR_Y + 8 - L.y1);
    px(g, "#9097b1", L.x1 - cx, L.y1 - 1 - cy, 1, S.FLOOR_Y + 6 - L.y1);
    for (let x = L.x0; x <= L.x1; x++) px(g, INK, x - cx, Math.round(this.wireY(x)) - cy);
  }

  private drawLights(g: CanvasRenderingContext2D, input: RoomInput, t: number, f: FrameInput) {
    const { sky } = input;
    const { x: cx, y: cy } = this.cam;
    const on = sky.lamp > 0.05 || sky.night > 0.3;
    const L = S.LIGHTS;
    const warm = input.accent ? mixHex("#ffcf7a", input.accent, 0.2) : "#ffcf7a";
    g.globalCompositeOperation = "lighter";
    let i = 0;
    for (let x = L.x0 + 5; x < L.x1 - 2; x += 8, i++) {
      const y = Math.round(this.wireY(x)) + 1;
      const col = i % 3 === 0 ? "#ffd27a" : i % 3 === 1 ? "#ff9fb2" : "#a8e0ff";
      if (on) {
        const a = (0.16 + sky.night * 0.16) * (0.8 + 0.2 * Math.sin(t * 1.7 + i * 1.3)) + f.pulse * 0.12;
        const gl = g.createRadialGradient(x - cx + 0.5, y - cy + 1, 0, x - cx + 0.5, y - cy + 1, 7);
        gl.addColorStop(0, rgba(col, a));
        gl.addColorStop(1, rgba(col, 0));
        g.fillStyle = gl;
        g.fillRect(x - cx - 7, y - cy - 6, 15, 15);
      }
    }
    const lamp = input.lampOn ? 1 : 0;
    if (lamp > 0) {
      const lx = S.FURNITURE.lamp.x + 7 - cx;
      const ly = S.FURNITURE.lamp.y + 5 - cy;
      const a = (0.18 + sky.night * 0.22) * lamp + f.pulse * 0.12;
      g.save();
      g.beginPath();
      g.rect(S.ROOM_X0 - cx, S.WALL_TOP - cy, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.WALL_TOP);
      g.clip();
      const gl = g.createRadialGradient(lx, ly, 2, lx, ly, 70);
      gl.addColorStop(0, rgba(warm, a));
      gl.addColorStop(0.4, rgba(warm, a * 0.45));
      gl.addColorStop(1, rgba(warm, 0));
      g.fillStyle = gl;
      g.fillRect(lx - 72, ly - 72, 144, 144);
      g.restore();
    }
    const glowAt = (id: string, col: string, r: number, a: number) => {
      const d = DECORATIONS.find((x) => x.id === id);
      if (!d || (d.unlock && !input.unlocked.has(d.unlock))) return;
      const p = placementOf(d, input.layout.items[d.id]);
      if (p.hidden) return;
      const s = this.sprite(p.sprite);
      const gx = p.x - cx;
      const gy = p.y - (s ? s.height * 0.6 : 6) - cy;
      const gl = g.createRadialGradient(gx, gy, 0, gx, gy, r);
      gl.addColorStop(0, rgba(col, a));
      gl.addColorStop(1, rgba(col, 0));
      g.fillStyle = gl;
      g.fillRect(gx - r, gy - r, r * 2, r * 2);
    };
    if (on) {
      glowAt("fairy_jar", "#fff1a8", 14, 0.3 + f.pulse * 0.2);
      glowAt("moon_lamp", "#fff1c4", 18, 0.28 + f.pulse * 0.15);
    }
    glowAt("disco_ball", "#c6cbe0", 10, 0.12 + f.pulse * 0.3);
    g.globalCompositeOperation = "source-over";
    i = 0;
    for (let x = L.x0 + 5; x < L.x1 - 2; x += 8, i++) {
      const y = Math.round(this.wireY(x)) + 1;
      const col = i % 3 === 0 ? "#ffd27a" : i % 3 === 1 ? "#ff9fb2" : "#a8e0ff";
      px(g, on ? col : mixHex(col, "#5b5f78", 0.6), x - cx, y - cy, 1, 2);
    }
    if (lamp > 0) px(g, mixHex(warm, "#ffffff", 0.5), S.FURNITURE.lamp.x + 4 - cx, S.FURNITURE.lamp.y + 4 - cy, 7, 2);
  }

  private drawShootingStar(g: CanvasRenderingContext2D, input: RoomInput, t: number, still: boolean) {
    this.starPos = null;
    const note = input.notes.has("shooting_star");
    const clear = !input.weather || ["clear", "clouds"].includes(input.weather.condition);
    const sh = this.shooting;
    if (input.sky.night < 0.6 || !clear) {
      sh.start = -1;
      return;
    }
    if (sh.start < 0 && t > sh.next) {
      sh.start = t;
      sh.x = this.cam.x + 20 + Math.random() * Math.max(10, this.cam.w - 120);
      sh.y = Math.max(this.cam.y + 10, -200) + Math.random() * 30;
    }
    if (sh.start < 0) return;
    const dur = note ? 4 : 1.4;
    const k = still ? 0.5 : (t - sh.start) / dur;
    if (k >= 1) {
      sh.start = -1;
      sh.next = t + (note ? 40 + Math.random() * 30 : 120 + Math.random() * 120);
      return;
    }
    const x = sh.x + k * 70;
    const y = sh.y + k * 28;
    if (note) this.starPos = { x, y };
    const a = Math.sin(k * Math.PI);
    for (let i = 0; i < 10; i++) {
      g.globalAlpha = a * (1 - i / 10);
      px(g, "#fffbea", Math.round(x - i * 2.5) - this.cam.x, Math.round(y - i) - this.cam.y);
    }
    g.globalAlpha = 1;
  }

  private drawNotes(g: CanvasRenderingContext2D, input: RoomInput, t: number) {
    const spots: [string, number, number][] = [];
    for (const spot of input.notes) {
      if (spot === "shooting_star") continue;
      const a = this.anchorScene(spot === "drawer" ? "drawer" : spot);
      if (a) spots.push([spot, a.x, a.y]);
    }
    spots.forEach(([, x, y], i) => {
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7);
      g.globalAlpha = tw;
      g.drawImage(this.sparkle, Math.round(x - 2) - this.cam.x, Math.round(y - 8) - this.cam.y);
    });
    g.globalAlpha = 1;
  }

  private drawHearts(g: CanvasRenderingContext2D, t: number, pets: number, still: boolean) {
    if (pets !== this.lastPets) {
      if (pets > this.lastPets) this.hearts.push({ born: t, dx: Math.round((Math.random() - 0.5) * 6) });
      this.lastPets = pets;
    }
    const kp = this.kittenPos;
    this.hearts = this.hearts.filter((h) => t - h.born < 1.4);
    for (const h of this.hearts) {
      const age = t - h.born;
      g.globalAlpha = 1 - age / 1.4;
      const x = kp.x + kp.w / 2 - 3 + h.dx - this.cam.x;
      const y = kp.y - 6 - (still ? 2 : Math.round(age * 14)) - this.cam.y;
      g.drawImage(this.heart, Math.round(x), Math.round(y));
    }
    g.globalAlpha = 1;
  }

  private drawWeather(g: CanvasRenderingContext2D, input: RoomInput, t: number, still: boolean) {
    const { weather, season, sky } = input;
    const { w, h } = this.cam;
    const c = weather?.condition ?? "clear";
    if (c === "rain" || c === "drizzle" || c === "thunderstorm") {
      const n = c === "drizzle" ? 50 : c === "rain" ? 110 : 160;
      const len = c === "drizzle" ? 2 : 4;
      g.fillStyle = sky.night > 0.5 ? "rgba(170,185,230,0.45)" : "rgba(220,230,250,0.55)";
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        const y = ((d.y + t * d.v) % (h + 20)) - 10;
        const x = ((((d.x - t * d.v * 0.2) % (w + 40)) + w + 40) % (w + 40)) - 20;
        g.fillRect(Math.round(x), Math.round(y), 1, len);
      }
      if (!still) {
        const r = rng(Math.floor(t * 12) + 3);
        g.fillStyle = "rgba(220,230,250,0.5)";
        for (let i = 0; i < 10; i++) {
          const x = Math.floor(r() * w);
          const y = S.FLOOR_Y + 4 + Math.floor(r() * (S.FRONT_Y - S.FLOOR_Y - 6)) - this.cam.y;
          g.fillRect(x - 1, y, 1, 1);
          g.fillRect(x + 1, y, 1, 1);
        }
      }
    }
    if (c === "snow" || (season === "winter" && c !== "rain" && c !== "drizzle" && c !== "thunderstorm")) {
      const n = c === "snow" ? 120 : 45;
      g.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        const y = ((d.y + t * (12 + d.s * 10)) % (h + 10)) - 5;
        const x = ((d.x + Math.sin(t * 0.8 + i) * 6) % (w + 10)) - 5;
        g.fillRect(Math.round(x), Math.round(y), d.s > 0.7 ? 2 : 1, d.s > 0.7 ? 2 : 1);
      }
    }
    if (c === "fog") {
      const fog = g.createLinearGradient(0, 0, 0, h);
      const col = sky.night > 0.5 ? "60,66,92" : "205,210,220";
      fog.addColorStop(0, `rgba(${col},0.15)`);
      fog.addColorStop(0.6, `rgba(${col},0.38)`);
      fog.addColorStop(1, `rgba(${col},0.22)`);
      g.fillStyle = fog;
      g.fillRect(0, 0, w, h);
    }
    if (c !== "rain" && c !== "drizzle" && c !== "thunderstorm") {
      if (season === "autumn" || season === "spring") {
        const colors = season === "autumn" ? [["#e8924a", "#a8502c"], ["#e0b870", "#a8783a"], ["#c9572f", "#7d3322"]] : [["#ffd3df", "#e88fa3"], ["#fff1f4", "#f2b6c6"], ["#f7c6d0", "#d9879d"]];
        for (let i = 0; i < 7; i++) {
          const d = this.drops[i + 40];
          const y = ((d.y + t * (7 + d.s * 6)) % (h + 20)) - 10;
          const x = ((((d.x + t * 5 + Math.sin(t * 0.9 + i) * 12) % (w + 20)) + w + 20) % (w + 20)) - 10;
          const [light, dark] = colors[i % 3];
          const X = Math.round(x);
          const Y = Math.round(y);
          if (Math.sin(t * 2 + i * 1.7) > 0) {
            g.fillStyle = light;
            g.fillRect(X, Y, 2, 1);
            g.fillStyle = dark;
            g.fillRect(X + 1, Y + 1, 2, 1);
          } else {
            g.fillStyle = light;
            g.fillRect(X, Y, 1, 2);
            g.fillStyle = dark;
            g.fillRect(X + 1, Y + 1, 1, 1);
          }
        }
      } else if (season === "summer" && sky.night > 0.5) {
        g.globalCompositeOperation = "lighter";
        for (let i = 0; i < 14; i++) {
          const d = this.drops[i + 80];
          const x = Math.round(S.ROOF_X0 + 6 + ((d.x + Math.sin(t * 0.4 + i) * 14) % 140)) - this.cam.x;
          const y = Math.round(S.PARAPET_Y - 20 + ((d.y + Math.cos(t * 0.5 + i) * 10) % 60)) - this.cam.y;
          const a = 0.4 + 0.4 * Math.sin(t * 2 + i * 2.1);
          g.fillStyle = `rgba(233,255,138,${a})`;
          g.fillRect(x, y, 1, 1);
          g.fillStyle = `rgba(233,255,138,${a * 0.35})`;
          g.fillRect(x - 1, y, 3, 1);
          g.fillRect(x, y - 1, 1, 3);
        }
        g.globalCompositeOperation = "source-over";
      }
    }
  }

  private drawHighlight(g: CanvasRenderingContext2D, input: RoomInput, t: number) {
    const id = input.highlight;
    if (id) {
      const a = this.anchorScene(id);
      if (a) {
        const bob = input.reducedMotion ? 0 : Math.round(Math.sin(t * 5) * 1.5);
        const x = Math.round(a.x) - this.cam.x;
        const y = Math.round(a.y) - 14 + bob - this.cam.y;
        px(g, INK, x - 3, y - 1, 7, 1);
        px(g, INK, x - 3, y, 1, 1);
        px(g, INK, x + 3, y, 1, 1);
        px(g, "#fff6dc", x - 2, y, 5, 1);
        px(g, INK, x - 2, y + 1, 1, 1);
        px(g, INK, x + 2, y + 1, 1, 1);
        px(g, "#fff6dc", x - 1, y + 1, 3, 1);
        px(g, INK, x - 1, y + 2, 1, 1);
        px(g, INK, x + 1, y + 2, 1, 1);
        px(g, "#fff6dc", x, y + 2, 1, 1);
        px(g, INK, x, y + 3, 1, 1);
      }
    }
    const sel = input.selected ? DECORATIONS.find((d) => d.id === input.selected) : null;
    if (sel) {
      const p = placementOf(sel, input.layout.items[sel.id]);
      const s = this.sprite(p.sprite) ?? (p.sprite === "bean_bag" ? { width: 20, height: 14 } : null);
      if (s && !p.hidden) {
        const flat = p.sprite.startsWith("rug");
        const x = Math.round(p.x - s.width / 2) - 2 - this.cam.x;
        const y = Math.round(flat ? p.y - s.height / 2 : sel.id === "hanging_plant" ? S.WALL_TOP + 6 : p.y - s.height) - 2 - this.cam.y;
        const on = Math.floor(t * 4) % 2 === 0;
        g.fillStyle = on ? "#fff6dc" : "#a8445e";
        const W = s.width + 4;
        const H = s.height + 4;
        for (let i = 0; i < W; i += 2) {
          g.fillRect(x + i, y, 1, 1);
          g.fillRect(x + i, y + H - 1, 1, 1);
        }
        for (let j = 0; j < H; j += 2) {
          g.fillRect(x, y + j, 1, 1);
          g.fillRect(x + W - 1, y + j, 1, 1);
        }
      }
    }
  }
}
