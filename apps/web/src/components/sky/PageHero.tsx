"use client";

import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";

import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/prefs";
import { useResolvedTheme } from "@/lib/theme";

import { PixelIcon } from "../pixel/PixelIcon";

const UNIT = 3;

const CLEAR_PAD = 12;

type Box = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (boxes: Box[], x0: number, y0: number, x1: number, y1: number) =>
  boxes.some((b) => x1 >= b.x0 && x0 <= b.x1 && y1 >= b.y0 && y0 <= b.y1);

type Palette = {
  far: string;
  near: string;
  roof: string;
  window: string;
  lit: [string, string];
  litShare: number;
  stars: string[];
  cloud: string | null;
  beacon: string | null;
};

const PALETTES: Record<"day" | "night", Palette> = {
  night: {
    far: "#24224f",
    near: "#2e2b61",
    roof: "#3b3779",
    window: "#36326f",
    lit: ["#ffcf7a", "#ffe3a6"],
    litShare: 0.42,
    stars: ["#ffffff", "#ffe6a7", "#c9b8f0"],
    cloud: null,
    beacon: "#ff7f8e",
  },
  day: {
    far: "#d6d0ea",
    near: "#c3bbdc",
    roof: "#e2ddf2",
    window: "#eeebf8",
    lit: ["#fff4cf", "#fff4cf"],
    litShare: 0.06,
    stars: [],
    cloud: "#ffffff",
    beacon: null,
  },
};

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stream(seed: number) {
  const r = random(seed);
  return { r, int: (a: number, b: number) => a + Math.floor(r() * (b - a + 1)) };
}

function drawCity(canvas: HTMLCanvasElement, p: Palette, seed: number, clear: Box[]) {
  const w = Math.max(1, Math.ceil(canvas.clientWidth / UNIT));
  const h = Math.max(1, Math.ceil(canvas.clientHeight / UNIT));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, w, h);
  const sky = stream(seed);
  const air = stream(seed ^ 0x5bd1e995);
  const { r, int } = stream(seed ^ 0x27d4eb2f);

  const skyBottom = h - 14;
  for (let i = 0; i < Math.min(240, (w * skyBottom) / 190) && p.stars.length; i++) {
    const color = p.stars[sky.int(0, p.stars.length - 1)];
    const x = sky.int(0, w - 1);
    const y = sky.int(0, skyBottom);
    const sparkle = sky.r() < 0.025;
    if (overlaps(clear, x - 1, y - 1, x + 1, y + 1)) continue;
    g.fillStyle = color;
    g.fillRect(x, y, 1, 1);
    if (sparkle) {
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }
  if (p.cloud) {
    g.fillStyle = p.cloud;
    for (let i = 0; i < Math.max(2, w / 90); i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const cx = air.int(0, w - 24);
        const cy = air.int(2, Math.max(3, skyBottom - 16));
        const cw = air.int(12, 22);
        if (overlaps(clear, cx, cy - 2, cx + cw, cy + 5)) continue;
        g.fillRect(cx, cy + 2, cw, 3);
        g.fillRect(cx + 3, cy, cw - 8, 3);
        g.fillRect(cx + 6, cy - 2, Math.max(3, cw - 14), 2);
        break;
      }
    }
  }

  for (const row of ["far", "near"] as const) {
    let x = -int(0, 6);
    while (x < w) {
      const bw = row === "far" ? int(8, 16) : int(10, 22);
      const bh = row === "far" ? int(8, 17) : int(10, Math.min(25, h - 6));
      const top = h - bh;
      g.fillStyle = row === "far" ? p.far : p.near;
      g.fillRect(x, top, bw, bh);
      g.fillStyle = p.roof;
      g.fillRect(x, top, bw, 1);
      if (row === "near") {
        for (let wy = top + 3; wy < h - 2; wy += 4) {
          for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
            const lit = r() < p.litShare;
            g.fillStyle = lit ? p.lit[int(0, 1)] : p.window;
            g.fillRect(wx, wy, 2, 2);
          }
        }
        const roll = r();
        if (roll < 0.22) {
          const ax = x + int(2, bw - 3);
          g.fillStyle = p.roof;
          g.fillRect(ax, top - int(4, 7), 1, 7);
          if (p.beacon) {
            g.fillStyle = p.beacon;
            g.fillRect(ax, top - 7, 1, 1);
          }
        } else if (roll < 0.36) {
          const tx = x + int(1, Math.max(1, bw - 7));
          g.fillStyle = p.roof;
          g.fillRect(tx, top - 6, 6, 4);
          g.fillRect(tx + 1, top - 2, 1, 2);
          g.fillRect(tx + 4, top - 2, 1, 2);
        }
      }
      x += bw + (row === "far" ? int(-3, 2) : int(0, 2));
    }
  }
}

