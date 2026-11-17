import { usePrefs } from "@/lib/prefs";
import { keys, queryClient } from "@/lib/queries";
import type { Track } from "@/lib/types";
import { getEngine } from "@/player/engine";
import { selectTrack, usePlayer } from "@/player/store";

import { roomClock } from "./clock";

export const FALLBACK_BPM = 100;
export const FALLBACK_LEVEL = 0.6;
export const BEAT_HOLD_MS = 170;

export const beat = {
  pulse: 0,
  playing: 0,
  tempo: 0,
  since: Infinity,
};

let lastIndex = 0;
let lastTrack = "";

function lastBeatBefore(beats: number[], ms: number): number {
  if (lastIndex >= beats.length || beats[lastIndex] > ms) lastIndex = 0;
  while (lastIndex + 1 < beats.length && beats[lastIndex + 1] <= ms) lastIndex++;
  return beats[lastIndex] <= ms ? lastIndex : -1;
}

export function tickBeat(dt: number, reducedMotion: boolean) {
  const s = usePlayer.getState();
  const target = s.playing ? 1 : 0;
  beat.playing += (target - beat.playing) * Math.min(1, dt * 3);
  const track = selectTrack(s);
  const intensity = reducedMotion ? 0 : usePrefs.getState().beatIntensity;
  const detail = track ? queryClient.getQueryData<Track>(keys.track(track.id)) : undefined;
  if (!track || !s.playing || intensity <= 0 || !detail) {
    beat.pulse *= Math.exp(-dt * 8);
    beat.since = Infinity;
    return;
  }
  if (track.id !== lastTrack) {
    lastTrack = track.id;
    lastIndex = 0;
  }
  const beats = detail.audio?.beats;
  const analyzed = !!beats || !!detail.audio?.tempo_bpm;
  const fallback = !analyzed && roomClock.bpm == null;
  const tempo = detail.audio?.tempo_bpm ?? roomClock.bpm ?? (fallback ? FALLBACK_BPM : 0);
  const level = fallback ? FALLBACK_LEVEL : 1;
  beat.tempo = tempo;
  const ms = getEngine().currentTime() * 1000;
  let since = -1;
  if (beats?.length) {
    const i = lastBeatBefore(beats, ms);
    if (i >= 0) since = ms - beats[i];
  } else if (tempo > 0) {
    const period = 60_000 / tempo;
    since = ms % period;
  }
  beat.since = since >= 0 ? since : Infinity;
  beat.pulse = since >= 0 ? intensity * level * Math.exp(-since / 150) : beat.pulse * Math.exp(-dt * 8);
}
