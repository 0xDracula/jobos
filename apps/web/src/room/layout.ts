export type Zone = "inside" | "roof";

export type Placement = { x: number; y: number; flip: boolean };

export type Decoration = {
  id: string;
  label: string;
  zone: Zone;
  sprites: string[];
  unlock?: string;
  home: Placement;
};

export const DECORATIONS: Decoration[] = [
  { id: "rug", label: "Rug", zone: "inside", sprites: ["rug_red", "rug_blue", "rug_green"], home: { x: 86, y: 160, flip: false } },
  { id: "roof_rug", label: "Roof rug", zone: "roof", sprites: ["rug_blue", "rug_red", "rug_green"], home: { x: 226, y: 160, flip: false } },
  { id: "sofa", label: "Sofa", zone: "roof", sprites: ["sofa_red"], home: { x: 222, y: 140, flip: false } },
  { id: "floor_cushion", label: "Floor cushions", zone: "roof", sprites: ["cushions_warm", "cushions_cool"], home: { x: 258, y: 166, flip: false } },
  { id: "clay_pot", label: "Clay pot", zone: "roof", sprites: ["pot_qulla", "pot_gold", "pot_green"], home: { x: 168, y: 140, flip: false } },
  { id: "vase", label: "Vase", zone: "inside", sprites: ["pot_green", "pot_gold", "pot_qulla"], home: { x: 140, y: 138, flip: false } },
  { id: "fairy_jar", label: "Fairy light jar", zone: "roof", sprites: ["fairy_jar"], unlock: "fairy_jar", home: { x: 182, y: 166, flip: false } },
  { id: "moon_lamp", label: "Moon lamp", zone: "inside", sprites: ["moon_lamp"], unlock: "moon_lamp", home: { x: 120, y: 166, flip: false } },
  { id: "hanging_plant", label: "Hanging plant", zone: "inside", sprites: ["hanging_plant"], unlock: "hanging_plant", home: { x: 22, y: 130, flip: false } },
  { id: "bunting", label: "Bunting", zone: "roof", sprites: ["bunting"], unlock: "bunting", home: { x: 236, y: 130, flip: false } },
  { id: "bean_bag", label: "Bean bag", zone: "roof", sprites: ["bean_bag"], unlock: "bean_bag", home: { x: 290, y: 168, flip: false } },
  { id: "disco_ball", label: "Disco ball", zone: "roof", sprites: ["disco_ball"], unlock: "disco_ball", home: { x: 200, y: 166, flip: false } },
  { id: "anniversary_cake", label: "Cake", zone: "roof", sprites: ["anniversary_cake"], unlock: "anniversary_cake", home: { x: 296, y: 154, flip: false } },
  { id: "photo_garland", label: "Photo garland", zone: "inside", sprites: ["photo_garland"], unlock: "photo_garland", home: { x: 32, y: 130, flip: false } },
  { id: "star_lantern", label: "Star lantern", zone: "roof", sprites: ["star_lantern"], unlock: "star_lantern", home: { x: 262, y: 130, flip: false } },
  { id: "rose_bouquet", label: "Rose bouquet", zone: "inside", sprites: ["rose_bouquet"], unlock: "rose_bouquet", home: { x: 146, y: 168, flip: false } },
];

export const HANGING_DECORATIONS = new Set(["hanging_plant", "photo_garland", "star_lantern", "bunting"]);

export type ItemChange = { x?: number; y?: number; flip?: boolean; hidden?: boolean; variant?: number };

export const ROOMS = ["rooftop", "cafe", "beach", "cabin"] as const;
export type RoomChoice = (typeof ROOMS)[number];

export const ACCENT_AUTO = "auto";
export const DEFAULT_ACCENT = "#e88fa3";

export type RoomLayout = {
  room: RoomChoice;
  look: { wall: string; floor: string; accent: string };
  items: Record<string, ItemChange>;
};

export const resolveAccent = (accent: string, favorite: string | null | undefined) => (accent === ACCENT_AUTO ? (favorite ?? DEFAULT_ACCENT) : accent);

export const WALL_STYLES = ["slate", "mint", "butter", "rose", "linen", "oak", "walnut", "cherry"] as const;
export const FLOOR_STYLES = ["walnut", "oak", "cherry", "parquet", "tiles", "aqua", "brick"] as const;
export const ACCENT_COLORS = ["#e88fa3", "#8f85a9", "#e0b870", "#447e70", "#4985cc", "#ca8854"];

export const STYLE_LABELS: Record<string, string> = {
  slate: "Slate",
  mint: "Mint stripes",
  butter: "Butter stripes",
  rose: "Rose stripes",
  linen: "Linen",
  oak: "Oak",
  walnut: "Walnut",
  cherry: "Cherry",
  parquet: "Parquet",
  tiles: "Yellow tiles",
  aqua: "Aqua tiles",
  brick: "Terracotta",
};

export const DEFAULT_LAYOUT: RoomLayout = {
  room: "rooftop",
  look: { wall: "slate", floor: "walnut", accent: ACCENT_AUTO },
  items: {},
};

const HEX = /^#[0-9a-f]{6}$/i;

export function parseLayout(raw: unknown): RoomLayout {
  const out: RoomLayout = { room: DEFAULT_LAYOUT.room, look: { ...DEFAULT_LAYOUT.look }, items: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { room?: unknown; look?: Record<string, unknown>; items?: Record<string, unknown> };
  if (typeof r.room === "string" && (ROOMS as readonly string[]).includes(r.room)) out.room = r.room as RoomChoice;
  const wall = r.look?.wall;
  if (typeof wall === "string" && (WALL_STYLES as readonly string[]).includes(wall)) out.look.wall = wall;
  const floor = r.look?.floor;
  if (typeof floor === "string" && (FLOOR_STYLES as readonly string[]).includes(floor)) out.look.floor = floor;
  const accent = r.look?.accent;
  if (typeof accent === "string" && (HEX.test(accent) || accent === ACCENT_AUTO)) out.look.accent = accent;
  for (const d of DECORATIONS) {
    const c = r.items?.[d.id] as ItemChange | undefined;
    if (!c || typeof c !== "object") continue;
    const item: ItemChange = {};
    if (Number.isFinite(c.x) && Number.isFinite(c.y)) [item.x, item.y] = clampToZone(d.zone, c.x!, c.y!);
    if (typeof c.flip === "boolean") item.flip = c.flip;
    if (typeof c.hidden === "boolean") item.hidden = c.hidden;
    if (Number.isInteger(c.variant) && c.variant! >= 0 && c.variant! < d.sprites.length) item.variant = c.variant;
    out.items[d.id] = item;
  }
  return out;
}

export const AREAS: Record<Zone, [number, number, number, number]> = {
  inside: [14, 146, 130, 170],
  roof: [166, 306, 130, 170],
};

export function clampToZone(zone: Zone, x: number, y: number): [number, number] {
  const [x0, x1, y0, y1] = AREAS[zone];
  return [Math.round(Math.min(x1, Math.max(x0, x))), Math.round(Math.min(y1, Math.max(y0, y)))];
}

export function placementOf(d: Decoration, change?: ItemChange): Placement & { hidden: boolean; sprite: string } {
  return {
    x: change?.x ?? d.home.x,
    y: change?.y ?? d.home.y,
    flip: change?.flip ?? d.home.flip,
    hidden: change?.hidden ?? false,
    sprite: d.sprites[change?.variant ?? 0] ?? d.sprites[0],
  };
}
