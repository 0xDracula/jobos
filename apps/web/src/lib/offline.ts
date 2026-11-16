import { create } from "zustand";

import { api } from "./api";
import { load, save } from "./storage";
import { toast } from "./toast";
import type { Track } from "./types";

export const OFFLINE_CACHE = "jobbos-offline-v1";
const INDEX_KEY = "jobbos.offline";
const CONCURRENCY = 2;
const CACHE_WAIT_MS = 15 * 60_000;

export type OfflineEntry = {
  id: string;
  url: string;
  art: string[];
  bytes: number;
  title: string;
  artists: string[];
  at: number;
};

type OfflineState = {
  entries: Record<string, OfflineEntry>;
  progress: Record<string, number>;
  usage: number | null;
  quota: number | null;
};

export const useOffline = create<OfflineState>(() => ({ entries: {}, progress: {}, usage: null, quota: null }));

export const offlineSupported = () => typeof caches !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator;

export function initOffline() {
  useOffline.setState({ entries: load<Record<string, OfflineEntry>>(INDEX_KEY, {}) });
  void refreshUsage();
}

export async function refreshUsage() {
  if (!navigator.storage?.estimate) return;
  const { usage, quota } = await navigator.storage.estimate();
  useOffline.setState({ usage: usage ?? null, quota: quota ?? null });
}

function setEntries(update: (entries: Record<string, OfflineEntry>) => Record<string, OfflineEntry>) {
  const entries = update({ ...useOffline.getState().entries });
  useOffline.setState({ entries });
  save(INDEX_KEY, entries);
}

function setProgress(id: string, value: number | null) {
  useOffline.setState((s) => {
    const progress = { ...s.progress };
    if (value == null) delete progress[id];
    else progress[id] = value;
    return { progress };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cachedTrack(track: Track): Promise<Track> {
  if (track.audio) return track;
  let t = await api.cache(track.id);
  const until = Date.now() + CACHE_WAIT_MS;
  while (!t.audio) {
    if (t.status === "failed" || t.status === "missing") throw new Error(t.error ?? "download failed");
    if (Date.now() > until) throw new Error("download timed out");
    await sleep(5000);
    t = await api.track(track.id);
  }
  return t;
}

async function downloadOne(track: Track) {
  const id = track.id;
  try {
    if (!track.audio) setProgress(id, -1);
    const t = await cachedTrack(track);
    const url = t.audio!.url;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let shown = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total && received / total - shown > 0.02) {
        shown = received / total;
        setProgress(id, shown);
      }
    }
    const type = res.headers.get("Content-Type") ?? "audio/mp4";
    const blob = new Blob(chunks, { type });
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(url, new Response(blob, { headers: { "Content-Type": type, "Content-Length": String(blob.size) } }));
    const art = [t.artwork_url, t.artwork_thumb_url].filter((u): u is string => !!u);
    await Promise.all(art.map((u) => cache.add(u).catch(() => {})));
    setEntries((e) => ({
      ...e,
      [id]: { id, url, art, bytes: blob.size, title: t.title, artists: t.artists, at: Date.now() },
    }));
  } catch (err) {
    toast(`Download failed: ${track.title}`);
    console.warn("download", track.id, err);
  } finally {
    setProgress(id, null);
  }
}

export async function downloadTracks(tracks: Track[]) {
  if (!offlineSupported()) return toast("Downloads unavailable in this browser");
  const { entries, progress } = useOffline.getState();
  const todo = tracks.filter((t) => !entries[t.id] && progress[t.id] === undefined && (t.audio || t.source));
  if (!todo.length) return;
  void navigator.storage?.persist?.();
  todo.forEach((t) => setProgress(t.id, 0));
  if (todo.length > 1) toast(`Downloading ${todo.length} songs`);
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let t = queue.shift(); t; t = queue.shift()) await downloadOne(t);
    }),
  );
  void refreshUsage();
}

export async function removeDownload(id: string) {
  const entry = useOffline.getState().entries[id];
  if (!entry) return;
  setEntries((e) => {
    delete e[id];
    return e;
  });
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.delete(entry.url);
  const stillUsed = new Set(Object.values(useOffline.getState().entries).flatMap((e) => e.art));
  await Promise.all(entry.art.filter((u) => !stillUsed.has(u)).map((u) => cache.delete(u)));
  void refreshUsage();
}

export async function removeAllDownloads() {
  setEntries(() => ({}));
  await caches.delete(OFFLINE_CACHE);
  void refreshUsage();
}

export type OfflineStatus = "offline" | "downloading" | "online";

export function useOfflineStatus(id: string): OfflineStatus {
  return useOffline((s) => (s.entries[id] ? "offline" : s.progress[id] !== undefined ? "downloading" : "online"));
}
