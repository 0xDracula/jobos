import { mixHex } from "../../sky";
import { clearGlass, type Kit } from "../kit";
import * as S from "../scene";
import { canvas, curtainWindow, ellipse, gridSprite, INK, px, rng, speaker } from "../sprites";
import { deskSprite } from "./rooftop";
import { drawRailing, drawRoomFrame, logs, planks, tint } from "./common";
import type { AnimateInput, BackdropInput, Ctx, Furniture, Item, RoomArt } from "./types";

const GROUND = 104;

function drawValley(g: Ctx, lg: Ctx, { sky }: BackdropInput) {
  const snow = mixHex("#f4f7ff", sky.top, 0.15 + sky.night * 0.45);
  const shade = mixHex("#c9d4ea", sky.top, 0.25 + sky.night * 0.4);
  const rock = mixHex(sky.horizon, "#4a5070", 0.45 + sky.night * 0.25);
  const peaks: [number, number, number][] = [[-220, 30, 90], [-90, 10, 110], [60, 24, 100], [190, 0, 120], [330, 20, 100], [470, 8, 110]];
  for (const [x, top, half] of peaks) {
    for (let y = top; y < GROUND + 10; y++) {
      const k = (y - top) / (GROUND - top);
      const hw = Math.round(half * k);
      px(g, y - top < 16 + (x % 5) ? snow : rock, x - hw, y, hw * 2 + 1, 1);
    }
  }
  px(g, snow, S.BACKDROP.x, GROUND, S.BACKDROP.w, S.BACKDROP.y + S.BACKDROP.h - GROUND);
  px(g, shade, S.BACKDROP.x, GROUND, S.BACKDROP.w, 2);
  const pine = mixHex("#2f5a4a", "#0e1a24", sky.night * 0.6);
  const r = rng(71);
  for (let x = S.BACKDROP.x; x < S.BACKDROP.x + S.BACKDROP.w; x += 8 + Math.floor(r() * 10)) {
    const hgt = 14 + Math.floor(r() * 18);
    const base = GROUND + 2 + Math.floor(r() * 6);
    for (let k = 0; k < hgt; k++) {
      const hw = Math.floor((k / hgt) * 5) + (k % 4 === 3 ? 1 : 0);
      px(g, k < 3 ? snow : pine, x - hw, base - hgt + k, hw * 2 + 1, 1);
    }
    px(g, snow, x - 3, base - Math.floor(hgt / 2), 2, 1);
    px(g, "#5a4030", x, base, 1, 2);
  }
  const cx = 250;
  px(g, mixHex("#6e4630", sky.top, 0.3 + sky.night * 0.3), cx, GROUND - 10, 18, 10);
  for (let k = 0; k < 6; k++) px(g, snow, cx - 2 + k, GROUND - 16 + k, 22 - k * 2, 1);
  if (sky.night > 0.2) px(lg, "#ffcf7a", cx + 7, GROUND - 7, 4, 4);
}

function firePit(): HTMLCanvasElement {
  return gridSprite([
    "....................",
    "......lLl..lLl......",
    "....llLLLllLLLl.....",
    "..ooooooooooooooooo.",
    ".oSssSsssSsssSsssSo.",
    "oSssSssSssSssSssSsSo",
    ".oooooooooooooooooo.",
  ], { o: INK, S: "#8a8e9e", s: "#a9adbd", l: "#6e4630", L: "#9c6a44" });
}

function woodpile(): HTMLCanvasElement {
  const c = canvas(22, 14);
  const g = c.getContext("2d")!;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - (row === 2 ? 1 : 0); i++) {
      const x = 2 + i * 5 + (row === 2 ? 2 : 0);
      const y = 9 - row * 4;
      ellipse(g, INK, x + 2, y + 2, 2, 2);
      ellipse(g, "#c08a5c", x + 2, y + 2, 1, 1);
      px(g, "#6e4630", x + 2, y + 2, 1, 1);
    }
  }
  px(g, "#f4f7ff", 4, 0, 14, 2);
  return c;
}

function snowman(): HTMLCanvasElement {
  const c = canvas(16, 26);
  const g = c.getContext("2d")!;
  ellipse(g, INK, 8, 20, 7, 5);
  ellipse(g, "#f4f7ff", 8, 20, 6, 4);
  ellipse(g, INK, 8, 12, 5, 4);
  ellipse(g, "#f4f7ff", 8, 12, 4, 3);
  ellipse(g, INK, 8, 5, 4, 4);
  ellipse(g, "#f4f7ff", 8, 5, 3, 3);
  px(g, INK, 6, 4, 1, 1);
  px(g, INK, 9, 4, 1, 1);
  px(g, "#e8924a", 8, 5, 3, 1);
  px(g, "#c43d4a", 4, 8, 9, 2);
  px(g, "#c43d4a", 10, 10, 2, 3);
  px(g, INK, 4, 0, 9, 2);
  px(g, INK, 5, -1, 7, 1);
  px(g, "#5a4030", 0, 11, 4, 1);
  px(g, "#5a4030", 12, 11, 4, 1);
  return c;
}

