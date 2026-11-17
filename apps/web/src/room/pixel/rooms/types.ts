import type { Weather } from "@/lib/types";

import type { Season } from "../../calendar";
import { ROOMS, type RoomChoice } from "../../layout";
import type { SkyState } from "../../sky";
import type { Kit } from "../kit";

export type Ctx = CanvasRenderingContext2D;

export const ROOM_IDS = ROOMS;
export type RoomId = RoomChoice;

export const ROOM_LABELS: Record<RoomId, string> = {
  rooftop: "Rooftop room",
  cafe: "Rainy café",
  beach: "Beach house",
  cabin: "Snowy cabin",
};

export const OBJECT_LABELS: Record<RoomId, Partial<Record<string, string>>> = {
  rooftop: {},
  cafe: { bed: "Sofa", records: "Shelf", speaker: "Radio" },
  beach: { speaker: "Radio" },
  cabin: { speaker: "Radio" },
};

export type Item = { bottom: number; draw: (g: Ctx) => void };

export type Furniture = {
  desk: HTMLCanvasElement;
  window: HTMLCanvasElement;
  bed: HTMLCanvasElement;
  lamp: HTMLCanvasElement;
  bookcase: HTMLCanvasElement;
  picture: HTMLCanvasElement;
  secondWindow: HTMLCanvasElement;
  shelfPlant: HTMLCanvasElement;
  speaker: HTMLCanvasElement;
  table: HTMLCanvasElement;
};

export type Look = { wall: string; floor: string; accent: string };

export type BackdropInput = { sky: SkyState; weather: Weather | null; season: Season | null };

export type AnimateInput = BackdropInput & {
  t: number;
  still: boolean;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

export interface RoomArt {
  id: RoomId;
  customWalls: boolean;
  sky?(s: SkyState): SkyState;
  weather?(w: Weather | null): Weather | null;
  season?(s: Season | null, w: Weather | null): Season | null;
  init(kit: Kit): Furniture;
  backdropKey(b: BackdropInput): string;
  drawBackdrop(g: Ctx, lights: Ctx, b: BackdropInput): void;
  animateBackdrop?(g: Ctx, a: AnimateInput): void;
  drawShell(g: Ctx, kit: Kit, look: Look): void;
  props(kit: Kit, look: Look): Item[];
  animate?(g: Ctx, a: AnimateInput): void;
  glow?(g: Ctx, a: AnimateInput): void;
}
