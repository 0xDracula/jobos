export type StarPoint = { id: string; at: string };

export type PlacedStar = {
  id: string;
  x: number;
  y: number;
  month: string;
};

export type MonthGroup = { month: string; x: number; y: number; count: number };

export type StarLayout = {
  stars: PlacedStar[];
  lines: [number, number][];
  months: MonthGroup[];
};

export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monthOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "0000-00";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function layoutStars(points: StarPoint[], opts: { maxMonths?: number; maxPerMonth?: number; aspect?: number } = {}): StarLayout {
  const aspect = opts.aspect ?? 2;
  const byMonth = new Map<string, StarPoint[]>();
  for (const p of [...points].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    const m = monthOf(p.at);
    byMonth.set(m, [...(byMonth.get(m) ?? []), p]);
  }
  let months = [...byMonth.keys()].sort();
  if (opts.maxMonths && months.length > opts.maxMonths) months = months.slice(-opts.maxMonths);
  const stars: PlacedStar[] = [];
  const lines: [number, number][] = [];
  const groups: MonthGroup[] = [];
  const cols = Math.max(1, months.length);
  months.forEach((month, col) => {
    let list = byMonth.get(month)!;
    if (opts.maxPerMonth && list.length > opts.maxPerMonth) list = list.slice(-opts.maxPerMonth);
    const x0 = col / cols;
    const cw = 1 / cols;
    const r = random(hash(month));
    const yc = 0.3 + r() * 0.4;
    const span = Math.min(0.9, 0.35 + list.length * 0.06);
    const placed: PlacedStar[] = [];
    for (const p of list) {
      const rr = random(hash(p.id));
      let best: PlacedStar | null = null;
      let bestGap = -1;
      for (let k = 0; k < 8; k++) {
        const x = x0 + cw * (0.15 + rr() * 0.7);
        const y = Math.max(0.05, Math.min(0.95, yc + (rr() - 0.5) * span));
        const gap = placed.reduce((g, s) => Math.min(g, Math.hypot((s.x - x) * aspect, s.y - y)), Infinity);
        if (gap > bestGap) {
          bestGap = gap;
          best = { id: p.id, x, y, month };
        }
        if (gap > 0.12) break;
      }
      placed.push(best!);
    }
    const first = stars.length;
    stars.push(...placed);
    for (let i = 1; i < placed.length; i++) lines.push([first + i - 1, first + i]);
    const cx = placed.reduce((s, p) => s + p.x, 0) / Math.max(1, placed.length);
    const cy = placed.reduce((s, p) => s + p.y, 0) / Math.max(1, placed.length);
    groups.push({ month, x: cx, y: cy, count: placed.length });
  });
  return { stars, lines, months: groups };
}