function fire(g: Ctx, a: AnimateInput) {
  const x = 284 - a.cx;
  const y = 139 - a.cy;
  const r = rng(Math.floor(a.t * 8) + 5);
  const tongues = a.still ? [0.6, 0.9, 0.7, 0.5] : [r(), r(), r(), r()];
  tongues.forEach((v, i) => {
    const hgt = 3 + Math.round(v * 5);
    const fx = x + 5 + i * 3;
    for (let k = 0; k < hgt; k++) {
      g.fillStyle = k < 2 ? "#ffd23f" : k < hgt - 2 ? "#ff9a3a" : "#e0475a";
      g.fillRect(fx + (k > 2 && v > 0.5 ? 1 : 0), y - k, 2 - (k > hgt - 3 ? 1 : 0), 1);
    }
  });
  if (!a.still) {
    for (let k = 0; k < 4; k++) {
      const age = (a.t * 0.6 + k / 4) % 1;
      g.fillStyle = `rgba(200,205,220,${0.35 * (1 - age)})`;
      g.fillRect(Math.round(x + 9 + Math.sin(a.t + k) * 3 * age), Math.round(y - 10 - age * 26), 2, 2);
    }
  }
}

function fireGlow(g: Ctx, a: AnimateInput) {
  const x = 294 - a.cx;
  const y = 136 - a.cy;
  const flick = a.still ? 0 : Math.sin(a.t * 9) * 0.04 + Math.sin(a.t * 3.7) * 0.03;
  const gl = g.createRadialGradient(x, y, 2, x, y, 44);
  const k = 0.22 + a.sky.night * 0.2 + flick;
  gl.addColorStop(0, `rgba(255,170,90,${k})`);
  gl.addColorStop(1, "rgba(255,170,90,0)");
  g.fillStyle = gl;
  g.fillRect(x - 46, y - 46, 92, 92);
}

export function createCabin(): RoomArt {
  const pit = firePit();
  const wood = woodpile();
  const man = snowman();
  return {
    id: "cabin",
    customWalls: false,
    season: (s, w) => (w && ["rain", "drizzle", "thunderstorm"].includes(w.condition) ? s : "winter"),
    init(kit: Kit): Furniture {
      const window = curtainWindow(["#d9534f", "#b8364a", "#8c2f45", "#6e2438"]);
      clearGlass(window);
      const second = kit.sprite("window_small")!;
      clearGlass(second);
      const bed = tint(kit.sprite("bed_teal")!, (r, g, b) => g > r + 10 && b > r + 10, "#b8364a", 0.9);
      return {
        desk: deskSprite(kit),
        window,
        bed,
        lamp: kit.sprite("lamp_wood")!,
        bookcase: kit.sprite("bookcase")!,
        picture: kit.sprite("frame_hills")!,
        secondWindow: second,
        shelfPlant: kit.sprite("plant_small")!,
        speaker: tint(speaker(), (r, g, b) => b > r && Math.abs(r - g) < 24 && r < 120, "#6e4630", 0.75),
        table: kit.sprite("table_low")!,
      };
    },
    backdropKey: ({ sky }) => `${sky.horizon.slice(0, 6)}|${sky.top.slice(0, 6)}|${Math.round(sky.night * 10)}`,
    drawBackdrop: drawValley,
    drawShell(g, kit) {
      px(g, INK, -1, S.FRONT_Y + 6, S.SCENE_W + 2, S.WORLD.h);
      px(g, "#7d8094", 0, S.FRONT_Y + 7, S.SCENE_W, S.WORLD.h);
      const r = rng(19);
      for (let y = S.FRONT_Y + 9; y < S.FRONT_Y + 140; y += 6) {
        for (let x = (y / 6) % 2 ? 0 : -5; x < S.SCENE_W; x += 10) {
          px(g, r() < 0.3 ? "#6c6f84" : "#8f93a8", x + 1, y, 8, 4);
          px(g, "#a8acc0", x + 1, y, 8, 1);
        }
      }
      px(g, "#f4f7ff", 0, S.FRONT_Y + 7, S.SCENE_W, 3);
      planks(["#8a5e40", "#7a5238", "#956848"], 6, false)(g, S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, S.FRONT_Y - S.FLOOR_Y);
      for (const [x, y, w] of [[S.ROOF_X0, S.FLOOR_Y, 154], [S.ROOF_X0, 160, 22], [290, 150, 24], [230, 168, 40]] as const) {
        ellipse(g, "#f4f7ff", x + w / 2, y + 2, w / 2, 3);
        px(g, "#dfe6f5", x + 4, y + 4, Math.max(2, w - 8), 1);
      }
      px(g, INK, 0, S.FRONT_Y, S.SCENE_W, 7);
      px(g, "#f4f7ff", 0, S.FRONT_Y + 1, S.SCENE_W, 3);
      px(g, "#c9d4ea", 0, S.FRONT_Y + 4, S.SCENE_W, 2);
      drawRoomFrame(g, kit, { wall: logs(), floor: planks(["#7a5238", "#6e4630", "#86593c"], 5, false), cap: "#f4f7ff", door: ["#6e4630", "#86593c"] });
      drawRailing(g, { post: "#6e4630", rail: "#9c6a44", cap: "#f4f7ff", every: 9 });
      kit.wallTop(g, S.ROOF_X1, S.PARAPET_Y, S.SCENE_W - S.ROOF_X1, S.FRONT_Y - S.PARAPET_Y + 1, "#f4f7ff");
    },
    props: (): Item[] => [
      { bottom: 146, draw: (g) => g.drawImage(pit, 280, 139) },
      { bottom: 138, draw: (g) => g.drawImage(wood, 290, 124) },
      { bottom: 170, draw: (g) => g.drawImage(man, 168, 144) },
    ],
    animate: fire,
    glow: fireGlow,
  };
}
