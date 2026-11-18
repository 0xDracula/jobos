"use client";

import { Play, X } from "lucide-react";
import { motion, useReducedMotionConfig } from "motion/react";
import { useEffect, useState } from "react";

import { Artwork, LevelMeter } from "@/components/media";
import { SkyBackdrop } from "@/components/sky/PageHero";
import { Button, IconButton } from "@/components/ui";
import { lettersApi, type Welcome } from "@/lib/letters";
import { useMe, useMembers } from "@/lib/session";
import { uiSound } from "@/lib/sounds";
import { playTracks } from "@/player/controls";
import { selectCurrent, usePlayer } from "@/player/store";

import { Handwriting } from "./Handwriting";
import { LetterReveal, useNames } from "./Letters";

function SongChip({ welcome, started, onPlay }: { welcome: Welcome; started: boolean; onPlay: () => void }) {
  const song = welcome.song;
  const playing = usePlayer((s) => s.playing && selectCurrent(s)?.track.id === song?.id);
  if (!song) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: started ? 1 : 0, y: started ? 0 : 12 }}
      className="mx-auto mt-6 flex w-full max-w-sm items-center gap-3 rounded-card border border-panel-line bg-panel p-2"
    >
      <Artwork src={song.artwork_thumb_url ?? song.artwork_url} className="size-12 shrink-0 rounded-[5px]" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate font-extrabold">
          {song.title}
        </p>
        <p dir="auto" className="truncate text-sm font-semibold text-muted">
          {song.artists.join(", ")}
        </p>
      </div>
      {playing ? (
        <LevelMeter playing className="me-3" />
      ) : (
        <IconButton label={`Play ${song.title}`} onClick={onPlay}>
          <Play />
        </IconButton>
      )}
    </motion.div>
  );
}

export function WelcomeSequence({ welcome, first, onClose }: { welcome: Welcome; first: boolean; onClose: () => void }) {
  const letter = welcome.letter!;
  const me = useMe().data;
  const members = useMembers();
  const names = useNames();
  const reduced = useReducedMotionConfig();
  const [read, setRead] = useState(false);
  const [started, setStarted] = useState(false);
  const recipient = members.data?.find((u) => u.id !== letter.author_id);

  const startSong = () => {
    const song = welcome.song;
    if (!song) return;
    const wasPlaying = usePlayer.getState().playing;
    playTracks([song], 0, { type: "queue", name: "Our song" });
    if (wasPlaying) uiSound("needle");
    setStarted(true);
  };

  useEffect(() => {
    if (!read) return;
    const t = setTimeout(startSong, reduced ? 300 : 1400);
    return () => clearTimeout(t);
  }, [read]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const opening = () => {
    if (!first) return;
    void lettersApi.welcomeSeen().catch(() => {});
    if (me && letter.author_id !== me.id && !letter.opened_at) void lettersApi.openLetter(letter.id).catch(() => {});
  };

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome letter"
      className="fixed inset-0 isolate z-[85] overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.5 }}
    >
      <SkyBackdrop />
      <div className="fixed end-[max(12px,env(safe-area-inset-right))] top-[max(12px,env(safe-area-inset-top))] z-10">
        <IconButton label="Close" onClick={onClose} className="bg-surface-solid/80 shadow-soft">
          <X />
        </IconButton>
      </div>
      <div className="mx-auto grid min-h-full grid-cols-1 w-full max-w-xl content-center px-4 pb-16 pt-16">
        <LetterReveal
          letter={letter}
          authorName={names(letter.author_id)}
          waitForTap
          onOpening={opening}
          onRead={() => setRead(true)}
          label={
            recipient ? (
              <Handwriting authorId={letter.author_id} className="text-[clamp(22px,11cqw,34px)]">
                {recipient.display_name}
              </Handwriting>
            ) : undefined
          }
        >
          <SongChip welcome={welcome} started={started} onPlay={startSong} />
          <div className="mt-6 flex justify-center">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </LetterReveal>
      </div>
    </motion.div>
  );
}
