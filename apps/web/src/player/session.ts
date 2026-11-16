import { artistLine } from "@/lib/format";
import { rateFor, usePrefs } from "@/lib/prefs";
import type { Track } from "@/lib/types";

import * as controls from "./controls";
import { selectTrack, usePlayer, type PlayerState } from "./store";

function artwork(t: Track): MediaImage[] {
  const out: MediaImage[] = [];
  if (t.artwork_thumb_url) out.push({ src: t.artwork_thumb_url, sizes: "300x300", type: "image/jpeg" });
  if (t.artwork_url) out.push({ src: t.artwork_url, sizes: "1000x1000", type: "image/jpeg" });
  return out;
}

function setPosition(s: PlayerState) {
  if (!s.duration || !Number.isFinite(s.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: s.duration,
      position: Math.min(Math.max(0, s.position), s.duration),
      playbackRate: rateFor(usePrefs.getState().effect),
    });
  } catch {
  }
}

export function startMediaSession(): () => void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => controls.play()],
    ["pause", () => controls.pause()],
    ["stop", () => controls.pause()],
    ["previoustrack", () => controls.previous()],
    ["nexttrack", () => controls.next()],
    ["seekto", (d) => d.seekTime != null && controls.seek(d.seekTime)],
    ["seekbackward", (d) => controls.seekBy(-(d.seekOffset ?? 10))],
    ["seekforward", (d) => controls.seekBy(d.seekOffset ?? 10)],
  ];
  for (const [action, handler] of handlers) {
    try {
      session.setActionHandler(action, handler);
    } catch {
    }
  }
  let lastPosition = 0;
  const unsubscribe = usePlayer.subscribe((s, prev) => {
    const track = selectTrack(s);
    const changed = track !== selectTrack(prev);
    if (changed) {
      session.metadata = track
        ? new MediaMetadata({ title: track.title, artist: artistLine(track.artists), album: track.album ?? "", artwork: artwork(track) })
        : null;
    }
    if (changed || s.playing !== prev.playing) session.playbackState = track ? (s.playing ? "playing" : "paused") : "none";
    const jumped = Math.abs(s.position - prev.position) > 1.5;
    if (changed || jumped || s.playing !== prev.playing || s.duration !== prev.duration || Math.abs(s.position - lastPosition) > 5) {
      lastPosition = s.position;
      setPosition(s);
    }
  });
  return () => {
    unsubscribe();
    for (const [action] of handlers) {
      try {
        session.setActionHandler(action, null);
      } catch {
      }
    }
  };
}
