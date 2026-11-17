import type { Weather } from "@/lib/types";

import { mixHex } from "../../sky";
import { clearGlass, type Kit } from "../kit";
import * as S from "../scene";
import { canvas, curtainWindow, gridSprite, INK, px, rng, speaker } from "../sprites";
import { deskSprite, drawLedge } from "./rooftop";
import { bricks, checker, cobbles, drawRailing, drawRoomFrame, tint } from "./common";
import type { AnimateInput, BackdropInput, Ctx, Furniture, Item, RoomArt } from "./types";

type House = { x: number; w: number; top: number; face: string; arch: boolean; shop: string };

const FACES = ["#7d9a96", "#c9a46a", "#c98a7a", "#8a93b0", "#b8a48e", "#9c7f9a"];
const AWNINGS = ["#b8364a", "#447e70", "#2f5f8a", "#c9883a"];
const STREET_Y = 118;

function buildStreet(): House[] {
  const r = rng(53);
  const out: House[] = [];
  for (let x = S.BACKDROP.x; x < S.BACKDROP.x + S.BACKDROP.w; ) {
    const w = 34 + Math.floor(r() * 30);
    out.push({ x, w, top: -10 + Math.floor(r() * 40), face: FACES[Math.floor(r() * FACES.length)], arch: r() < 0.5, shop: AWNINGS[Math.floor(r() * AWNINGS.length)] });
    x += w;
  }
  return out;
}

function drawStreet(g: Ctx, lg: Ctx, { sky }: BackdropInput, houses: House[]) {
  const dim = (c: string) => mixHex(c, mixHex(sky.horizon, "#2a2f4a", 0.5), 0.25 + sky.night * 0.45);
  for (const h of houses) {
    const face = dim(h.face);
    px(g, INK, h.x, h.top, h.w, STREET_Y - h.top);
    px(g, face, h.x + 1, h.top + 1, h.w - 2, STREET_Y - h.top - 1);
    px(g, mixHex(face, "#ffffff", 0.2), h.x + 1, h.top + 1, h.w - 2, 2);
    px(g, mixHex(face, INK, 0.3), h.x + 1, h.top + 3, h.w - 2, 1);
    const r = rng(h.x + 999);
    for (let wy = h.top + 8; wy < STREET_Y - 30; wy += 16) {
      for (let wx = h.x + 5; wx + 7 < h.x + h.w - 3; wx += 11) {
        const lit = r() < 0.2 + sky.night * 0.5 && sky.night > 0.15;
        px(g, INK, wx - 1, wy - 1, 8, 11);
        px(g, mixHex("#9fb4c9", sky.horizon, 0.4), wx, wy, 6, 9);
        if (h.arch) {
          px(g, face, wx, wy, 1, 1);
          px(g, face, wx + 5, wy, 1, 1);
        }
        if (lit) px(lg, r() < 0.5 ? "#ffd08a" : "#ffe6a0", wx, wy + (h.arch ? 1 : 0), 6, 9 - (h.arch ? 1 : 0));
        px(g, mixHex(face, INK, 0.4), wx - 2, wy, 1, 9);
        px(g, mixHex(face, INK, 0.4), wx + 7, wy, 1, 9);
        if (r() < 0.25) {
          px(g, INK, wx - 2, wy + 9, 10, 2);
          for (let k = 0; k < 10; k += 2) px(g, INK, wx - 2 + k, wy + 7, 1, 2);
          px(g, r() < 0.5 ? "#e88fa3" : "#5f9e6e", wx - 1, wy + 8, 8, 1);
        }
      }
    }
    const sy = STREET_Y - 24;
    px(g, INK, h.x + 3, sy, h.w - 6, 4);
    for (let k = 0; k < h.w - 8; k += 4) px(g, dim(k % 8 ? "#f2ece0" : h.shop), h.x + 4 + k, sy + 1, Math.min(4, h.w - 8 - k), 2);
    px(g, INK, h.x + 5, sy + 6, h.w - 10, 16);
    px(g, mixHex("#3d4361", sky.horizon, 0.2), h.x + 6, sy + 7, h.w - 12, 15);
    if (sky.night > 0.2 || r() < 0.6) px(lg, mixHex("#ffcf8a", "#ff9a5a", r() * 0.4), h.x + 7, sy + 8, h.w - 14, 9);
  }
  for (let x = S.BACKDROP.x + 40; x < S.BACKDROP.x + S.BACKDROP.w; x += 96) {
    px(g, INK, x, STREET_Y - 30, 2, 30);
    px(g, INK, x - 3, STREET_Y - 34, 8, 5);
    px(g, "#4a4a64", x - 2, STREET_Y - 33, 6, 3);
    if (sky.lamp > 0.2 || sky.night > 0.3) px(lg, "#ffe2a0", x - 2, STREET_Y - 31, 6, 2);
  }
  px(g, mixHex("#3a3f58", sky.horizon, 0.25), S.BACKDROP.x, STREET_Y, S.BACKDROP.w, 40);
  px(g, mixHex("#59607e", sky.horizon, 0.3), S.BACKDROP.x, STREET_Y, S.BACKDROP.w, 1);
}

