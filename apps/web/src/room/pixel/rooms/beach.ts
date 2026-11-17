import { mixHex, skyPoint, type SkyState } from "../../sky";
import { clearGlass, type Kit } from "../kit";
import * as S from "../scene";
import { canvas, curtainWindow, ellipse, gridSprite, INK, px, rng, speaker } from "../sprites";
import { deskSprite } from "./rooftop";
import { drawRailing, drawRoomFrame, planks, tint } from "./common";
import type { AnimateInput, BackdropInput, Ctx, Furniture, Item, RoomArt } from "./types";

const SEA_Y = 84;

function seaColors(sky: SkyState) {
  const far = mixHex(sky.horizon, "#3f8fc4", 0.45 + sky.night * 0.2);
  const near = mixHex(mixHex(sky.top, "#1f5f8f", 0.6), "#0b1029", sky.night * 0.6);
  return { far, near };
}

function drawSea(g: Ctx, lg: Ctx, { sky }: BackdropInput) {
  const { far, near } = seaColors(sky);
  const bottom = S.BACKDROP.y + S.BACKDROP.h;
  for (let y = SEA_Y; y < bottom; y++) {
    const t = Math.min(1, (y - SEA_Y) / 70);
    px(g, mixHex(far, near, t), S.BACKDROP.x, y, S.BACKDROP.w, 1);
  }
  px(g, mixHex(far, "#ffffff", 0.25), S.BACKDROP.x, SEA_Y, S.BACKDROP.w, 1);
  const land = mixHex(sky.horizon, "#2a3a48", 0.55 + sky.night * 0.3);
  ellipse(g, land, 300, SEA_Y, 34, 5);
  ellipse(g, land, -120, SEA_Y, 50, 4);
  px(g, INK, 318, SEA_Y - 18, 5, 14);
  px(g, mixHex("#f2ece0", land, sky.night * 0.6), 319, SEA_Y - 17, 3, 12);
  px(g, "#c43d4a", 319, SEA_Y - 13, 3, 2);
  px(g, INK, 317, SEA_Y - 21, 7, 3);
  if (sky.night > 0.3) px(lg, "#fff1a8", 319, SEA_Y - 20, 3, 1);
  const palm = mixHex(sky.horizon, "#1f2a2a", 0.55 + sky.night * 0.35);
  for (const [x, lean] of [[-30, 1], [372, -1], [-200, 1], [520, -1]] as const) {
    for (let y = 0; y < 60; y++) px(g, palm, x + Math.round(lean * (y * y) / 300), SEA_Y + 30 - y, 3, 1);
    const tx = x + Math.round(lean * 12);
    const ty = SEA_Y - 30;
    for (const [dx, dy] of [[-14, 4], [-10, -3], [0, -6], [10, -3], [14, 4], [6, 6], [-6, 6]] as const) {
      const n = Math.max(Math.abs(dx), Math.abs(dy));
      for (let k = 0; k <= n; k++) px(g, palm, tx + Math.round((dx * k) / n), ty + Math.round((dy * k) / n) + Math.round((k * k) / (n * 2)), 2, 1);
    }
  }
}

function animateSea(g: Ctx, a: AnimateInput) {
  const { cx, cy, w, h, t, sky } = a;
  const top = SEA_Y - cy;
  const { far } = seaColors(sky);
  const foam = mixHex(far, "#ffffff", 0.55);
  const across = (x: number) => Math.round(w / 2 + x * Math.max(40, w / 2 - 18));
  const body = sky.sunAltitude > -3 ? { alt: sky.sunAltitude, az: sky.sunAzimuth, col: sky.sunAltitude < 10 ? "#ffcf8a" : "#fff4d8" } : sky.moon.altitude > 0 ? { alt: sky.moon.altitude, az: sky.moon.azimuth, col: "#f7f0d6" } : null;
  if (body) {
    const bx = across(skyPoint(body.alt, body.az).x);
    for (let k = 1; k < 40; k++) {
      const y = top + k;
      if (y < 0 || y >= h) continue;
      const width = 2 + Math.floor(k / 3);
      const phase = a.still ? 0 : Math.sin(t * 3 + k * 1.7);
      if (phase < -0.3) continue;
      g.fillStyle = body.col;
      g.globalAlpha = Math.max(0, 0.75 - k / 50);
      g.fillRect(bx - Math.floor(width / 2) + Math.round(phase * 2), y, width, 1);
    }
    g.globalAlpha = 1;
  }
  const r = rng(61);
  for (let i = 0; i < 26; i++) {
    const row = 3 + Math.floor(r() * 36);
    const base = r() * 840 - 260;
    const x = ((base + (a.still ? 0 : t * (2 + row * 0.08))) % 840 + 840) % 840 - 260 - cx * 0.6;
    const y = top + row;
    if (y < 0 || y >= h || x < -8 || x > w) continue;
    g.fillStyle = foam;
    g.globalAlpha = 0.6;
    g.fillRect(Math.round(x), y, 3 + (i % 3), 1);
  }
  g.globalAlpha = 1;
  const bx = Math.round((((a.still ? 0 : t * 1.2) + 120) % 520) - 100 - cx * 0.6);
  const by = top + 2;
  if (bx > -10 && bx < w) {
    const sail = mixHex("#faf6ee", sky.horizon, 0.3 + sky.night * 0.4);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = sail;
      g.fillRect(bx + 3, by - 8 + k, Math.max(1, Math.floor(k * 0.7)), 1);
    }
    g.fillStyle = INK;
    g.fillRect(bx + 2, by - 9, 1, 9);
    g.fillRect(bx, by - 1, 8, 2);
  }
}

