"use client";

import { useEffect, useRef } from "react";

import { getEngine } from "@/player/engine";
import { usePlayer } from "@/player/store";

export function usePlaybackClock(onTime: (seconds: number) => void) {
  const callback = useRef(onTime);
  useEffect(() => {
    callback.current = onTime;
  });
  const playing = usePlayer((s) => s.playing);
  useEffect(() => {
    callback.current(getEngine().currentTime());
    if (!playing) {
      return usePlayer.subscribe((s, prev) => {
        if (s.position !== prev.position || s.index !== prev.index) callback.current(s.position);
      });
    }
    let frame = 0;
    const loop = () => {
      callback.current(getEngine().currentTime());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
}