const NO_CLEAR: RefObject<HTMLElement | null>[] = [];

function City({ theme, seed, clear = NO_CLEAR, className }: { theme: "day" | "night"; seed: number; clear?: RefObject<HTMLElement | null>[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const c = canvas.getBoundingClientRect();
      const boxes = clear.flatMap((el) => {
        const b = el.current?.getBoundingClientRect();
        if (!b || !b.width || !b.height) return [];
        return [
          {
            x0: Math.floor((b.left - c.left - CLEAR_PAD) / UNIT),
            y0: Math.floor((b.top - c.top - CLEAR_PAD) / UNIT),
            x1: Math.ceil((b.right - c.left + CLEAR_PAD) / UNIT),
            y1: Math.ceil((b.bottom - c.top + CLEAR_PAD) / UNIT),
          },
        ];
      });
      drawCity(canvas, PALETTES[theme], seed, boxes);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    for (const el of clear) if (el.current) ro.observe(el.current);
    return () => ro.disconnect();
  }, [theme, seed, clear]);
  return <canvas ref={ref} aria-hidden className={cn("absolute inset-0 size-full [image-rendering:pixelated]", className)} />;
}

export function SkyToggle({ className }: { className?: string }) {
  const theme = useResolvedTheme();
  const set = usePrefs((p) => p.set);
  const night = theme === "night";
  return (
    <button
      type="button"
      onClick={() => set({ theme: night ? "day" : "night" })}
      aria-label={night ? "Day theme" : "Night theme"}
      title={night ? "Day theme" : "Night theme"}
      className={cn("group relative grid size-12 place-items-center overflow-hidden rounded-full transition-colors hover:bg-white/10", className)}
    >
      <span className={cn("absolute transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-opacity", night ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0")}>
        <PixelIcon name="moon" size={34} />
      </span>
      <span className={cn("absolute transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-opacity", night ? "translate-y-6 opacity-0" : "translate-y-0 opacity-100")}>
        <PixelIcon name="sun" size={34} />
      </span>
    </button>
  );
}

function seedOf(text: string) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function PageHero({ title, meta, children, actions }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const theme = useResolvedTheme();
  const seed = seedOf(typeof title === "string" ? title : "page");
  const textRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const clear = useMemo(() => [textRef, actionsRef], []);
  return (
    <section className="bleed relative isolate -mt-[max(env(safe-area-inset-top),24px)] mb-8 overflow-hidden lg:-mt-10">
      <div aria-hidden className={cn("absolute inset-0 transition-opacity duration-700", theme === "night" ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0d0f2b_0%,#15163b_55%,var(--bg)_100%)]" />
        <City theme="night" seed={seed} clear={clear} />
      </div>
      <div aria-hidden className={cn("absolute inset-0 transition-opacity duration-700", theme === "day" ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#9fcbee_0%,#cfe3f3_40%,#f9dccb_78%,var(--bg)_100%)]" />
        <City theme="day" seed={seed} clear={clear} />
      </div>
      <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-[calc(max(env(safe-area-inset-top),24px)+6px)] lg:px-10 lg:pb-28 lg:pt-12">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div ref={textRef} className="w-fit max-w-full">
              <h1 className={cn("font-display text-[34px] font-semibold leading-tight text-balance lg:text-[44px]", theme === "night" ? "text-[#f8f2fb] [text-shadow:0_2px_12px_#0d0f2b]" : "text-[#2c2340] [text-shadow:0_1px_10px_#d4e6f4]")}>
                {title}
              </h1>
              {meta && <p className={cn("mt-1 font-bold", theme === "night" ? "text-[#cfc6ea] [text-shadow:0_1px_8px_#0d0f2b]" : "text-[#4f4466] [text-shadow:0_1px_8px_#d4e6f4]")}>{meta}</p>}
            </div>
          </div>
          {actions && (
            <div ref={actionsRef} className="shrink-0">
              {actions}
            </div>
          )}
          <SkyToggle className="-me-2 -mt-1 shrink-0" />
        </div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </section>
  );
}

export function SkyBackdrop() {
  const theme = useResolvedTheme();
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <div className={cn("absolute inset-0 transition-opacity duration-700", theme === "night" ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0d0f2b_0%,#1a1a44_70%,#24214f_100%)]" />
        <City theme="night" seed={20261203} />
      </div>
      <div className={cn("absolute inset-0 transition-opacity duration-700", theme === "day" ? "opacity-100" : "opacity-0")}>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#9fcbee_0%,#cfe3f3_45%,#f9dccb_82%,#fbe8dc_100%)]" />
        <City theme="day" seed={20261203} />
      </div>
    </div>
  );
}
