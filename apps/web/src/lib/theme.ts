"use client";

import { useSyncExternalStore } from "react";

import { pickAccent, pickWash } from "./color";
import { usePrefs } from "./prefs";
import type { PaletteColor } from "./types";

const BG = { day: "#fff7f0", night: "#1e1b3a" } as const;

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function subscribeDark(onChange: () => void) {
  const q = darkQuery();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

export function useResolvedTheme(): "day" | "night" {
  const theme = usePrefs((p) => p.theme);
  const systemDark = useSyncExternalStore(subscribeDark, () => darkQuery().matches, () => false);
  if (theme === "auto") return systemDark ? "night" : "day";
  return theme;
}

export function useAlbumColors(palette: PaletteColor[] | undefined): { accent: string | null; wash: string | null } {
  const theme = useResolvedTheme();
  return { accent: pickAccent(palette, BG[theme]), wash: pickWash(palette) };
}
