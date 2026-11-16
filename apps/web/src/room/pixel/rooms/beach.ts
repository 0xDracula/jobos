import { createRooftop } from "./rooftop";
import type { RoomArt } from "./types";

export function createBeach(): RoomArt {
  return { ...createRooftop(), id: "beach" };
}
