"use client";

import { Sparkles, Sun } from "lucide-react";

import { openSongOfTheDay } from "@/components/letters/stores";
import { MenuItem } from "@/components/ui";
import { lettersApi, refreshLetters, usePicks } from "@/lib/letters";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

export function LetterMenuItems({ track }: { track: Track }) {
  const picks = usePicks();
  const picked = !!picks.data?.mine.some((p) => p.track_id === track.id && !p.placeholder);
  const toggle = async () => {
    try {
      await lettersApi.pick(track.id, !picked);
      refreshLetters("picks", "song-of-the-day");
      toast(picked ? "Removed from picks" : "Added to picks");
    } catch {
      toast("Not saved");
    }
  };
  return (
    <>
      <MenuItem icon={<Sparkles />} onSelect={() => void toggle()}>
        {picked ? "Remove from picks" : "Add to picks"}
      </MenuItem>
      <MenuItem icon={<Sun />} onSelect={() => openSongOfTheDay(track)}>
        Song of the day
      </MenuItem>
    </>
  );
}
