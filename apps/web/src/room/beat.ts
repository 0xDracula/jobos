import { usePrefs } from "@/lib/prefs";
import { keys, queryClient } from "@/lib/queries";
import type { Track } from "@/lib/types";
import { getEngine } from "@/player/engine";
import { selectTrack, usePlayer } from "@/player/store";

export const beat = {
  pulse: 0,
  playing: 0,
  tempo: 0,
};

let lastIndex = 0;
let lastTrack = "";

function lastBeatBefore(beats: number[], ms: number): number {
  if (lastIndex >= beats.length || beats[lastIndex] > ms) lastIndex = 0;
  while (lastIndex + 1 < beats.length && beats[lastIndex + 1] <= ms) lastIndex++;
  return beats[lastIndex] <= ms ? beats[lastIndex] : -1;
}

export function tickBeat(dt: number, reducedMotion: boolean) {
  const s = usePlayer.getState();
  const target = s.playing ? 1 : 0;
  beat.playing += (target - beat.playing) * Math.min(1, dt * 3);
  const track = selectTrack(s);
  const intensity = reducedMotion ? 0 : usePrefs.getState().beatIntensity;
  if (!track || !s.playing || intensity <= 0) {
    beat.pulse *= Math.exp(-dt * 8);
    return;
  }
  if (track.id !== lastTrack) {
    lastTrack = track.id;
    lastIndex = 0;
  }
  const detail = queryClient.getQueryData<Track>(keys.track(track.id));
  const beats = detail?.audio?.beats;
  const tempo = detail?.audio?.tempo_bpm ?? 0;
  beat.tempo = tempo;
  const ms = getEngine().currentTime() * 1000;
  let since = -1;
  if (beats?.length) {
    const at = lastBeatBefore(beats, ms);
    if (at >= 0) since = ms - at;
  } else if (tempo > 0) {
    const period = 60_000 / tempo;
    since = ms % period;
  }
  beat.pulse = since >= 0 ? intensity * Math.exp(-since / 150) : beat.pulse * Math.exp(-dt * 8);
}
