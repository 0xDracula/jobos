import { createRooftop } from "./rooftop";
import type { RoomArt } from "./types";

export function createCafe(): RoomArt {
  return { ...createRooftop(), id: "cafe" };
}