function shimmer(g: Ctx, a: AnimateInput) {
  const { cx, cy, w, t, sky } = a;
  const y = STREET_Y + 2 - cy;
  const strength = 0.25 + sky.night * 0.35;
  for (let x = S.BACKDROP.x + 40; x < S.BACKDROP.x + S.BACKDROP.w; x += 96) {
    const vx = x - cx;
    if (vx < -4 || vx > w + 4) continue;
    for (let k = 0; k < 6; k++) {
      const wobble = a.still ? 0 : Math.round(Math.sin(t * 2 + k + x) * 1);
      g.fillStyle = `rgba(255,214,150,${strength * (1 - k / 6)})`;
      g.fillRect(vx - 1 + wobble, y + k * 2, 3, 1);
    }
  }
}

function cafeTable(): HTMLCanvasElement {
  return gridSprite([
    "....oooooooooooooooooooo....",
    "..ooWWWWWWWWWWWWWWWWWWWWoo..",
    ".oWWwwwwwwwwwwwwwwwwwwwwWWo.",
    ".oWWWWWWWWWWWWWWWWWWWWWWWWo.",
    "..ooooooooooooooooooooooo...",
    "............oSSo............",
    "............oSSo............",
    "............oSSo............",
    "............oSSo............",
    "............oSSo............",
    "..........ooSSSSoo..........",
    ".........oSSSSSSSSo.........",
    ".........oooooooooo.........",
  ], { o: INK, W: "#4a4a64", w: "#6c6e85", S: "#2b2b3c" });
}

function parasol(): HTMLCanvasElement {
  const c = canvas(48, 40);
  const g = c.getContext("2d")!;
  for (let y = 0; y < 9; y++) {
    const half = 3 + y * 2.6;
    for (let x = Math.round(24 - half); x <= Math.round(24 + half); x++) {
      const panel = Math.floor((x - (24 - half)) / ((2 * half) / 6));
      px(g, y === 8 ? INK : panel % 2 ? "#f2ece0" : "#c43d4a", x, y + 1, 1, 1);
    }
  }
  px(g, INK, 23, 0, 2, 1);
  for (let x = 2; x < 46; x += 4) px(g, INK, x, 10, 3, 1);
  px(g, INK, 23, 10, 2, 30);
  px(g, "#9097b1", 24, 11, 1, 28);
  return c;
}

function menuBoard(): HTMLCanvasElement {
  return gridSprite([
    "..oooooooo..",
    ".obbbbbbbbo.",
    ".obwwbwbbbo.",
    ".obbbbbbbbo.",
    ".obwbwwbbbo.",
    ".obbbbbbbbo.",
    ".obwwwbwbbo.",
    ".obbbbbbbbo.",
    ".oooooooooo.",
    ".o.o....o.o.",
    "o..o....o..o",
    "o..........o",
  ], { o: INK, b: "#2f3a33", w: "#e8ecf2" });
}

