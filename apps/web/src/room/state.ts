import { create } from "zustand";

import type { HiddenNoteView } from "@/lib/types";

import type { RoomLayout } from "./layout";

export type RoomSheet = "sky" | "ambient" | "growth" | "notes" | "sleep" | "edit" | null;

type RoomState = {
  highlight: string | null;
  sheet: RoomSheet;
  selected: string | null;
  draft: RoomLayout | null;
  reveal: HiddenNoteView | null;
  pets: number;
  kittenAwakeUntil: number;
  sleepMode: boolean;
  unlocking: { id: string; at: number } | null;
  star: string | null;
};

export const useRoom = create<RoomState>(() => ({
  highlight: null,
  sheet: null,
  selected: null,
  draft: null,
  reveal: null,
  pets: 0,
  kittenAwakeUntil: 0,
  sleepMode: false,
  unlocking: null,
  star: null,
}));

export const openSheet = (sheet: RoomSheet) => useRoom.setState({ sheet });
