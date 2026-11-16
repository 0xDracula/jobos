import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  night: [-4, -3, -2, -1, 0, 1, 1, 0, -2, -4],
} as const satisfies Record<string, readonly number[]>;

export type EqPreset = keyof typeof EQ_PRESETS | "custom";

export const EQ_PRESET_LABELS: Record<EqPreset, string> = {
  flat: "Flat",
  bass: "Bass boost",
  vocal: "Vocal",
  treble: "Treble",
  night: "Night",
  custom: "Custom",
};

export type Effect = "none" | "slowed" | "spedup" | "8d";

export const EFFECT_LABELS: Record<Effect, string> = {
  none: "None",
  slowed: "Slowed + reverb",
  spedup: "Sped up",
  "8d": "8D",
};

export type Theme = "auto" | "day" | "night";
export type MotionPref = "system" | "reduced" | "full";

export type Prefs = {
  theme: Theme;
  motion: MotionPref;
  beatIntensity: number;
  seasons: boolean;
  uiSounds: boolean;
  sleepPlaylist: string | null;
  sleepMinutes: number;
  weekendPlaylist: string | null;
  ambient: Record<string, number>;
  volume: number;
  muted: boolean;
  crossfade: number;
  eqPreset: EqPreset;
  eqGains: number[];
  effect: Effect;
  vinyl: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "auto",
  motion: "system",
  beatIntensity: 0.6,
  seasons: true,
  uiSounds: false,
  sleepPlaylist: null,
  sleepMinutes: 30,
  weekendPlaylist: null,
  ambient: {},
  volume: 1,
  muted: false,
  crossfade: 0,
  eqPreset: "flat",
  eqGains: [...EQ_PRESETS.flat],
  effect: "none",
  vinyl: false,
};

export const PREFS_KEY = "jobbos.prefs";

export const usePrefs = create<Prefs & { set: (patch: Partial<Prefs>) => void }>()(
  persist((set) => ({ ...DEFAULT_PREFS, set: (patch) => set(patch) }), {
    name: PREFS_KEY,
    storage: createJSONStorage(() => localStorage),
    skipHydration: true,
    partialize: ({ set: _set, ...prefs }) => prefs,
  }),
);

export const eqActive = (p: Pick<Prefs, "eqGains">) => p.eqGains.some((g) => g !== 0);

export const rateFor = (effect: Effect) => (effect === "slowed" ? 0.85 : effect === "spedup" ? 1.25 : 1);