export function createCafe(): RoomArt {
  const street = buildStreet();
  const table = cafeTable();
  const umbrella = parasol();
  const board = menuBoard();
  return {
    id: "cafe",
    customWalls: false,
    weather: (w: Weather | null) => (!w || ["clear", "clouds", "fog"].includes(w.condition) ? ({ ...(w ?? FALLBACK), condition: "drizzle", cloud_cover: 90 } as Weather) : w),
    init(kit: Kit): Furniture {
      const window = curtainWindow(["#e8d0a8", "#c9a87a", "#a8845a", "#8a6a48"]);
      clearGlass(window);
      const second = kit.sprite("window_small")!;
      clearGlass(second);
      const sofa = tint(kit.sprite("sofa_red")!, (r, g, b) => r > g + 20 && r > b + 20, "#3d6a58", 0.9);
      return {
        desk: deskSprite(kit),
        window,
        bed: sofa,
        lamp: kit.sprite("lamp_wood")!,
        bookcase: kit.sprite("bookcase_b")!,
        picture: kit.sprite("frame_hills")!,
        secondWindow: second,
        shelfPlant: kit.sprite("plant_small")!,
        speaker: tint(speaker(), (r, g, b) => r > g && r > b, "#5e3b28"),
        table,
      };
    },
    backdropKey: ({ sky }) => `${sky.horizon.slice(0, 6)}|${Math.round(sky.night * 10)}|${Math.round(sky.lamp * 4)}`,
    drawBackdrop: (g, lg, b) => drawStreet(g, lg, b, street),
    animateBackdrop: shimmer,
    drawShell(g, kit) {
      px(g, INK, -1, S.FRONT_Y + 6, S.SCENE_W + 2, S.WORLD.h);
      px(g, "#2f4a40", 0, S.FRONT_Y + 7, S.SCENE_W, S.WORLD.h);
      for (let x = 8; x < S.SCENE_W - 8; x += 26) {
        px(g, INK, x, S.FRONT_Y + 14, 20, 14);
        px(g, "#3d5c50", x + 1, S.FRONT_Y + 15, 18, 12);
      }
      cobbles()(g, S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, S.FRONT_Y - S.FLOOR_Y);
      for (const [x, y, w] of [[176, 150, 14], [244, 166, 18], [292, 138, 10]] as const) {
        px(g, "#4d5470", x, y, w, 2);
        px(g, "#8f9ab8", x + 2, y, Math.max(2, w - 8), 1);
      }
      drawLedge(g, "#8a8e9e", "#6c6f80");
      drawRoomFrame(g, kit, { wall: bricks(), floor: checker("#e8dcc4", "#7a5a4a", 8), cap: "#e8e0d8", door: ["#2f4a40", "#3d6355"] });
      drawRailing(g, { post: "#2b2b3c", rail: "#3d3d52", cap: "#4a4a64", every: 5 });
      kit.wallTop(g, S.ROOF_X1, S.PARAPET_Y, S.SCENE_W - S.ROOF_X1, S.FRONT_Y - S.PARAPET_Y + 1, "#e8e0d8");
      for (const x of [232, 280]) {
        px(g, INK, x, S.PARAPET_Y - 4, 16, 5);
        px(g, "#a85f46", x + 1, S.PARAPET_Y - 3, 14, 3);
        for (let k = 0; k < 14; k += 3) px(g, k % 2 ? "#e88fa3" : "#ffd23f", x + 1 + k, S.PARAPET_Y - 6, 2, 2);
        px(g, "#5f9e6e", x + 1, S.PARAPET_Y - 4, 14, 1);
      }
    },
    props: (): Item[] => [
      { bottom: 150, draw: (g) => g.drawImage(umbrella, 199, 112) },
      { bottom: 168, draw: (g) => g.drawImage(board, 168, 156) },
    ],
    glow(g, a) {
      if (a.sky.night < 0.3) return;
      const gl = g.createRadialGradient(170 - a.cx, 150 - a.cy, 1, 170 - a.cx, 150 - a.cy, 30);
      gl.addColorStop(0, "rgba(255,200,130,0.18)");
      gl.addColorStop(1, "rgba(255,200,130,0)");
      g.fillStyle = gl;
      g.fillRect(140 - a.cx, 120 - a.cy, 60, 60);
    },
  };
}

const FALLBACK: Weather = {
  condition: "drizzle",
  code: 51,
  temperature_c: 16,
  cloud_cover: 90,
  precipitation_mm: 0.2,
  wind_kmh: 6,
  is_day: true,
  timezone: "",
  utc_offset_s: 0,
  fetched_at: "",
};
