import { canvas, COLORS, ellipse, INK, px } from "./sprites";

type Ctx = CanvasRenderingContext2D;

export const RECORD_W = 24;
export const RECORD_H = 14;

const VINYL = "#26263a";
const GROOVE = "#363650";
const SHINE = "#8a8eb0";
const P = { cx: 9, cy: 7, rx: 8, ry: 3.5 };
const L = { x: 6, y: 6, w: 7, h: 3 };
const PIVOT = { x: 21, y: 4 };
const ARM = 7;
const PLAY_ANGLE = 0.9;

function base(): HTMLCanvasElement {
  const c = canvas(RECORD_W, RECORD_H);
  const g = c.getContext("2d")!;
  px(g, INK, 0, 2, RECORD_W, RECORD_H - 2);
  px(g, COLORS.WOOD_LIGHT, 1, 3, RECORD_W - 2, 8);
  px(g, "#ecc98a", 1, 3, RECORD_W - 2, 1);
  px(g, COLORS.WOOD, 1, 12, RECORD_W - 2, 1);
  px(g, COLORS.STEEL_LIGHT, 19, 12, 2, 1);
  ellipse(g, INK, P.cx, P.cy, P.rx, P.ry);
  ellipse(g, VINYL, P.cx, P.cy, P.rx - 1, P.ry - 1);
  ellipse(g, GROOVE, P.cx, P.cy, P.rx - 2, P.ry - 1.5);
  ellipse(g, VINYL, P.cx, P.cy, P.rx - 3, P.ry - 2);
  ellipse(g, INK, PIVOT.x, PIVOT.y + 1, 2, 1.5);
  px(g, COLORS.STEEL, PIVOT.x - 1, PIVOT.y, 3, 2);
  px(g, COLORS.STEEL_LIGHT, PIVOT.x - 1, PIVOT.y, 1, 1);
  px(g, INK, PIVOT.x, 11, 1, 1);
  return c;
}

export class RecordPlayer {
  private plinth = base();
  private out = canvas(RECORD_W, RECORD_H);
  private og = this.out.getContext("2d")!;
  private art: HTMLCanvasElement | null = null;
  private artSrc: string | null = null;
  arm = 0;

  setArtwork(src: string | null, onReady: () => void) {
    if (src === this.artSrc) return;
    this.artSrc = src;
    if (!src) {
      this.art = null;
      onReady();
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (this.artSrc !== src) return;
      const mid = canvas(16, 16);
      const mg = mid.getContext("2d")!;
      mg.imageSmoothingEnabled = true;
      mg.imageSmoothingQuality = "high";
      mg.drawImage(img, 0, 0, 16, 16);
      const c = canvas(L.w + 1, L.h + 1);
      const g = c.getContext("2d")!;
      g.imageSmoothingEnabled = true;
      g.drawImage(mid, 2, 3, 12, 10, 0, 0, L.w + 1, L.h + 1);
      this.art = c;
      onReady();
    };
    img.onerror = () => {
      if (this.artSrc === src) this.art = null;
      onReady();
    };
    img.src = src;
  }

  frame(dt: number, spin: number, armTarget: number, pulse: number, accent: string, still: boolean): HTMLCanvasElement {
    const g = this.og;
    g.clearRect(0, 0, RECORD_W, RECORD_H);
    g.drawImage(this.plinth, 0, 0);
    const turn = Math.floor(((spin % 1) + 1) % 1 * (L.w + 1));
    g.save();
    g.beginPath();
    g.ellipse(P.cx + 0.5, P.cy + 0.5, L.w / 2 + 0.2, L.h / 2 + 0.4, 0, 0, Math.PI * 2);
    g.clip();
    if (this.art) {
      g.drawImage(this.art, L.x - turn, L.y);
      g.drawImage(this.art, L.x - turn + L.w + 1, L.y);
    } else {
      px(g, accent, L.x, L.y, L.w, L.h + 1);
      px(g, "#faf6ee", L.x + ((turn + 2) % L.w), L.y + 1);
    }
    if (pulse > 0.02) {
      g.globalCompositeOperation = "lighter";
      g.fillStyle = `rgba(255,236,200,${Math.min(0.55, pulse * 0.55)})`;
      g.fillRect(L.x, L.y, L.w, L.h + 1);
      g.globalCompositeOperation = "source-over";
    }
    g.restore();
    px(g, "#faf6ee", P.cx, P.cy);
    const a = spin * Math.PI * 2;
    const gx = Math.round(P.cx + Math.cos(a) * (P.rx - 2));
    const gy = Math.round(P.cy + Math.sin(a) * (P.ry - 1.2));
    px(g, SHINE, gx, gy);
    const before = this.arm;
    this.arm = still ? armTarget : this.arm + (armTarget - this.arm) * Math.min(1, dt * 3.2);
    if (Math.abs(this.arm - armTarget) < 0.01) this.arm = armTarget;
    const moving = Math.abs(this.arm - before) > 0.002 || (this.arm > 0.02 && this.arm < 0.98);
    const ang = this.arm * PLAY_ANGLE;
    const hx = PIVOT.x - Math.sin(ang) * ARM;
    const hy = PIVOT.y + 1 + Math.cos(ang) * ARM * 0.86 - (moving ? 1 : 0);
    line(g, COLORS.STEEL_LIGHT, PIVOT.x, PIVOT.y + 1, Math.round(hx), Math.round(hy));
    px(g, INK, Math.round(hx) - 1, Math.round(hy), 2, 2);
    px(g, COLORS.STEEL, Math.round(hx) - 1, Math.round(hy), 1, 1);
    return this.out;
  }
}

function line(g: Ctx, color: string, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = color;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
