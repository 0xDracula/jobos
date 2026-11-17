export const AVATAR_STYLES = ["amelia", "alex", "adam", "bob"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export type AvatarLook = {
  v: 1;
  style: AvatarStyle;
  hair: string;
  skin: string;
  outfit: string;
  glasses: boolean;
};

export const STYLE_LABELS: Record<AvatarStyle, string> = { amelia: "Long", alex: "Bob cut", adam: "Tousled", bob: "Short" };

export const HAIR_COLORS = ["#2b2833", "#4a3328", "#8a6552", "#8c4a32", "#d9b46a", "#b5502e", "#9a96a0", "#e88fa3", "#4f6fb0", "#7a5aa8"];
export const SKIN_COLORS = ["#ffdfc8", "#ffcbb0", "#e8b08f", "#c98b6a", "#a8694a", "#7a4a32"];
export const OUTFIT_COLORS = ["#e88fa3", "#c84a5a", "#e8924a", "#e8c25a", "#5aa37e", "#3aa6a0", "#4985cc", "#9b77c4", "#3d3a4a", "#e8e4ec"];

const HEX = /^#[0-9a-f]{6}$/i;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function defaultLook(userId: string): AvatarLook {
  const h = hash(userId);
  return { v: 1, style: h % 2 ? "amelia" : "alex", hair: "#4a3328", skin: "#ffcbb0", outfit: h % 2 ? "#e88fa3" : "#4985cc", glasses: false };
}

export function parseLook(raw: unknown): AvatarLook | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.style !== "string" || !(AVATAR_STYLES as readonly string[]).includes(r.style)) return null;
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
  return {
    v: 1,
    style: r.style as AvatarStyle,
    hair: color(r.hair, "#4a3328"),
    skin: color(r.skin, "#ffcbb0"),
    outfit: color(r.outfit, "#e88fa3"),
    glasses: r.glasses === true,
  };
}

export const lookOf = (userId: string, raw: unknown) => parseLook(raw) ?? defaultLook(userId);

export const lookKey = (l: AvatarLook) => `${l.style}|${l.hair}|${l.skin}|${l.outfit}|${l.glasses ? 1 : 0}`;

type Hsl = [number, number, number];

export function toHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function shift(color: string, main: string, target: string): string {
  const [h, s, l] = toHsl(color);
  const [mh, ms, ml] = toHsl(main);
  const [th, ts, tl] = toHsl(target);
  const dh = s < 0.08 || ms < 0.08 ? 0 : h - mh;
  return fromHsl([th + dh, clamp(ts + (s - ms) * 0.8, 0, 1), clamp(tl + (l - ml), 0.03, 0.97)]);
}

export type Role = "hair" | "skin" | "outfit";
export type Rule = { role: Role; main: string; colors: string[]; rows?: [number, number] };

export const RULES: Record<AvatarStyle, Rule[]> = {
  amelia: [
    { role: "hair", main: "#8a6552", colors: ["#8a6552", "#957350", "#ba8d5e", "#8d7051", "#674d49", "#a77a67"], rows: [0, 22] },
    { role: "skin", main: "#bf8b78", colors: ["#bf8b78", "#b57972", "#b2736d", "#aa5e56"] },
    { role: "outfit", main: "#a85377", colors: ["#a85377", "#b95d72"], rows: [23, 31] },
  ],
  alex: [
    { role: "hair", main: "#8d7051", colors: ["#8d7051", "#957350", "#ba8d5e", "#8a6552"], rows: [0, 22] },
    { role: "skin", main: "#ffcbb0", colors: ["#ffcbb0", "#f6ae9f", "#ffb893", "#f69784", "#e19b9b", "#d3a38d"] },
    { role: "outfit", main: "#ae4a52", colors: ["#5a444a", "#6f494d", "#ae4a52", "#a2394b"], rows: [23, 31] },
  ],
  adam: [
    { role: "hair", main: "#687253", colors: ["#959d58", "#687253", "#5f694a", "#5d6043"], rows: [0, 22] },
    { role: "skin", main: "#ffcbb0", colors: ["#ffcbb0", "#f6ae9f", "#f69784", "#ffb893", "#e19b9b", "#bba386", "#d3a38d"] },
    { role: "outfit", main: "#9f74a8", colors: ["#805e8e", "#9f74a8"], rows: [23, 31] },
  ],
  bob: [
    { role: "hair", main: "#5d585f", colors: ["#716b6e", "#5d585f", "#555157"], rows: [0, 22] },
    { role: "skin", main: "#ffcbb0", colors: ["#ffcbb0", "#f6ae9f", "#e19b9b", "#c9a495", "#b59e95", "#a5948f", "#d3a38d"] },
    { role: "outfit", main: "#565972", colors: ["#565972", "#46465e", "#6c6e85"], rows: [23, 31] },
  ],
};

export function recolor(style: AvatarStyle, look: AvatarLook, hex: string, row: number): string | null {
  for (const r of RULES[style]) {
    if (r.rows && (row < r.rows[0] || row > r.rows[1])) continue;
    if (!r.colors.includes(hex)) continue;
    return shift(hex, r.main, look[r.role]);
  }
  return null;
}
