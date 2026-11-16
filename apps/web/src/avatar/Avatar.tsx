"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useMembers } from "@/lib/session";

import { avatarFrames } from "./draw";
import { lookOf, type AvatarLook } from "./look";
import type { AvatarPose } from "./types";

export type AvatarProps = {
  userId: string;
  size: number;
  pose?: AvatarPose;
  look?: AvatarLook;
  className?: string;
};

export function Avatar({ userId, size, pose = "idle", look, className }: AvatarProps) {
  const members = useMembers();
  const user = members.data?.find((u) => u.id === userId);
  const shown = look ?? lookOf(userId, user?.avatar);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const full = size >= 48;
  const box = full ? { y: 8, h: 24, w: 16 } : { y: 9, h: 16, w: 16 };
  useEffect(() => {
    let dead = false;
    void avatarFrames(shown).then((f) => {
      const c = ref.current;
      if (dead || !c) return;
      const frame = pose === "listening" ? f.standPhones[0] : pose === "together" ? f.sitRight[0] : f.stand[0];
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(frame, 0, box.y, box.w, box.h, full ? 4 : 0, 0, box.w, box.h);
      setReady(true);
    });
    return () => {
      dead = true;
    };
  }, [shown.style, shown.hair, shown.skin, shown.outfit, shown.glasses, pose, full]);
  const name = user?.display_name ?? "";
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={name}
      width={full ? 24 : 16}
      height={full ? 24 : 16}
      style={{ width: size, height: size }}
      className={cn("shrink-0 [image-rendering:pixelated]", !ready && "opacity-0", className)}
    />
  );
}
