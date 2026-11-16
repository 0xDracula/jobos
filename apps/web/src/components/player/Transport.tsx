"use client";

import { Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { isIOS } from "@/lib/device";
import { bouncy } from "@/lib/motion";
import { usePrefs } from "@/lib/prefs";
import { setLiked, useLikedIds } from "@/lib/queries";
import { cycleRepeat, next, previous, setShuffle, setVolume, toggle, toggleMute } from "@/player/controls";
import { usePlayer } from "@/player/store";

import { IconButton, Slider, Spinner } from "../ui";

export function PlayButton({ size = "lg", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering && s.playing);
  const icon = size === "lg" ? "size-8" : size === "md" ? "size-6" : "size-5";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? "Pause" : "Play"}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-tint text-bg shadow-soft transition-transform active:scale-90",
        size === "lg" && "size-[72px]",
        size === "md" && "size-12",
        size === "sm" && "size-11",
        className,
      )}
    >
      {buffering && <Spinner className="absolute inset-0 m-auto size-[calc(100%+8px)] text-tint opacity-60 [stroke-width:1.2]" />}
      {playing ? <Pause className={cn(icon, "fill-current")} /> : <Play className={cn(icon, "translate-x-[1px] fill-current")} />}
    </button>
  );
}

export function PrevButton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <IconButton label="Previous" size={size} onClick={previous}>
      <SkipBack className="fill-current" />
    </IconButton>
  );
}

export function NextButton({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return (
    <IconButton label="Next" size={size} onClick={next}>
      <SkipForward className="fill-current" />
    </IconButton>
  );
}

export function ShuffleButton() {
  const shuffle = usePlayer((s) => s.shuffle);
  return (
    <IconButton label={shuffle ? "Shuffle on" : "Shuffle off"} aria-pressed={shuffle} active={shuffle} onClick={() => setShuffle(!shuffle)}>
      <Shuffle />
    </IconButton>
  );
}

export function RepeatButton() {
  const repeat = usePlayer((s) => s.repeat);
  const label = repeat === "off" ? "Repeat off" : repeat === "all" ? "Repeat all" : "Repeat one";
  return (
    <IconButton label={label} active={repeat !== "off"} onClick={cycleRepeat}>
      {repeat === "one" ? <Repeat1 /> : <Repeat />}
    </IconButton>
  );
}

export function LikeButton({ trackId, size = "md" }: { trackId: string; size?: "sm" | "md" }) {
  const liked = useLikedIds().has(trackId);
  return (
    <IconButton label={liked ? "Remove from likes" : "Like"} aria-pressed={liked} size={size} onClick={() => void setLiked(trackId, !liked)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={liked ? "on" : "off"}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={bouncy}
          className="grid place-items-center"
        >
          <Heart className={cn(liked && "fill-accent text-accent")} />
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}

export function VolumeControl({ className }: { className?: string }) {
  const volume = usePrefs((p) => p.volume);
  const muted = usePrefs((p) => p.muted);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(!isIOS()), []);
  if (!supported) return null;
  const level = muted ? 0 : volume;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <IconButton label={muted ? "Unmute" : "Mute"} size="sm" onClick={toggleMute}>
        {level === 0 ? <VolumeX /> : level < 0.5 ? <Volume1 /> : <Volume2 />}
      </IconButton>
      <div className="w-24 shrink-0">
        <Slider label="Volume" min={0} max={1} step={0.01} value={[level]} onValueChange={([v]) => setVolume(v)} />
      </div>
    </div>
  );
}
