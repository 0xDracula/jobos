import { mixHex } from "../../sky";
import { clearGlass, type Kit } from "../kit";
import * as S from "../scene";
import { curtainWindow, ellipse, INK, px, rng, satelliteDish, speaker, waterTank, widen } from "../sprites";
import type { BackdropInput, Ctx, Furniture, Item, Look, RoomArt } from "./types";

type NearBuilding = { x: number; w: number; top: number; face: number; roof: "tank" | "dish" | "laundry" | "antenna" | "" };

const B = S.BACKDROP;

function buildCity() {
  const far: { x: number; w: number; h: number }[] = [];
  const near: NearBuilding[] = [];
  const r = rng(11);
  for (let x = B.x; x < B.x + B.w; ) {
    const w = 8 + Math.floor(r() * 20);
    far.push({ x, w, h: 10 + Math.floor(r() * 34) });
    x += w;
  }
  const n = rng(29);
  const roofs: NearBuilding["roof"][] = ["tank", "dish", "laundry", "antenna", "", "tank", "dish"];
  for (let x = B.x; x < B.x + B.w; ) {
    const w = 26 + Math.floor(n() * 46);
    const gap = n() < 0.35 ? 6 + Math.floor(n() * 18) : 0;
    const behind = x + w > -10 && x < S.SCENE_W + 10;
    const window = x + w > 48 && x < 100;
    const top = window ? 118 : behind ? 44 + Math.floor(n() * 50) : 70 + Math.floor(n() * 70);
    near.push({ x, w, top, face: Math.floor(n() * 4), roof: roofs[Math.floor(n() * roofs.length)] });
    x += w + gap;
  }
  return { far, near };
}

