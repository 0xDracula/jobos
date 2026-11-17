import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { keys, queryClient } from "@/lib/queries";
import type { Track } from "@/lib/types";
import { playTracks, setSleep } from "@/player/controls";
import { startRadio, type RadioSeed } from "@/player/radio";
import { usePlayer, type PlayContext } from "@/player/store";

import { endSleepAmbient, startSleepAmbient } from "./ambient";
import { useRoom } from "./state";

const CALM: RadioSeed = { type: "mood", mood: "calm", name: "Calm" };
const SLEEP_AMBIENT_LEVEL = 0.5;

function playShuffled(tracks: Track[], context: PlayContext): boolean {
  if (!tracks.length) return false;
  const before = usePlayer.getState().queue;
  playTracks(tracks, -1, context, { shuffle: true });
  return usePlayer.getState().queue !== before;
}

async function playSleepMusic(choice: string | null): Promise<boolean> {
  try {
    if (choice === "likes") {
      const tracks = await queryClient.query({ queryKey: keys.likes("added"), queryFn: async () => (await api.likes("added")).tracks });
      if (playShuffled(tracks, { type: "likes", name: "Likes" })) return true;
    } else if (choice) {
      const list = await queryClient.query({ queryKey: keys.playlist(choice), queryFn: () => api.playlist(choice) });
      if (playShuffled(list.tracks, { type: "playlist", id: list.id, name: list.name })) return true;
    }
  } catch {
  }
  return startRadio(CALM);
}

export async function startSleepMode() {
  const p = usePrefs.getState();
  useRoom.setState({ sheet: null, sleepMode: true });
  if (!(await playSleepMusic(p.sleepPlaylist))) {
    useRoom.setState({ sleepMode: false });
    return;
  }
  setSleep({ mode: "time", minutes: p.sleepMinutes, endsAt: Date.now() + p.sleepMinutes * 60_000 });
  if (p.sleepAmbient) startSleepAmbient({ [p.sleepAmbient]: SLEEP_AMBIENT_LEVEL });
  else endSleepAmbient();
}
