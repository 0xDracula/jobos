import type { AvatarFrames, AvatarPose } from "@/avatar/types";
import type { Weather } from "@/lib/types";

import type { Season } from "../calendar";
import { favoritesKey, type FavoriteArt } from "../favorites";
import { DECORATIONS, HANGING_DECORATIONS, placementOf, type Decoration, type RoomLayout } from "../layout";
import { blendLight, LIGHT_SECONDS, NEUTRAL_LIGHT, type RoomLight } from "../light";
import { mixHex, skyPoint, type SkyState } from "../sky";
import { layoutStars, type StarLayout, type StarPoint } from "../starmap";
import {
  anniversaryCake,
  artistPoster,
  balloons,
  banner,
  cassetteTray,
  crescent,
  cushion,
  drinkTray,
  filmPoster,
  FLAG_COLORS,
  flowerBunch,
  HEART_SMALL,
  holidayTree,
  lantern,
  pinnedRecord,
  placePoster,
  polaroid,
  recolorBooks,
  roseBouquet,
  snackSprite,
  starLantern,
  tinCan,
  wrappedCassette,
} from "./decor";
import { glassMask, type Kit } from "./kit";
import { RecordPlayer } from "./record";
import type { Furniture, Item, RoomArt } from "./rooms/types";
import * as S from "./scene";
import {
  beanBag,
  breakfastTray,
  canvas,
  discoBall,
  ellipse,
  fairyJar,
  hangingPlant,
  heartSprite,
  INK,
  kittenFrames,
  moonLamp,
  petBed,
  px,
  rng,
  sparkleSprite,
  type KittenFrames,
} from "./sprites";

export type LampState = { on: boolean; signal: "sent" | "received" | null };
export type AvatarView = { id: string; frames: AvatarFrames; pose: AvatarPose };
export type KittenPose = "sit" | "sleep" | "stretch" | "yawn" | "look";

export type RoomInput = {
  sky: SkyState;
  weather: Weather | null;
  season: Season | null;
  layout: RoomLayout;
  plantStage: number;
  unlocked: Set<string>;
  notes: Set<string>;
  accent: string;
  light: RoomLight;
  artwork: string | null;
  lamp: LampState;
  otherSky: SkyState | null;
  otherWeather: Weather | null;
  weekendTray: boolean;
  weekendMorning: number;
  favorites: FavoriteArt;
  holiday: string[];
  milestoneDay: boolean;
  mixtape: string | null;
  avatars: { me: AvatarView | null; other: AvatarView | null; together: boolean };
  songStars: StarPoint[];
  unlocking: { id: string; at: number } | null;
  kittenPose: KittenPose | null;
  highlight: string | null;
  selected: string | null;
  reducedMotion: boolean;
};

export type FrameInput = { awake: boolean; pets: number; pulse: number; playing: number };

type Cache = { key: string; canvas: HTMLCanvasElement };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const UNLOCK_SECONDS = 2.6;
const B = S.BACKDROP;
const W = S.WORLD;

const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const rainy = (c: string | undefined) => c === "rain" || c === "drizzle" || c === "thunderstorm";

type Mask = { x: number; y: number; w: number; h: number; on: Uint8Array; points: [number, number][]; runs: [number, number, number][] };

function maskOf(c: HTMLCanvasElement, x: number, y: number): Mask {
  const m = glassMask(c);
  const d = m.getContext("2d")!.getImageData(0, 0, m.width, m.height).data;
  const on = new Uint8Array(m.width * m.height);
  const points: [number, number][] = [];
  for (let i = 0; i < on.length; i++) {
    on[i] = d[i * 4 + 3] > 0 ? 1 : 0;
    if (on[i]) points.push([i % m.width, Math.floor(i / m.width)]);
  }
  const runs: [number, number, number][] = [];
  for (let xx = 0; xx < m.width; xx++) {
    let start = -1;
    for (let yy = 0; yy <= m.height; yy++) {
      const glass = yy < m.height && on[yy * m.width + xx];
      if (glass && start < 0) start = yy;
      if (!glass && start >= 0) {
        if (yy - start >= 4) runs.push([xx, start, yy - 1]);
        start = -1;
      }
    }
  }
  return { x, y, w: m.width, h: m.height, on, points, runs };
}

type Idle = { kind: "stretch" | "yawn" | "look" | null; start: number; next: number };
const IDLE_SECONDS = { stretch: 2.6, yawn: 1.7, look: 4.5 } as const;

