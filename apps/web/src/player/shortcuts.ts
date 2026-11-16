import { create } from "zustand";

import { likedSnapshot, setLiked } from "@/lib/queries";

import * as controls from "./controls";
import { selectTrack, usePlayer } from "./store";

export const usePalette = create<{ open: boolean }>(() => ({ open: false }));

export const SHORTCUTS: [string, string][] = [
  ["Space", "Play or pause"],
  ["← / →", "Seek −10 s / +10 s"],
  ["↑ / ↓", "Volume"],
  ["← / →", "Waveform: seek −5 s / +5 s"],
  ["Page Down / Page Up", "Waveform: seek −30 s / +30 s"],
  ["Home / End", "Waveform: start / end"],
  ["Enter", "Mini player: expand"],
  ["Escape", "Collapse player, close sheets"],
  ["Ctrl / ⌘ + K", "Command palette"],
  ["L", "Like"],
  ["Q", "Queue"],
];

const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const OWN_KEYS = "[role=slider], [role=menu], [role=menuitem], [role=listbox], [role=option], [role=tablist], [cmdk-root]";

export function toggleLikeCurrent() {
  const track = selectTrack(usePlayer.getState());
  if (track) void setLiked(track.id, !likedSnapshot().has(track.id));
}

export function startShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      usePalette.setState((s) => ({ open: !s.open }));
      return;
    }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest(TYPING)) return;
    if (document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]")) return;
    if (target?.closest(OWN_KEYS)) return;
    switch (e.key) {
      case " ":
        if (target?.closest("button, a, [role=button], [role=tab], [role=switch]")) return;
        e.preventDefault();
        controls.toggle();
        break;
      case "ArrowLeft":
        e.preventDefault();
        controls.seekBy(-10);
        break;
      case "ArrowRight":
        e.preventDefault();
        controls.seekBy(10);
        break;
      case "ArrowUp":
        e.preventDefault();
        controls.volumeBy(0.05);
        break;
      case "ArrowDown":
        e.preventDefault();
        controls.volumeBy(-0.05);
        break;
      case "l":
      case "L":
        toggleLikeCurrent();
        break;
      case "q":
      case "Q":
        controls.togglePanel("queue");
        break;
      case "Escape":
        if (usePlayer.getState().expanded) controls.collapse();
        break;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
