import { createRooftop } from "./rooftop";
import type { RoomArt } from "./types";

export function createCabin(): RoomArt {
  return { ...createRooftop(), id: "cabin" };
}