export function drawCairo(g: Ctx, lg: Ctx, sky: BackdropInput["sky"], city: ReturnType<typeof buildCity>) {
  const H = S.HORIZON;
  const far = mixHex(sky.horizon, "#232847", 0.42 + sky.night * 0.25);
  for (const b of city.far) px(g, far, b.x, H - b.h, b.w, 40);
  const minaret = (x: number, t: number) => {
    px(g, far, x, t, 1, 3);
    px(g, far, x - 1, t + 3, 3, 5);
    px(g, far, x - 2, t + 8, 5, 1);
    px(g, far, x - 1, t + 9, 3, 12);
    px(g, far, x - 2, t + 21, 5, 1);
    px(g, far, x - 2, t + 22, 5, H - t);
  };
  const dome = (cx: number, r: number) => {
    const base = H - 16;
    px(g, far, cx - r - 3, base, r * 2 + 7, 30);
    ellipse(g, far, cx, base, r, r);
    px(g, far, cx, base - r - 4, 1, 4);
  };
  minaret(30, 36);
  minaret(228, 26);
  minaret(-150, 44);
  minaret(470, 40);
  dome(110, 12);
  dome(392, 10);
  {
    const x = 300;
    const t = 52;
    px(g, far, x + 4, t, 1, 3);
    px(g, far, x + 1, t + 3, 7, 3);
    px(g, far, x, t + 6, 9, 12);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) g.clearRect(x + 2 + i * 2, t + 8 + j * 2, 1, 1);
    px(g, far, x + 1, t + 18, 1, 40);
    px(g, far, x + 7, t + 18, 1, 40);
  }
  const lit = mixHex("#ffd27a", far, 0.25);
  const lr = rng(5);
  for (const b of city.far) {
    for (let i = 0; i < b.w * b.h * 0.02; i++) {
      const on = lr() < sky.night * 0.7;
      const wx = b.x + 2 + Math.floor(lr() * Math.max(1, b.w - 4));
      const wy = H - b.h + 3 + Math.floor(lr() * Math.max(1, b.h - 4));
      if (on) px(lg, lit, wx, wy, 1, 1);
    }
  }
  const faces = ["#8d7f88", "#7c7d96", "#9a8a7c", "#6f7a8c"];
  const wr = rng(17);
  const bottom = B.y + B.h;
  for (const b of city.near) {
    const face = faces[b.face];
    const x = b.x;
    const t = b.top;
    px(g, INK, x, t, b.w, bottom - t);
    px(g, face, x + 1, t + 1, b.w - 2, bottom - t);
    px(g, mixHex(face, "#ffffff", 0.18), x + 1, t + 1, b.w - 2, 2);
    px(g, mixHex(face, INK, 0.22), x + b.w - 4, t + 3, 3, bottom - t);
    for (let wy = t + 8; wy < bottom; wy += 12) {
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
}

export function drawFacade(g: Ctx, facade = "#6d6478") {
  px(g, INK, -1, S.FRONT_Y + 6, S.SCENE_W + 2, S.WORLD.h);
  px(g, facade, 0, S.FRONT_Y + 7, S.SCENE_W, S.WORLD.h);
  px(g, mixHex(facade, "#ffffff", 0.12), 0, S.FRONT_Y + 7, S.SCENE_W, 1);
  const fr = rng(3);
  for (let y = S.FRONT_Y + 22; y < S.WORLD.y + S.WORLD.h; y += 30) {
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
}

export function drawRoomBox(g: Ctx, kit: Kit, look: Look, door = ["#b5754d", "#ca8854"]) {
  kit.tileRect(g, look.floor, S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, S.FRONT_Y - S.FLOOR_Y);
  px(g, "rgba(58,58,80,0.18)", S.ROOM_X0, S.FLOOR_Y, S.DIVIDER_X - S.ROOM_X0, 3);
  kit.wall(g, look.wall, S.ROOM_X0, S.WALL_TOP, S.DIVIDER_X - S.ROOM_X0);
  kit.wallTop(g, 0, S.WALL_TOP, S.ROOM_X0 + 1, S.FRONT_Y - S.WALL_TOP + 1);
  kit.wallTop(g, S.DIVIDER_X, S.WALL_TOP, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y0 - S.WALL_TOP);
  kit.wallTop(g, S.DIVIDER_X, S.DOOR_Y1, S.ROOF_X0 - S.DIVIDER_X, S.FRONT_Y - S.DOOR_Y1 + 1);
  px(g, door[0], S.DIVIDER_X, S.DOOR_Y0, S.ROOF_X0 - S.DIVIDER_X, S.DOOR_Y1 - S.DOOR_Y0);
  px(g, door[1], S.DIVIDER_X + 1, S.DOOR_Y0 + 1, S.ROOF_X0 - S.DIVIDER_X - 2, S.DOOR_Y1 - S.DOOR_Y0 - 2);
}

export function drawLedge(g: Ctx, top = "#c9cbd3", shade = "#9a9cab") {
  px(g, INK, 0, S.FRONT_Y, S.SCENE_W, 7);
  px(g, top, 0, S.FRONT_Y + 1, S.SCENE_W, 3);
  px(g, shade, 0, S.FRONT_Y + 4, S.SCENE_W, 2);
}

export function deskSprite(kit: Kit): HTMLCanvasElement {
  return widen(kit.sprite("dresser")!, 44, 10, 22);
}

export function rooftopFurniture(kit: Kit): Furniture {
  const window = curtainWindow();
  const second = kit.sprite("window_small")!;
  clearGlass(window);
  clearGlass(second);
  return {
    desk: deskSprite(kit),
    window,
    bed: kit.sprite("bed_teal")!,
    lamp: kit.sprite("lamp_cream")!,
    bookcase: kit.sprite("bookcase")!,
    picture: kit.sprite("frame_hills")!,
    secondWindow: second,
    shelfPlant: kit.sprite("plant_small")!,
    speaker: speaker(),
    table: kit.sprite("table_low")!,
  };
}

export function createRooftop(): RoomArt {
  const city = buildCity();
  const tank = waterTank();
  const dish = satelliteDish();
  return {
    id: "rooftop",
    customWalls: true,
    labels: {},
    init: rooftopFurniture,
    backdropKey: ({ sky }) => `${sky.horizon.slice(0, 6)}|${sky.tint.slice(0, 6)}|${Math.round(sky.night * 10)}`,
    drawBackdrop: (g, lg, { sky }) => drawCairo(g, lg, sky, city),
    drawShell(g, kit, look) {
      drawFacade(g);
      kit.tileRect(g, "concrete", S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, S.FRONT_Y - S.FLOOR_Y);
      px(g, "rgba(58,58,80,0.18)", S.ROOF_X0, S.FLOOR_Y, S.ROOF_X1 - S.ROOF_X0, 3);
      drawLedge(g);
      drawRoomBox(g, kit, look);
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
      kit.wallTop(g, S.ROOF_X1, py, S.SCENE_W - S.ROOF_X1, S.FRONT_Y - py + 1);
      kit.put(g, dish, 262, 92);
    },
    props: (): Item[] => [{ bottom: 90 + tank.height, draw: (g) => g.drawImage(tank, 284, 90) }],
  };
}