export class PixelRenderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private kit: Kit;
  private art: RoomArt;
  private furniture: Furniture;
  private glass: { main: Mask; second: Mask };
  private kitten: KittenFrames;
  private heart: HTMLCanvasElement;
  private sparkle: HTMLCanvasElement;
  private record = new RecordPlayer();
  private input: RoomInput | null = null;
  onChange: () => void = () => {};

  cam = { x: 0, y: 0, w: 1, h: 1, scale: 1, dpr: 1 };
  private userPan: number | null = null;
  private buf = canvas(1, 1);
  private bg: CanvasRenderingContext2D;
  private world = canvas(1, 1);
  private wg: CanvasRenderingContext2D;
  private city = canvas(1, 1);
  private cg: CanvasRenderingContext2D;

  private skyCache: Cache | null = null;
  private backdropCache: (Cache & { lights: HTMLCanvasElement }) | null = null;
  private worldCache: Cache | null = null;
  private cloudCache: (Cache & { sprites: HTMLCanvasElement[] }) | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();

  private stars: { x: number; y: number; v: number; p: number; big: boolean }[] = [];
  private drops: { x: number; y: number; v: number; s: number }[] = [];
  private hearts: { born: number; dx: number }[] = [];
  private lastPets = 0;
  private shooting = { start: -1, next: 25, x: 0, y: 0 };
  private storm = { start: -1, next: 12 };
  private idle: Idle = { kind: null, start: 0, next: 6 };
  private wasAwake = false;
  private moonPos: { x: number; y: number } | null = null;
  private starPos: { x: number; y: number } | null = null;
  private kittenPos = { x: S.KITTEN.asleep.x, y: S.KITTEN.asleep.y, w: 16, h: 9 };
  private avatarPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  private songLayout: { key: string; layout: StarLayout } | null = null;
  private songHits: { id: string; x: number; y: number }[] = [];
  private skyAnchor: { x: number; y: number } | null = null;
  private light = { from: NEUTRAL_LIGHT, to: NEUTRAL_LIGHT, start: -10, key: "" };
  private spin = 0;
  private last = 0;

  constructor(target: HTMLCanvasElement, kit: Kit, art: RoomArt) {
    this.canvas = target;
    this.g = target.getContext("2d")!;
    this.kit = kit;
    this.art = art;
    this.furniture = art.init(kit);
    this.glass = this.masks();
    this.bg = this.buf.getContext("2d")!;
    this.wg = this.world.getContext("2d")!;
    this.cg = this.city.getContext("2d")!;
    this.kitten = kittenFrames();
    this.heart = heartSprite();
    this.sparkle = sparkleSprite();
    const own: Record<string, () => HTMLCanvasElement> = {
      fairy_jar: fairyJar,
      moon_lamp: moonLamp,
      hanging_plant: hangingPlant,
      disco_ball: discoBall,
      anniversary_cake: anniversaryCake,
      star_lantern: starLantern,
      rose_bouquet: roseBouquet,
      cassette_tray: cassetteTray,
      tin_can: tinCan,
      pinned_record: pinnedRecord,
      banner,
      crescent,
      lantern: () => lantern(),
      tree: holidayTree,
      balloons: () => balloons(),
      balloons_pink: () => balloons(["#f7a6c4", "#ffffff", "#e0475a"]),
      breakfast: breakfastTray,
    };
    for (const [name, make] of Object.entries(own)) this.sprites.set(name, make());
    const r = rng(42);
    for (let i = 0; i < 260; i++) this.stars.push({ x: -260 + r() * 840, y: -420 + r() * 520, v: 0.5 + r() * 2, p: r() * 6.3, big: r() < 0.08 });
    const d = rng(7);
    for (let i = 0; i < 200; i++) this.drops.push({ x: d() * 900, y: d() * 900, v: 90 + d() * 60, s: d() });
  }

  private masks() {
    return {
      main: maskOf(this.furniture.window, S.HANGING.window.x, S.HANGING.window.y),
      second: maskOf(this.furniture.secondWindow, S.HANGING.second_window.x, S.HANGING.second_window.y),
    };
  }

  setArt(art: RoomArt) {
    this.art = art;
    this.furniture = art.init(this.kit);
    this.glass = this.masks();
    this.backdropCache = null;
    this.worldCache = null;
  }

  get roomId() {
    return this.art.id;
  }

  setInput(input: RoomInput) {
    this.input = input;
    this.record.setArtwork(input.artwork, () => this.onChange());
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

  revealX(x: number) {
    if (this.cam.w >= S.SCENE_W + 8) return;
    if (x < this.cam.x + 16 || x > this.cam.x + this.cam.w - 16) {
      this.userPan = Math.round(x - this.cam.w / 2);
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
    if (id === "sky") return this.skyAnchor;
    if (id === "kitten") return { x: this.kittenPos.x + this.kittenPos.w / 2, y: this.kittenPos.y };
    if (id.startsWith("avatar:")) {
      const p = this.avatarPos.get(id.slice(7));
      return p ? { x: p.x + p.w / 2, y: p.y } : null;
    }
    if (id === "second_window_label") return { x: S.HANGING.second_window.x + 12.5, y: S.HANGING.second_window.y - 1 };
    if (id === "window_label") return { x: S.HANGING.window.x + 17, y: S.HANGING.window.y + 27 };
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
    for (const [uid, p] of this.avatarPos) {
      const id = `avatar:${uid}`;
      if (ids.includes(id) && sx >= p.x + 1 && sx <= p.x + p.w - 1 && sy >= p.y && sy <= p.y + p.h) return id;
    }
    if (ids.includes("moon") && this.moonPos && Math.hypot(sx - this.moonPos.x, sy - this.moonPos.y) < 10) return "moon";
    for (const id of ids) {
      const r = S.HIT[id];
      if (r && sx >= r[0] && sx <= r[0] + r[2] && sy >= r[1] && sy <= r[1] + r[3]) return id;
    }
    return null;
  }

  hitStar(cssX: number, cssY: number): string | null {
    const k = this.cam.dpr / this.cam.scale;
    const vx = cssX * k;
    const vy = cssY * k;
    const reach = 22 * k;
    let best: { id: string; d: number } | null = null;
    for (const s of this.songHits) {
      const d = Math.hypot(s.x - vx, s.y - vy);
      if (d < reach && (!best || d < best.d)) best = { id: s.id, d };
    }
    return best?.id ?? null;
  }

  decorationSpot(id: string): { x: number; y: number } | null {
    const d = DECORATIONS.find((x) => x.id === id);
    if (!d || !this.input) return null;
    const p = placementOf(d, this.input.layout.items[d.id]);
    if (id === "photo_garland") return { x: p.x, y: S.WALL_TOP + 8 };
    if (id === "bunting") return { x: 236, y: 96 };
    if (id === "star_lantern") return { x: p.x, y: Math.round(this.wireY(p.x)) + 8 };
    if (id === "hanging_plant") return { x: p.x, y: S.WALL_TOP + 12 };
    const s = this.sprite(p.sprite);
    return { x: p.x, y: p.y - (s ? s.height / 2 : 6) };
  }

  private sprite(name: string): HTMLCanvasElement | undefined {
    return this.sprites.get(name) ?? this.kit.sprite(name);
  }

  private cached(name: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let s = this.sprites.get(name);
    if (!s) {
      s = make();
      this.sprites.set(name, s);
    }
    return s;
  }

  private put(g: CanvasRenderingContext2D, s: HTMLCanvasElement | string | undefined, x: number, y: number, flip = false) {
    this.kit.put(g, typeof s === "string" ? this.sprite(s) : s, x, y, flip);
  }

  private wireY(x: number) {
    const L = S.LIGHTS;
    const u = (x - L.x0) / (L.x1 - L.x0);
    return L.y0 + (L.y1 - L.y0) * u + L.sag * 4 * u * (1 - u);
  }

  private drawBackdrop(input: RoomInput) {
    const b = { sky: input.sky, weather: input.weather, season: input.season };
    const key = `${this.art.id}|${this.art.backdropKey(b)}`;
    if (this.backdropCache?.key === key) return this.backdropCache;
    const c = this.backdropCache?.canvas ?? canvas(B.w, B.h);
    const lights = this.backdropCache?.lights ?? canvas(B.w, B.h);
    const g = c.getContext("2d")!;
    const lg = lights.getContext("2d")!;
    for (const x of [g, lg]) {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, B.w, B.h);
      x.translate(-B.x, -B.y);
    }
    this.art.drawBackdrop(g, lg, b);
    g.setTransform(1, 0, 0, 1, 0, 0);
    lg.setTransform(1, 0, 0, 1, 0, 0);
    this.backdropCache = { key, canvas: c, lights };
    return this.backdropCache;
  }

  private visibleDecorations(input: RoomInput) {
    return DECORATIONS.filter((d) => !d.unlock || input.unlocked.has(d.unlock))
      .filter((d) => d.id !== input.unlocking?.id)
      .map((d) => ({ d, p: placementOf(d, input.layout.items[d.id]) }))
      .filter(({ p }) => !p.hidden);
  }

  private decorationSprite(d: Decoration, sprite: string, accent: string): HTMLCanvasElement | undefined {
    if (sprite === "bean_bag") return this.cached(`bean_bag:${accent}`, () => beanBag(accent));
    return this.sprite(sprite);
  }

  private drawWorld(input: RoomInput) {
    const { layout, favorites: fav } = input;
    const key = [
      this.art.id,
      layout.look.wall,
      layout.look.floor,
      input.accent,
      input.plantStage,
      [...input.unlocked].sort().join(","),
      input.weekendTray,
      !!input.otherSky,
      favoritesKey(fav),
      input.holiday.join(","),
      input.milestoneDay,
      input.mixtape,
      input.unlocking?.id ?? "",
      JSON.stringify(layout.items),
    ].join("|");
    if (this.worldCache?.key === key) return this.worldCache.canvas;
    const c = this.worldCache?.canvas ?? canvas(W.w, W.h);
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.translate(-W.x, -W.y);
    const F = this.furniture;
    const look = { ...layout.look, accent: input.accent };

    this.art.drawShell(g, this.kit, look);

    const H = S.HANGING;
    const glass = (s: HTMLCanvasElement, x: number, y: number) => {
      this.put(g, s, x, y);
      g.globalCompositeOperation = "destination-out";
      g.drawImage(glassMask(s), x, y);
      g.globalCompositeOperation = "source-over";
    };
    glass(F.window, H.window.x, H.window.y);
    this.put(g, fav.place === "default" ? "frame_cat" : this.cached(`place:${fav.place}`, () => placePoster(fav.place)), H.frame.x, H.frame.y);
    this.put(g, fav.film === "default" ? "frame_flowers" : this.cached(`film:${fav.film}`, () => filmPoster(fav.film)), H.poster.x, H.poster.y);
    if (input.otherSky) glass(F.secondWindow, H.second_window.x, H.second_window.y);
    else this.put(g, fav.artist === "default" ? F.picture : this.cached(`artist:${fav.artist}`, () => artistPoster(fav.artist)), S.PICTURE.x, S.PICTURE.y);
    this.put(g, "tin_can", 44, 95);
    for (let x = 47; x <= 58; x++) px(g, "#d9d4c8", x, Math.round(95 - (x - 47) * 0.3 + 0.08 * (x - 47) * (58 - x)));

    const decos = this.visibleDecorations(input);
    const garland = decos.find(({ d }) => d.id === "photo_garland");
    if (garland) this.drawPhotoGarland(g, garland.p.x);
    if (input.holiday.includes("hearts")) this.drawHeartGarland(g, 8, 52, S.WALL_TOP + 3);
    if (input.milestoneDay) this.put(g, "banner", 51, S.WALL_TOP);
    if (input.holiday.includes("crescent")) {
      px(g, "#d9d4c8", 73, H.window.y + 1, 1, 3);
      this.put(g, "crescent", 68, H.window.y + 4);
    }

    for (const { d, p } of decos.filter(({ p }) => p.sprite.startsWith("rug"))) {
      const s = this.decorationSprite(d, p.sprite, input.accent);
      if (s) this.put(g, s, p.x - s.width / 2, p.y - s.height / 2, p.flip);
    }

    const items: Item[] = [];
    const stand = (s: HTMLCanvasElement | undefined, spot: { cx: number; bottom: number }) => {
      if (!s) return;
      const x = Math.round(spot.cx - s.width / 2);
      items.push({ bottom: spot.bottom, draw: (gg) => gg.drawImage(s, x, spot.bottom - s.height) });
    };
    const on = (s: HTMLCanvasElement | undefined, x: number, bottom: number, sortAs: number) => {
      if (s) items.push({ bottom: sortAs, draw: (gg) => gg.drawImage(s, Math.round(x), Math.round(bottom - s.height)) });
    };
    stand(F.desk, S.STANDING.desk);
    stand(F.bed, S.STANDING.bed);
    stand(F.lamp, S.STANDING.lamp);
    stand(fav.books.length ? this.cached(`books:${this.art.id}:${fav.books.join("")}`, () => recolorBooks(F.bookcase, fav.books)) : F.bookcase, S.STANDING.bookcase);
    stand(F.speaker, S.STANDING.speaker);
    stand(F.table, S.STANDING.table);
    on(this.sprite("pinned_record"), 118, S.STANDING.bookcase.bottom - 31, S.STANDING.bookcase.bottom + 0.5);
    on(F.shelfPlant, H.shelf_plant.x + 3, H.shelf_plant.y + F.shelfPlant.height, S.STANDING.bookcase.bottom + 0.5);
    const deskTop = S.DESK_TOP;
    const deskSort = S.STANDING.desk.bottom + 0.5;
    on(this.cached(`snack:${fav.food}`, () => snackSprite(fav.food)), S.SNACK.x, deskTop, deskSort);
    on(this.sprite("cassette_tray"), S.CASSETTE.x - 1, deskTop, deskSort);
    if (input.mixtape) on(this.cached(`mixtape:${input.mixtape}`, () => wrappedCassette(input.mixtape!)), S.CASSETTE.x, deskTop - 4, deskSort + 0.1);
    const tray = input.weekendTray ? this.sprite("breakfast") : this.cached(`drink:${fav.drink}`, () => drinkTray(fav.drink));
    on(tray, S.TRAY.x - (input.weekendTray ? 1 : 0), S.TRAY.y + 8, S.STANDING.table.bottom + 0.5);
    const bed = this.cached(`pet_bed:${input.accent}`, () => petBed(input.accent));
    items.push({ bottom: S.PET_BED.y + bed.height, draw: (gg) => gg.drawImage(bed, S.PET_BED.x, S.PET_BED.y) });
    const stage = S.PLANT_STAGES[Math.max(0, Math.min(S.PLANT_STAGES.length - 1, input.plantStage))];
    let px0 = S.PLANTS.x;
    for (const name of stage) {
      const s = this.sprite(name);
      if (!s) continue;
      on(s, px0, S.PLANTS.base, S.PLANTS.base);
      px0 += s.width - 2;
    }
    items.push(...this.art.props(this.kit, look));
    for (const { d, p } of decos) {
      if (p.sprite.startsWith("rug") || d.id === "bunting" || d.id === "photo_garland" || d.id === "star_lantern") continue;
      const s = this.decorationSprite(d, p.sprite, input.accent);
      if (!s) continue;
      if (d.id === "hanging_plant") {
        items.push({ bottom: -1, draw: (gg) => this.put(gg, s, p.x - s.width / 2, S.WALL_TOP + 6, p.flip) });
        continue;
      }
      const x = p.x - s.width / 2;
      const y = p.y - s.height;
      items.push({
        bottom: p.y,
        draw: (gg) => {
          this.put(gg, s, x, y, p.flip);
          if (d.id === "vase") gg.drawImage(this.cached(`flowers:${fav.flower}`, () => flowerBunch(fav.flower)), Math.round(p.x - 7), Math.round(y - 9));
        },
      });
    }
    if (input.holiday.includes("tree")) stand(this.sprite("tree"), { cx: 178, bottom: 170 });
    if (input.holiday.includes("balloons")) on(this.sprite("balloons"), 232, 152, 152);
    if (input.milestoneDay) {
      on(this.sprite("balloons_pink"), 88, 134, 151);
      on(this.sprite("balloons"), 240, 128, 128);
    }
    items.sort((a, b) => a.bottom - b.bottom);
    for (const it of items) it.draw(g);

    const bunting = decos.find(({ d }) => d.id === "bunting");
    if (bunting) this.drawPennants(g, [S.ROOF_X0 + 2, 92, 282, 88, 8], [input.accent, "#faf6ee", "#e0b870", "#4985cc"], "triangle");
    if (input.holiday.includes("string_flags")) this.drawPennants(g, [162, 84, 306, 74, 12], FLAG_COLORS, "square");
    if (input.holiday.includes("lanterns")) for (const x of [186, 236, 286]) this.hangFromWire(g, this.sprite("lantern")!, x, 3);
    const star = decos.find(({ d }) => d.id === "star_lantern");
    if (star) this.hangFromWire(g, this.sprite("star_lantern")!, star.p.x, 4);
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.worldCache = { key, canvas: c };
    return c;
  }

  private hangFromWire(g: CanvasRenderingContext2D, s: HTMLCanvasElement, x: number, drop: number) {
    const y = Math.round(this.wireY(x)) + 1;
    px(g, INK, x, y, 1, drop);
    g.drawImage(s, Math.round(x - s.width / 2) + 1, y + drop);
  }

  private drawPennants(g: CanvasRenderingContext2D, [x0, y0, x1, y1, sag]: number[], colors: string[], shape: "triangle" | "square") {
    const yAt = (x: number) => {
      const u = (x - x0) / (x1 - x0);
      return Math.round(y0 + (y1 - y0) * u + sag * 4 * u * (1 - u));
    };
    for (let x = x0; x <= x1; x++) px(g, INK, x, yAt(x));
    for (let x = x0 + 6, i = 0; x < x1 - 4; x += shape === "square" ? 7 : 9, i++) {
      const y = yAt(x) + 1;
      const col = colors[i % colors.length];
      if (shape === "triangle") {
        for (let j = 0; j < 5; j++) px(g, j === 0 ? INK : col, x - 2 + Math.floor(j / 2), y + j, 5 - j, 1);
      } else {
        px(g, INK, x - 2, y, 5, 5);
        px(g, col, x - 1, y, 3, 4);
        px(g, mixHex(col, "#ffffff", 0.3), x - 1, y, 3, 1);
      }
    }
  }

  private drawPhotoGarland(g: CanvasRenderingContext2D, cx: number) {
    const x0 = Math.max(S.ROOM_X0 + 2, cx - 26);
    const x1 = Math.min(S.DIVIDER_X - 2, cx + 26);
    const y0 = S.WALL_TOP + 3;
    const yAt = (x: number) => Math.round(y0 + 4 * 4 * ((x - x0) / (x1 - x0)) * (1 - (x - x0) / (x1 - x0)));
    for (let x = x0; x <= x1; x++) px(g, "#d9d4c8", x, yAt(x));
    for (let i = 0, x = x0 + 5; x < x1 - 3; x += 10, i++) {
      const p = this.cached(`polaroid:${i % 5}`, () => polaroid(i));
      g.drawImage(p, x - 2, yAt(x) + 1);
      px(g, "#c4844a", x - 1, yAt(x), 2, 1);
    }
  }

  private drawHeartGarland(g: CanvasRenderingContext2D, x0: number, x1: number, y0: number) {
    const yAt = (x: number) => Math.round(y0 + 3 * 4 * ((x - x0) / (x1 - x0)) * (1 - (x - x0) / (x1 - x0)));
    for (let x = x0; x <= x1; x++) px(g, "#d9d4c8", x, yAt(x));
    for (let i = 0, x = x0 + 3; x < x1 - 2; x += 6, i++) g.drawImage(HEART_SMALL(i % 2 ? "#f7a6c4" : "#e0475a"), x - 1, yAt(x) + 1);
  }

  private drawSky(sky: SkyState, weather: Weather | null) {
    const { w, h, y: top } = this.cam;
    const grey = weather && ["rain", "drizzle", "thunderstorm", "fog"].includes(weather.condition);
    const cover = grey ? 0.45 : weather?.condition === "clouds" ? 0.2 : weather?.condition === "snow" ? 0.3 : 0;
    const key = `${w}x${h}@${top}|${this.cam.x & 3}|${sky.top}|${sky.horizon}|${cover}`;
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
    const heavy = weather && ["rain", "drizzle", "thunderstorm", "snow"].includes(weather.condition);
    const cover = weather ? (heavy ? 100 : weather.condition === "fog" ? 60 : weather.cloud_cover) : 25;
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

  private themed(input: RoomInput): RoomInput {
    const a = this.art;
    if (!a.sky && !a.weather && !a.season) return input;
    return {
      ...input,
      sky: a.sky ? a.sky(input.sky) : input.sky,
      weather: a.weather ? a.weather(input.weather) : input.weather,
      season: a.season ? a.season(input.season, input.weather) : input.season,
    };
  }

  frame(t: number, f: FrameInput) {
    if (!this.input) return;
    const input = this.themed(this.input);
    const still = input.reducedMotion;
    const tt = still ? 0 : t;
    const dt = Math.min(0.25, Math.max(0, t - this.last));
    this.last = t;
    const { sky, weather } = input;
    const { w, h, x: cx, y: cy } = this.cam;
    const g = this.bg;
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    this.stepLight(input, t, still);

    g.drawImage(this.drawSky(sky, weather), 0, 0);
    const clear = !weather || ["clear", "clouds"].includes(weather.condition);
    if (sky.night > 0.05 && clear) {
      for (const s of this.stars) {
        const x = Math.round((((s.x + 260) % 840) / 840) * Math.max(w, 340));
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
    this.drawSongStars(g, input, tt);
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
    const back = this.drawBackdrop(input);
    const cg = this.cg;
    cg.globalCompositeOperation = "source-over";
    cg.clearRect(0, 0, w, h);
    cg.drawImage(back.canvas, cx - B.x, cy - B.y, w, h, 0, 0, w, h);
    const anim = { sky, weather, season: input.season, t: tt, still, cx, cy, w, h };
    this.art.animateBackdrop?.(cg, anim);
    if (tint.a > 0.01) {
      cg.globalCompositeOperation = "source-atop";
      cg.fillStyle = rgba(tint.color, tint.a);
      cg.fillRect(0, 0, w, h);
      cg.globalCompositeOperation = "source-over";
    }
    cg.drawImage(back.lights, cx - B.x, cy - B.y, w, h, 0, 0, w, h);
    g.drawImage(this.city, 0, 0);
    this.drawPrecipitation(g, input, tt, still, "far");

    const wg = this.wg;
    wg.globalCompositeOperation = "source-over";
    wg.globalAlpha = 1;
    wg.clearRect(0, 0, w, h);
    wg.drawImage(this.drawWorld(input), cx - W.x, cy - W.y, w, h, 0, 0, w, h);
    if (input.otherSky) this.drawOtherWindow(wg, input.otherSky, input.otherWeather, tt);
    this.art.animate?.(wg, anim);
    this.spin += dt * 0.55 * f.playing;
    const rp = this.record.frame(dt, still ? 0 : this.spin, f.playing > 0.5 ? 1 : 0, f.pulse, input.accent, still);
    wg.drawImage(rp, S.RECORD_PLAYER.x - cx, S.RECORD_PLAYER.y - cy);
    this.drawAvatars(wg, input, tt, f);
    this.drawKitten(wg, input, t, f);
    this.drawUnlocking(wg, input, "item");
    this.drawLightsWire(wg);
    this.drawSnowCaps(wg, input);
    if (tint.a > 0.01) {
      wg.globalCompositeOperation = "source-atop";
      wg.fillStyle = rgba(tint.color, tint.a);
      wg.fillRect(0, 0, w, h);
      wg.globalCompositeOperation = "source-over";
    }
    g.drawImage(this.world, 0, 0);

    this.drawLights(g, input, tt, f, anim);
    this.drawNotes(g, input, tt);
    this.drawHearts(g, t, f.pets, still);
    this.drawPrecipitation(g, input, tt, still, "near");
    this.drawGlass(g, input, tt, still);
    this.drawUnlocking(g, input, "sparkles");
    this.drawHighlight(g, input, t);

    this.g.imageSmoothingEnabled = false;
    this.g.drawImage(this.buf, 0, 0, w * this.cam.scale, h * this.cam.scale);
  }

  private stepLight(input: RoomInput, t: number, still: boolean) {
    const target = input.light;
    const key = `${target.color}|${target.level.toFixed(3)}|${target.spread.toFixed(3)}`;
    if (key === this.light.key) return;
    const now = this.currentLight(t);
    this.light = { from: still ? target : now, to: target, start: t, key };
  }

  lightNow(): RoomLight {
    return this.currentLight(this.last);
  }

  private currentLight(t: number): RoomLight {
    const k = (t - this.light.start) / LIGHT_SECONDS;
    return k >= 1 ? this.light.to : blendLight(this.light.from, this.light.to, smooth(Math.max(0, k)));
  }

  private tint(input: RoomInput) {
    const { sky, weather } = input;
    let color = sky.tint;
    let a = sky.tintAlpha;
    if (weather && ["rain", "drizzle", "thunderstorm", "fog", "snow"].includes(weather.condition)) {
      color = mixHex(color, "#56607a", a > 0.3 ? 0.4 : 0.8);
      a = Math.min(0.7, a + 0.12);
    }
    if (input.weekendMorning > 0) {
      color = mixHex(color, "#ffd9a0", 0.5 * input.weekendMorning);
      a = Math.max(a, 0.08 * input.weekendMorning);
    }
    return { color, a };
  }

  private drawOtherWindow(g: CanvasRenderingContext2D, other: SkyState, weather: Weather | null, t: number) {
    const m = this.glass.second;
    const x = m.x - this.cam.x;
    const y = m.y - this.cam.y;
    const c = weather?.condition;
    const grey = c && ["rain", "drizzle", "thunderstorm", "fog", "snow"].includes(c);
    g.save();
    g.globalCompositeOperation = "destination-over";
    const top = grey ? mixHex(other.top, other.night > 0.5 ? "#1d2131" : "#8e94a1", 0.45) : other.top;
    const bottom = grey ? mixHex(other.horizon, other.night > 0.5 ? "#1d2131" : "#8e94a1", 0.45) : other.horizon;
    if (c === "clouds" || grey) {
      const cl = other.night > 0.5 ? "#4a5070" : "#e8ecf2";
      const shift = Math.floor(t * 0.8) % m.w;
      for (let i = 0; i < m.w; i++) {
        const xx = (i + shift) % m.w;
        if (Math.sin(i * 0.9) > -0.2) px(g, cl, x + xx, y + 2 + (i % 3 === 0 ? 1 : 0), 1, grey ? 4 : 2);
      }
    }
    if (!grey && other.night > 0.5) {
      for (const [sx, sy] of [[6, 4], [15, 6], [19, 3], [10, 8]] as const) px(g, "#fffbea", x + sx, y + sy);
      if (other.moon.altitude > 0) px(g, "#f7f0d6", x + 4, y + 3, 2, 2);
    }
    if (!grey && other.sunAltitude > 0) px(g, other.sunAltitude < 8 ? "#ffc88a" : "#fff4d8", x + 18, y + 4, 2, 2);
    const grad = g.createLinearGradient(0, y, 0, y + m.h);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(x, y, m.w, m.h);
    g.restore();
  }

  private drawKitten(g: CanvasRenderingContext2D, input: RoomInput, t: number, f: FrameInput) {
    const still = input.reducedMotion;
    const k = this.kitten;
    const pose = input.kittenPose;
    const awake = pose ? pose !== "sleep" : f.awake;
    let s: HTMLCanvasElement;
    let x: number;
    let y: number;
    if (!awake) {
      s = !still && Math.floor(t / 1.6) % 2 ? k.sleep2 : k.sleep;
      x = S.KITTEN.asleep.x;
      y = S.KITTEN.asleep.y;
      this.wasAwake = false;
    } else {
      if (!this.wasAwake) {
        this.wasAwake = true;
        this.idle = { kind: null, start: 0, next: t + 4 + Math.random() * 5 };
      }
      let kind: Idle["kind"] = pose && pose !== "sit" && pose !== "sleep" ? pose : null;
      let k01 = 0.5;
      if (!pose && !still) {
        if (!this.idle.kind && t >= this.idle.next) {
          const kinds = ["stretch", "yawn", "look"] as const;
          this.idle = { kind: kinds[Math.floor(Math.random() * kinds.length)], start: t, next: 0 };
        }
        if (this.idle.kind) {
          const dur = IDLE_SECONDS[this.idle.kind];
          k01 = (t - this.idle.start) / dur;
          if (k01 >= 1) this.idle = { kind: null, start: 0, next: t + 14 + Math.random() * 12 };
          else kind = this.idle.kind;
        }
      }
      const base = S.KITTEN.awake;
      const bob = f.pulse > 0.5 && !still ? 1 : 0;
      if (kind === "stretch") {
        s = k01 < 0.18 || k01 > 0.82 ? k.stand : k.stretch;
        x = base.x - 3;
        y = base.y + 15 - s.height;
      } else if (kind === "yawn") {
        s = k01 > 0.15 && k01 < 0.85 ? k.yawn : k.blink;
        x = base.x;
        y = base.y;
      } else if (kind === "look") {
        s = k.back;
        x = base.x;
        y = base.y;
      } else {
        const cycle = still ? 0 : t % 9;
        s = cycle > 8.7 ? k.blink : cycle > 5 && cycle < 6 ? k.tail : cycle > 3 && cycle < 3.3 ? k.ear : k.sit;
        x = base.x;
        y = base.y + bob;
      }
    }
    this.kittenPos = { x, y, w: s.width, h: s.height };
    g.drawImage(s, x - this.cam.x, y - this.cam.y);
  }

  private drawAvatars(g: CanvasRenderingContext2D, input: RoomInput, t: number, f: FrameInput) {
    this.avatarPos.clear();
    const { me, other, together } = input.avatars;
    const still = input.reducedMotion;
    const SEQ = [0, 0, 1, 1, 2, 3, 3, 2, 1, 1, 0, 0, 0, 4, 5, 0];
    const frameAt = (offset: number) => (still ? 0 : SEQ[Math.floor(t * 4 + offset) % SEQ.length]);
    const place = (a: AvatarView, x: number, feet: number, offset: number) => {
      const listening = a.pose === "listening";
      const list = listening ? a.frames.standPhones : a.frames.stand;
      const s = list[frameAt(offset)] ?? list[0];
      const nod = listening && f.pulse > 0.5 && !still ? 1 : 0;
      g.drawImage(s, x - this.cam.x, feet - 32 + nod - this.cam.y);
      this.avatarPos.set(a.id, { x, y: feet - 24, w: 16, h: 24 });
    };
    if (together && me && other) {
      const seats = S.AVATARS.together;
      const pillow = this.cached("cushion:a", () => cushion("#e88fa3"));
      const pillow2 = this.cached("cushion:b", () => cushion("#8f85a9"));
      g.drawImage(pillow, seats[0].x - this.cam.x, seats[0].y - 5 - this.cam.y);
      g.drawImage(pillow2, seats[1].x - this.cam.x, seats[1].y - 5 - this.cam.y);
      const sit = (a: AvatarView, seat: { x: number; y: number }, list: HTMLCanvasElement[], offset: number) => {
        const s = list[still ? 0 : Math.floor(t * 3 + offset) % list.length] ?? list[0];
        g.drawImage(s, seat.x - this.cam.x, seat.y - 30 - this.cam.y);
        this.avatarPos.set(a.id, { x: seat.x, y: seat.y - 24, w: 16, h: 22 });
      };
      sit(me, seats[0], me.frames.sitRight, 0);
      sit(other, seats[1], other.frames.sitLeft, 2);
      return;
    }
    if (me) place(me, S.AVATARS.me.x, S.AVATARS.me.y, 0);
    if (other) place(other, S.AVATARS.other.x, S.AVATARS.other.y, 5);
  }

  private drawUnlocking(g: CanvasRenderingContext2D, input: RoomInput, layer: "item" | "sparkles") {
    const u = input.unlocking;
    if (!u) return;
    const spot = this.decorationSpot(u.id);
    if (!spot) return;
    const still = input.reducedMotion;
    const k = still ? 1 : Math.min(1, (Date.now() - u.at) / 1000 / UNLOCK_SECONDS);
    const x = spot.x - this.cam.x;
    const y = spot.y - this.cam.y;
    if (layer === "item") {
      const d = DECORATIONS.find((dd) => dd.id === u.id);
      if (!d) return;
      const p = placementOf(d, input.layout.items[d.id]);
      if (HANGING_DECORATIONS.has(d.id) && d.id !== "hanging_plant" && d.id !== "star_lantern") return;
      const s = this.decorationSprite(d, p.sprite, input.accent);
      if (!s) return;
      const rise = still ? 0 : Math.round(8 * (1 - smooth(Math.min(1, k / 0.45))));
      const top = d.id === "hanging_plant" ? S.WALL_TOP + 6 : d.id === "star_lantern" ? Math.round(this.wireY(p.x)) + 5 : p.y - s.height;
      g.globalAlpha = still ? 1 : Math.min(1, k / 0.3);
      this.put(g, s, p.x - s.width / 2 - this.cam.x, top - rise - this.cam.y, p.flip);
      g.globalAlpha = 1;
      return;
    }
    const fade = Math.sin(Math.PI * Math.min(1, k));
    g.globalCompositeOperation = "lighter";
    const col = g.createLinearGradient(0, y - 46, 0, y + 6);
    col.addColorStop(0, "rgba(255,240,200,0)");
    col.addColorStop(1, `rgba(255,240,200,${0.35 * fade})`);
    g.fillStyle = col;
    g.fillRect(Math.round(x - 7), Math.round(y - 46), 14, 52);
    g.globalCompositeOperation = "source-over";
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 1.5;
      const r = 4 + smooth(k) * 14;
      g.globalAlpha = still ? 0.9 : Math.max(0, 1 - k) * 0.95;
      g.drawImage(this.sparkle, Math.round(x + Math.cos(a) * r - 2), Math.round(y + Math.sin(a) * r * 0.7 - 2));
    }
    g.globalAlpha = 1;
  }

  private drawSongStars(g: CanvasRenderingContext2D, input: RoomInput, t: number) {
    this.songHits = [];
    const { sky } = input;
    this.skyAnchor = null;
    if (sky.night < 0.3) return;
    const { w, h, x: cx, y: cy } = this.cam;
    const top = Math.max(cy + 34, -150);
    const bottom = 46;
    const span = bottom - top;
    this.skyAnchor = { x: cx + Math.round(w * 0.66), y: Math.round(top + span * 0.25) };
    if (!input.songStars.length || span < 30) return;
    const key = `${input.songStars.map((s) => s.id).join(",")}|${w}x${span}`;
    if (this.songLayout?.key !== key) this.songLayout = { key, layout: layoutStars(input.songStars, { maxMonths: 6, maxPerMonth: 8, aspect: (w * 0.86) / span }) };
    const { layout } = this.songLayout;
    const pos = layout.stars.map((s) => ({ id: s.id, x: Math.round(w * (0.07 + s.x * 0.86)), y: Math.round(top + s.y * span) - cy }));
    const fade = Math.min(1, (sky.night - 0.3) / 0.4);
    const dim = input.weather && !["clear", "clouds"].includes(input.weather.condition) ? 0.6 : 1;
    g.fillStyle = `rgba(255,214,232,${0.28 * fade * dim})`;
    for (const [a, b] of layout.lines) {
      const p = pos[a];
      const q = pos[b];
      const n = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / 2));
      for (let i = 1; i < n; i++) g.fillRect(Math.round(p.x + ((q.x - p.x) * i) / n), Math.round(p.y + ((q.y - p.y) * i) / n), 1, 1);
    }
    pos.forEach((p, i) => {
      if (p.x < 1 || p.y < 1 || p.x >= w - 1 || p.y >= h - 1) return;
      const tw = 0.75 + 0.25 * Math.sin(t * 1.3 + i * 2.1);
      g.globalAlpha = fade * dim * tw;
      px(g, "#ffd6e8", p.x - 1, p.y, 3, 1);
      px(g, "#ffd6e8", p.x, p.y - 1, 1, 3);
      px(g, "#ffffff", p.x, p.y);
      this.songHits.push(p);
    });
    g.globalAlpha = 1;
    const newest = layout.months[layout.months.length - 1];
    if (newest) this.skyAnchor = { x: cx + Math.round(w * (0.07 + newest.x * 0.86)), y: Math.round(top + newest.y * span) - 8 };
  }

  private drawLightsWire(g: CanvasRenderingContext2D) {
    const L = S.LIGHTS;
    const { x: cx, y: cy } = this.cam;
    px(g, INK, L.x1 - 1 - cx, L.y1 - 2 - cy, 3, S.FLOOR_Y + 8 - L.y1);
    px(g, "#9097b1", L.x1 - cx, L.y1 - 1 - cy, 1, S.FLOOR_Y + 6 - L.y1);
    for (let x = L.x0; x <= L.x1; x++) px(g, INK, x - cx, Math.round(this.wireY(x)) - cy);
  }

  private glowAt(g: CanvasRenderingContext2D, x: number, y: number, col: string, r: number, a: number) {
    const gl = g.createRadialGradient(x, y, 0, x, y, r);
    gl.addColorStop(0, rgba(col, a));
    gl.addColorStop(1, rgba(col, 0));
    g.fillStyle = gl;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  private drawLights(g: CanvasRenderingContext2D, input: RoomInput, t: number, f: FrameInput, anim: Parameters<NonNullable<RoomArt["glow"]>>[1]) {
    const { sky } = input;
    const { x: cx, y: cy } = this.cam;
    const on = sky.lamp > 0.05 || sky.night > 0.3;
    const L = S.LIGHTS;
    const light = this.currentLight(t || this.last);
    const level = 1 + (light.level - 1) * f.playing;
    const warm = mixHex("#ffcf7a", light.color, f.playing);
    g.globalCompositeOperation = "lighter";
    let i = 0;
    for (let x = L.x0 + 5; x < L.x1 - 2; x += 8, i++) {
      const y = Math.round(this.wireY(x)) + 1;
      const col = i % 3 === 0 ? "#ffd27a" : i % 3 === 1 ? "#ff9fb2" : "#a8e0ff";
      if (on) this.glowAt(g, x - cx + 0.5, y - cy + 1, col, 7, ((0.16 + sky.night * 0.16) * (0.8 + 0.2 * Math.sin(t * 1.7 + i * 1.3)) + f.pulse * 0.12) * level);
    }
    if (f.playing > 0.01) {
      g.fillStyle = rgba(light.color, 0.06 * level * f.playing * (on ? 1 : 0.6));
      const [ix, iy, iw, ih] = [S.ROOM_X0, S.WALL_TOP, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.WALL_TOP];
      g.fillRect(ix - cx, iy - cy, iw, ih);
    }
    if (input.lamp.on) {
      const lx = S.ANCHORS.lamp[0] - cx;
      const ly = S.ANCHORS.lamp[1] + 6 - cy;
      const shared = input.lamp.signal ? mixHex(warm, "#ff9fb2", 0.35) : warm;
      const a = (0.18 + sky.night * 0.22 + (input.lamp.signal && sky.night < 0.3 ? 0.12 : 0)) * level + f.pulse * 0.12;
      const r = 70 * (1 + (light.spread - 1) * f.playing);
      g.save();
      g.beginPath();
      g.rect(S.ROOM_X0 - cx, S.WALL_TOP - cy, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.WALL_TOP);
      g.clip();
      const gl = g.createRadialGradient(lx, ly, 2, lx, ly, r);
      gl.addColorStop(0, rgba(shared, a));
      gl.addColorStop(0.4, rgba(shared, a * 0.45));
      gl.addColorStop(1, rgba(shared, 0));
      g.fillStyle = gl;
      g.fillRect(lx - r - 2, ly - r - 2, r * 2 + 4, r * 2 + 4);
      g.restore();
    }
    if (input.weekendMorning > 0.01) {
      const wx = S.HANGING.window.x - cx;
      const wy = S.HANGING.window.y - cy;
      g.save();
      g.beginPath();
      g.moveTo(wx + 4, wy + 4);
      g.lineTo(wx + 30, wy + 4);
      g.lineTo(wx + 70, S.FRONT_Y - 2 - cy);
      g.lineTo(wx + 26, S.FRONT_Y - 2 - cy);
      g.closePath();
      const beam = g.createLinearGradient(0, wy, 0, S.FRONT_Y - cy);
      beam.addColorStop(0, `rgba(255,228,170,${0.22 * input.weekendMorning})`);
      beam.addColorStop(1, `rgba(255,228,170,${0.05 * input.weekendMorning})`);
      g.fillStyle = beam;
      g.fill();
      g.restore();
      const r = rng(31);
      for (let k = 0; k < 9; k++) {
        const u = r();
        const v = r();
        const yy = wy + 8 + v * (S.FRONT_Y - S.HANGING.window.y - 12);
        const xx = wx + 8 + (yy - wy) * 0.55 + u * 20 + Math.sin(t * 0.6 + k) * 2;
        g.fillStyle = `rgba(255,240,200,${0.5 * input.weekendMorning * (0.5 + 0.5 * Math.sin(t * 0.9 + k * 1.7))})`;
        g.fillRect(Math.round(xx), Math.round(yy + Math.sin(t * 0.4 + k) * 2), 1, 1);
      }
    }
    const glowDeco = (id: string, col: string, r: number, a: number) => {
      const spot = input.unlocked.has(id) || !DECORATIONS.find((d) => d.id === id)?.unlock ? this.decorationSpot(id) : null;
      const d = DECORATIONS.find((x) => x.id === id);
      if (!spot || !d || placementOf(d, input.layout.items[d.id]).hidden) return;
      this.glowAt(g, spot.x - cx, spot.y - cy, col, r, a);
    };
    if (on) {
      glowDeco("fairy_jar", "#fff1a8", 14, 0.3 + f.pulse * 0.2);
      glowDeco("moon_lamp", "#fff1c4", 18, 0.28 + f.pulse * 0.15);
      glowDeco("star_lantern", "#ffe9a8", 16, 0.32 + f.pulse * 0.15);
      if (input.holiday.includes("lanterns")) for (const x of [186, 236, 286]) this.glowAt(g, x + 1 - cx, this.wireY(x) + 9 - cy, "#ffcf5a", 13, 0.32 + f.pulse * 0.1);
      if (input.holiday.includes("crescent")) this.glowAt(g, 73 - cx, S.HANGING.window.y + 9 - cy, "#ffd86a", 10, 0.22);
      if (input.unlocked.has("anniversary_cake")) glowDeco("anniversary_cake", "#ffcf7a", 6, 0.35);
    }
    glowDeco("disco_ball", "#c6cbe0", 10, 0.12 + f.pulse * 0.3);
    this.art.glow?.(g, anim);
    g.globalCompositeOperation = "source-over";
    i = 0;
    for (let x = L.x0 + 5; x < L.x1 - 2; x += 8, i++) {
      const y = Math.round(this.wireY(x)) + 1;
      const col = i % 3 === 0 ? "#ffd27a" : i % 3 === 1 ? "#ff9fb2" : "#a8e0ff";
      px(g, on ? col : mixHex(col, "#5b5f78", 0.6), x - cx, y - cy, 1, 2);
    }
    if (input.lamp.on) {
      const lamp = this.furniture.lamp;
      const lx = Math.round(S.STANDING.lamp.cx - lamp.width / 2) - cx;
      const ly = S.STANDING.lamp.bottom - lamp.height - cy;
      px(g, mixHex(warm, "#ffffff", 0.5), lx + 4, ly + 4, 7, 2);
      if (input.lamp.signal) {
        const bob = input.reducedMotion ? 0 : Math.round(Math.sin(t * 2) * 1);
        g.drawImage(this.heart, lx + 4, ly - 8 + bob);
      }
    }
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
      const a = this.anchorScene(spot);
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

  private indoors(sx: number, sy: number) {
    const [x, y, w, h] = S.INDOORS;
    return sx >= x && sx < x + w && sy >= y && sy < y + h;
  }

  private drawPrecipitation(g: CanvasRenderingContext2D, input: RoomInput, t: number, still: boolean, layer: "far" | "near") {
    const { weather, season, sky } = input;
    const { w, h, x: cx, y: cy } = this.cam;
    const c = weather?.condition ?? "clear";
    const far = layer === "far";
    if (rainy(c)) {
      const n = c === "drizzle" ? 40 : c === "rain" ? 90 : 130;
      const len = c === "drizzle" ? 2 : far ? 3 : 4;
      const count = far ? Math.round(n * 0.7) : n;
      g.fillStyle = far
        ? sky.night > 0.5 ? "rgba(150,165,210,0.35)" : "rgba(205,215,240,0.4)"
        : sky.night > 0.5 ? "rgba(170,185,230,0.5)" : "rgba(220,230,250,0.6)";
      for (let i = 0; i < count; i++) {
        const d = this.drops[far ? 199 - i : i];
        const v = d.v * (far ? 0.7 : 1) * (c === "drizzle" ? 0.6 : 1);
        const y = ((d.y + t * v) % (h + 20)) - 10;
        const x = ((((d.x - t * v * 0.2) % (w + 40)) + w + 40) % (w + 40)) - 20;
        if (!far && this.indoors(x + cx, y + cy)) continue;
        g.fillRect(Math.round(x), Math.round(y), 1, len);
      }
      if (!far && !still && c !== "drizzle") {
        const r = rng(Math.floor(t * 12) + 3);
        g.fillStyle = "rgba(220,230,250,0.5)";
        for (let i = 0; i < 10; i++) {
          const x = S.ROOF_X0 + 4 + Math.floor(r() * (S.ROOF_X1 - S.ROOF_X0 - 8)) - cx;
          const y = S.FLOOR_Y + 4 + Math.floor(r() * (S.FRONT_Y - S.FLOOR_Y - 6)) - cy;
          g.fillRect(x - 1, y, 1, 1);
          g.fillRect(x + 1, y, 1, 1);
        }
      }
    }
    const snowing = c === "snow" || (season === "winter" && !rainy(c));
    if (snowing) {
      const n = c === "snow" ? (far ? 70 : 110) : far ? 20 : 40;
      g.fillStyle = far ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.9)";
      for (let i = 0; i < n; i++) {
        const d = this.drops[far ? 199 - i : i];
        const speed = (12 + d.s * 10) * (far ? 0.6 : 1);
        const y = ((d.y + t * speed) % (h + 10)) - 5;
        const x = ((((d.x + Math.sin(t * 0.8 + i) * 6) % (w + 10)) + w + 10) % (w + 10)) - 5;
        if (!far && this.indoors(x + cx, y + cy)) continue;
        const big = !far && d.s > 0.7;
        g.fillRect(Math.round(x), Math.round(y), big ? 2 : 1, big ? 2 : 1);
      }
    }
    if (far) return;
    if (c === "fog") {
      const fog = g.createLinearGradient(0, 0, 0, h);
      const col = sky.night > 0.5 ? "60,66,92" : "205,210,220";
      fog.addColorStop(0, `rgba(${col},0.15)`);
      fog.addColorStop(0.6, `rgba(${col},0.38)`);
      fog.addColorStop(1, `rgba(${col},0.22)`);
      g.fillStyle = fog;
      g.fillRect(0, 0, w, h);
    }
    if (rainy(c)) return;
    if (season === "autumn" || season === "spring") {
      const colors = season === "autumn" ? [["#e8924a", "#a8502c"], ["#e0b870", "#a8783a"], ["#c9572f", "#7d3322"]] : [["#ffd3df", "#e88fa3"], ["#fff1f4", "#f2b6c6"], ["#f7c6d0", "#d9879d"]];
      for (let i = 0; i < 9; i++) {
        const d = this.drops[i + 40];
        const y = ((d.y + t * (7 + d.s * 6)) % (h + 20)) - 10;
        const x = ((((d.x + t * 5 + Math.sin(t * 0.9 + i) * 12) % (w + 20)) + w + 20) % (w + 20)) - 10;
        if (this.indoors(x + cx, y + cy)) continue;
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
        const x = Math.round(S.ROOF_X0 + 6 + ((d.x + Math.sin(t * 0.4 + i) * 14) % 140)) - cx;
        const y = Math.round(S.PARAPET_Y - 20 + ((d.y + Math.cos(t * 0.5 + i) * 10) % 60)) - cy;
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

  private drawGlass(g: CanvasRenderingContext2D, input: RoomInput, t: number, still: boolean) {
    const one = (m: Mask, weather: Weather | null, seed: number) => {
      const c = weather?.condition;
      if (!rainy(c) || !m.points.length) return;
      const area = m.points.length;
      const runs = Math.max(1, Math.round((area / 60) * (c === "drizzle" ? 0.4 : c === "rain" ? 0.8 : 1.1)));
      const beads = Math.round((area / 12) * (c === "drizzle" ? 0.6 : c === "rain" ? 1 : 1.3));
      const ox = m.x - this.cam.x;
      const oy = m.y - this.cam.y;
      const dot = (x: number, y: number, col: string) => {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h || !m.on[y * m.w + x]) return;
        g.fillStyle = col;
        g.fillRect(ox + x, oy + y, 1, 1);
      };
      const r = rng(seed);
      for (let i = 0; i < beads; i++) {
        const [x, y] = m.points[Math.floor(r() * area)];
        const life = still ? 0.5 : (t * 0.12 + r()) % 1;
        const a = Math.sin(life * Math.PI);
        if (a < 0.15) continue;
        dot(x, y, `rgba(232,240,255,${0.85 * a})`);
        dot(x, y + 1, `rgba(30,36,60,${0.35 * a})`);
      }
      for (let i = 0; i < runs; i++) {
        const [x, top, bottom] = m.runs[Math.floor(r() * m.runs.length)];
        const span = bottom - top + 1;
        const speed = 2.5 + r() * 4;
        const p = (still ? r() * span : t * speed + r() * 40 + Math.sin(t * 1.3 + i * 2) * 1.5) % (span + 4);
        const y = top + Math.floor(p);
        dot(x, y, "rgba(245,249,255,0.95)");
        dot(x, y + 1, "rgba(30,36,60,0.35)");
        for (let k = 1; k <= 3; k++) dot(x, y - k, `rgba(215,228,255,${0.45 - k * 0.12})`);
      }
    };
    one(this.glass.main, input.weather, 101);
    if (input.otherSky) one(this.glass.second, input.otherWeather, 202);
  }

  private drawSnowCaps(g: CanvasRenderingContext2D, input: RoomInput) {
    if (input.weather?.condition !== "snow") return;
    const { x: cx, y: cy } = this.cam;
    g.fillStyle = "#f4f7ff";
    g.fillRect(S.ROOF_X0 - 1 - cx, S.PARAPET_Y - cy, S.SCENE_W - S.ROOF_X0 + 1, 2);
    g.fillRect(0 - cx, S.WALL_TOP - cy, S.ROOM_X0 + 1, 1);
    g.fillRect(S.DIVIDER_X - cx, S.WALL_TOP - cy, S.ROOF_X0 - S.DIVIDER_X, 1);
    g.fillStyle = "#dfe6f5";
    for (let x = S.ROOF_X0; x < S.SCENE_W; x += 7) g.fillRect(x - cx, S.PARAPET_Y + 2 - cy, 3, 1);
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
      const s = this.decorationSprite(sel, p.sprite, input.accent) ?? null;
      if (s && !p.hidden) {
        const flat = p.sprite.startsWith("rug");
        const spot = this.decorationSpot(sel.id);
        const hanging = HANGING_DECORATIONS.has(sel.id);
        const x = Math.round(p.x - s.width / 2) - 2 - this.cam.x;
        const y = Math.round(flat ? p.y - s.height / 2 : hanging && spot ? spot.y - s.height / 2 : p.y - s.height) - 2 - this.cam.y;
        const on = Math.floor(t * 4) % 2 === 0;
        g.fillStyle = on ? "#fff6dc" : "#a8445e";
        const Wd = s.width + 4;
        const Hd = s.height + 4;
        for (let i = 0; i < Wd; i += 2) {
          g.fillRect(x + i, y, 1, 1);
          g.fillRect(x + i, y + Hd - 1, 1, 1);
        }
        for (let j = 0; j < Hd; j += 2) {
          g.fillRect(x, y + j, 1, 1);
          g.fillRect(x + Wd - 1, y + j, 1, 1);
        }
      }
    }
  }
}
