import { usePrefs } from "@/lib/prefs";
import { uiSound } from "@/lib/sounds";

import { usePlayer } from "./store";

const NEEDLE_DELAY_MS = 450;

function reducedMotion(): boolean {
  const motion = usePrefs.getState().motion;
  return motion === "reduced" || (motion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

export function startPlayerSounds(): () => void {
  return usePlayer.subscribe((s, prev) => {
    if (s.playing && !prev.playing) setTimeout(() => uiSound("needle"), reducedMotion() ? 0 : NEEDLE_DELAY_MS);
    if (!s.playing && prev.playing && s.index >= 0) uiSound("lift");
  });
}
