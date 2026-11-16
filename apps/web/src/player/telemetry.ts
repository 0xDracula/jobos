import { api } from "@/lib/api";
import { deviceId, knownDeviceId } from "@/lib/device";
import type { ListeningEvent, ListeningEventKind } from "@/lib/types";

import { usePlayer } from "./store";

const MAX_BATCH = 200;
const MAX_KEPT = 1000;
const buffer: ListeningEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function record(
  event: ListeningEventKind,
  trackId: string,
  positionSeconds: number | null,
  extra?: Record<string, unknown>,
): void {
  const ctx = usePlayer.getState().context;
  buffer.push({
    device_id: knownDeviceId(),
    track_id: trackId,
    event,
    position_ms: positionSeconds == null || !Number.isFinite(positionSeconds) ? null : Math.max(0, Math.round(positionSeconds * 1000)),
    context: { ...(ctx ? { type: ctx.type, id: ctx.id ?? null } : {}), ...extra },
    at: new Date().toISOString(),
  });
  if (buffer.length > MAX_KEPT) buffer.splice(0, buffer.length - MAX_KEPT);
  if (buffer.length >= 20) void flush();
  else timer ??= setTimeout(() => void flush(), 30_000);
}

export async function flush(leaving = false): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!buffer.length) return;
  if (leaving) {
    const id = knownDeviceId();
    const events = buffer.slice(0, MAX_BATCH).map((e) => ({ ...e, device_id: e.device_id ?? id }));
    const body = new Blob([JSON.stringify({ events })], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/events", body)) buffer.splice(0, events.length);
    return;
  }
  const events = buffer.splice(0, MAX_BATCH);
  try {
    const id = await deviceId();
    await api.events(events.map((e) => ({ ...e, device_id: e.device_id ?? id })));
  } catch {
    buffer.unshift(...events);
    timer ??= setTimeout(() => void flush(), 60_000);
  }
}