function surfboard(): HTMLCanvasElement {
  const c = canvas(10, 40);
  const g = c.getContext("2d")!;
  ellipse(g, INK, 5, 20, 4, 19);
  ellipse(g, "#f7a6c4", 5, 20, 3, 18);
  px(g, "#ffffff", 5, 3, 1, 34);
  px(g, "#3aa6a0", 2, 26, 6, 3);
  return c;
}

function lifebuoy(): HTMLCanvasElement {
  return gridSprite([
    "...ooooo...",
    "..orrwwwo..",
    ".orro.owwo.",
    "orro...owwo",
    "owwo...orro",
    "owwo...orro",
    ".owwo.orro.",
    "..owwwrro..",
    "...ooooo...",
  ], { o: INK, r: "#e0475a", w: "#faf6ee" });
}

export function createBeach(): RoomArt {
  const board = surfboard();
  const buoy = lifebuoy();
  return {
    id: "beach",
    customWalls: false,
    sky: (s) => {
      const k = (s.phase === "golden" || s.phase === "dusk" ? 0.45 : 0.28) * (1 - s.night * 0.75);
      return {
        ...s,
        horizon: mixHex(s.horizon, "#ffb88a", k),
        top: mixHex(s.top, "#9a86c4", k * 0.45),
        tint: s.night > 0.5 ? s.tint : mixHex(s.tint, "#ffb070", 0.6),
        tintAlpha: s.night > 0.5 ? s.tintAlpha : Math.max(s.tintAlpha, 0.1 * (1 - s.night)),
      };
    },
    init(kit: Kit): Furniture {
      const window = curtainWindow(["#f2f8fb", "#cfe3ee", "#a9c9de", "#7fa9c8"]);
      clearGlass(window);
      const second = kit.sprite("window_small")!;
      clearGlass(second);
      return {
        desk: deskSprite(kit),
        window,
        bed: kit.sprite("bed_white")!,
        lamp: kit.sprite("lamp_cream")!,
        bookcase: kit.sprite("bookcase")!,
        picture: kit.sprite("frame_hills")!,
        secondWindow: second,
        shelfPlant: kit.sprite("plant_small")!,
        speaker: tint(speaker(), (r, g, b) => b > r && Math.abs(r - g) < 24 && r < 120, "#3aa6a0", 0.7),
        table: kit.sprite("table_low")!,
      };
    },
    backdropKey: ({ sky }) => `${sky.horizon.slice(0, 6)}|${sky.top.slice(0, 6)}|${Math.round(sky.night * 10)}`,
    drawBackdrop: drawSea,
    animateBackdrop: animateSea,
    drawShell(g, kit) {
      px(g, INK, -1, S.FRONT_Y + 6, S.SCENE_W + 2, S.WORLD.h);
      px(g, "#e8cfa0", 0, S.FRONT_Y + 7, S.SCENE_W, S.WORLD.h);
      const r = rng(9);
      for (let i = 0; i < 160; i++) px(g, r() < 0.5 ? "#d9bb86" : "#f2dfb6", Math.floor(r() * S.SCENE_W), S.FRONT_Y + 8 + Math.floor(r() * 120), 2, 1);
      for (let x = 10; x < S.SCENE_W; x += 44) {
        px(g, INK, x - 1, S.FRONT_Y + 6, 6, 60);
        px(g, "#8a5a3c", x, S.FRONT_Y + 6, 4, 60);
        px(g, "#a8724c", x, S.FRONT_Y + 6, 1, 60);
        px(g, "rgba(58,58,80,0.25)", x - 4, S.FRONT_Y + 64, 14, 2);
      }
      planks(["#c49a6c", "#b58a5c", "#caa476"], 6, false)(g, S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, S.FRONT_Y - S.FLOOR_Y);
      px(g, INK, 0, S.FRONT_Y, S.SCENE_W, 7);
      px(g, "#d6b58a", 0, S.FRONT_Y + 1, S.SCENE_W, 3);
      px(g, "#b58a5c", 0, S.FRONT_Y + 4, S.SCENE_W, 2);
      drawRoomFrame(g, kit, {
        wall: planks(["#eef3f6", "#e2ebf1", "#d6e2ea"], 7, true),
        floor: planks(["#d9b37a", "#c99f66", "#e0bd86"], 5, false),
        cap: "#ffffff",
        door: ["#3f7fae", "#5b9ccb"],
      });
      drawRailing(g, { post: "#faf6ee", rail: "#e8e0d0", cap: "#ffffff", every: 6 });
      kit.wallTop(g, S.ROOF_X1, S.PARAPET_Y, S.SCENE_W - S.ROOF_X1, S.FRONT_Y - S.PARAPET_Y + 1, "#ffffff");
    },
    props: (): Item[] => [
      { bottom: 128, draw: (g) => g.drawImage(board, 292, 88) },
      { bottom: 125, draw: (g) => g.drawImage(buoy, 186, 108) },
    ],
  };
}
