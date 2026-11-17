import { canvas, CUTS, cutSprite, FLOOR_TILES, INK, px, WALL_BANDS, type Cut, type CutName, type Sheets } from "./sprites";

type Ctx = CanvasRenderingContext2D;

const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

const GLASS = new Set(["#c4dae8", "#cfe6f5", "#dbeef9", "#b9d4e6", "#e3f3fb", "#a9cbe0", "#d5ecf7", "#bfdcea"]);

export class Kit {
  readonly sheets: Sheets;
  private sprites = new Map<string, HTMLCanvasElement>();

  constructor(sheets: Sheets) {
    this.sheets = sheets;
    for (const name of Object.keys(CUTS) as CutName[]) this.sprites.set(name, cutSprite(sheets, CUTS[name]));
  }

  sprite(name: string): HTMLCanvasElement | undefined {
    return this.sprites.get(name);
  }

  set(name: string, c: HTMLCanvasElement) {
    this.sprites.set(name, c);
  }

  cut(name: string, c: Cut): HTMLCanvasElement {
    let s = this.sprites.get(name);
    if (!s) {
      s = cutSprite(this.sheets, c);
      this.sprites.set(name, s);
    }
    return s;
  }

  put(g: Ctx, sprite: string | HTMLCanvasElement | undefined, x: number, y: number, flip = false) {
    const s = typeof sprite === "string" ? this.sprite(sprite) : sprite;
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

  tileRect(g: Ctx, name: string, x: number, y: number, w: number, h: number) {
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

  wall(g: Ctx, style: string, x: number, y: number, w: number) {
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

  wallTop(g: Ctx, x: number, y: number, w: number, h: number, cap = "#f8f8f8") {
    px(g, INK, x, y, w, h);
    px(g, cap, x + 1, y + 1, w - 2, h - 2);
  }
}

const MASKS = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function clearGlass(c: HTMLCanvasElement): HTMLCanvasElement {
  const done = MASKS.get(c);
  if (done) return done;
  const g = c.getContext("2d")!;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const mask = canvas(c.width, c.height);
  const mg = mask.getContext("2d")!;
  const m = mg.createImageData(c.width, c.height);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const h = hex(d[i], d[i + 1], d[i + 2]);
    const blue = d[i + 2] >= d[i] + 8 && d[i + 2] > 190 && d[i + 1] > 180;
    if (GLASS.has(h) || blue) {
      d[i + 3] = 0;
      m.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  mg.putImageData(m, 0, 0);
  MASKS.set(c, mask);
  return mask;
}

export const glassMask = (c: HTMLCanvasElement) => clearGlass(c);
