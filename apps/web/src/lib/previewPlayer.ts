"use client";

import { pause as pausePlayer } from "@/player/controls";
import { usePlayer } from "@/player/store";

import { CLIP_MS } from "./previews";

type Listener = (state: { url: string | null; startMs: number; at: number; playing: boolean }) => void;

let el: HTMLAudioElement | null = null;
let current: { url: string; startMs: number } | null = null;
const listeners = new Set<Listener>();
let muted = false;

function emit() {
  const s = { url: current?.url ?? null, startMs: current?.startMs ?? 0, at: el ? el.currentTime * 1000 : 0, playing: !!el && !el.paused };
  listeners.forEach((fn) => fn(s));
}

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.addEventListener("timeupdate", () => {
    if (current && el && el.currentTime * 1000 >= current.startMs + CLIP_MS) el.currentTime = current.startMs / 1000;
    emit();
  });
  el.addEventListener("play", emit);
  el.addEventListener("pause", emit);
  el.addEventListener("ended", () => {
    if (current && el) {
      el.currentTime = current.startMs / 1000;
      void el.play().catch(() => {});
    }
  });
  return el;
}

export async function playPreview(url: string, startMs: number): Promise<boolean> {
  if (usePlayer.getState().playing) pausePlayer();
  const a = audio();
  a.muted = muted;
  if (current?.url !== url) {
    a.src = url;
    current = { url, startMs };
    await new Promise<void>((resolve) => {
      const done = () => {
        a.removeEventListener("loadedmetadata", done);
        resolve();
      };
      if (a.readyState >= 1) resolve();
      else a.addEventListener("loadedmetadata", done);
      setTimeout(resolve, 4000);
    });
  }
  current = { url, startMs };
  try {
    a.currentTime = startMs / 1000;
    await a.play();
    emit();
    return true;
  } catch {
    emit();
    return false;
  }
}

export function stopPreview() {
  if (el && !el.paused) el.pause();
  emit();
}

export function togglePreview() {
  if (!el) return;
  if (el.paused) void el.play().catch(() => {});
  else el.pause();
}

export function setPreviewMuted(on: boolean) {
  muted = on;
  if (el) el.muted = on;
}

export const previewMuted = () => muted;

export function onPreview(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function warmPreview(url: string) {
  const a = new Audio();
  a.preload = "auto";
  a.src = url;
}
