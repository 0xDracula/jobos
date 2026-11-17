"use client";

import { AnimatePresence } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { lettersKeys, startLetters, useWelcome } from "@/lib/letters";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";

import { HandwritingFonts } from "./Handwriting";
import { replayWelcome, useSongDialog, useWelcomeState } from "./stores";

const WelcomeSequence = dynamic(() => import("./Welcome").then((m) => m.WelcomeSequence), { ssr: false });
const SongOfTheDayDialog = dynamic(() => import("./SongOfTheDay").then((m) => m.SongOfTheDayDialog), { ssr: false });

export function ReplayWelcome() {
  const me = useMe().data;
  const w = useWelcome(!!me);
  return (
    <Button size="sm" onClick={replayWelcome} disabled={!w.data?.letter}>
      Replay
    </Button>
  );
}

export function LettersLayer() {
  const me = useMe().data;
  const welcome = useWelcome(!!me);
  const replay = useWelcomeState((s) => s.replay);
  const songDialog = useSongDialog((s) => !!s.track);
  const [active, setActive] = useState(false);
  const [done, setDone] = useState(false);
  const w = welcome.data;

  useEffect(() => startLetters(), []);
  useEffect(() => {
    if (w?.letter && !w.seen && !done) setActive(true);
  }, [w, done]);

  const close = () => {
    setActive(false);
    setDone(true);
    useWelcomeState.setState({ replay: false });
    void queryClient.invalidateQueries({ queryKey: lettersKeys.welcome });
  };
  return (
    <>
      <HandwritingFonts />
      {songDialog && <SongOfTheDayDialog />}
      <AnimatePresence>{w?.letter && (active || replay) && <WelcomeSequence key="welcome" welcome={w} first={!w.seen} onClose={close} />}</AnimatePresence>
    </>
  );
}
