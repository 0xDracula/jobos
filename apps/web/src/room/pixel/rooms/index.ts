import { createRooftop } from "./rooftop";
import type { RoomArt, RoomId } from "./types";

export async function loadRoomArt(id: RoomId): Promise<RoomArt> {
  switch (id) {
    case "cafe":
      return (await import("./cafe")).createCafe();
    case "beach":
      return (await import("./beach")).createBeach();
    case "cabin":
      return (await import("./cabin")).createCabin();
    default:
      return createRooftop();
  }
}
