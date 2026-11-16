"use client";

export type RealtimeEvent<T = unknown> = { type: string; id?: string; ts: number; data: T };

type Listener = (e: RealtimeEvent) => void;

const listeners = new Map<string, Set<Listener>>();
let ws: WebSocket | null = null;
let started = false;
let backoff = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const statusListeners = new Set<(connected: boolean) => void>();

export const clock = { offset: 0, rtt: Infinity, samples: [] as { offset: number; rtt: number }[] };
export const serverNow = () => Date.now() + clock.offset;

function socketURL(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const { protocol, host, port, hostname } = window.location;
  if (process.env.NODE_ENV === "development" && port !== "8080") return `ws://${hostname}:8080/api/ws`;
  return `${protocol === "https:" ? "wss" : "ws"}://${host}/api/ws`;
}

export function send(type: string, data?: unknown) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type, id: crypto.randomUUID(), ts: Date.now(), data }));
  return true;
}

export function on<T = unknown>(type: string, fn: (e: RealtimeEvent<T>) => void): () => void {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn as Listener);
  return () => set!.delete(fn as Listener);
}

export function onStatus(fn: (connected: boolean) => void): () => void {
  statusListeners.add(fn);
  fn(ws?.readyState === WebSocket.OPEN);
  return () => statusListeners.delete(fn);
}

export const connected = () => ws?.readyState === WebSocket.OPEN;

function emit(e: RealtimeEvent) {
  listeners.get(e.type)?.forEach((fn) => fn(e));
  listeners.get("*")?.forEach((fn) => fn(e));
}

const visible = () => document.visibilityState === "visible";
const beat = () => send("presence.heartbeat", { visible: visible() });

function ping() {
  send("clock.ping", { t0: Date.now() });
}

function onPong(e: RealtimeEvent<{ t0: number; server_ts: number }>) {
  const t1 = Date.now();
  const rtt = t1 - e.data.t0;
  const offset = e.data.server_ts - (e.data.t0 + t1) / 2;
  clock.samples = [...clock.samples.slice(-7), { offset, rtt }];
  const best = clock.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  clock.offset = best.offset;
  clock.rtt = best.rtt;
}

function connect() {
  try {
    ws = new WebSocket(socketURL());
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    backoff = 1000;
    beat();
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
    statusListeners.forEach((fn) => fn(true));
    emit({ type: "realtime.open", ts: Date.now(), data: null });
  };
  ws.onmessage = (m) => {
    try {
      emit(JSON.parse(m.data as string) as RealtimeEvent);
    } catch {
    }
  };
  ws.onclose = () => {
    statusListeners.forEach((fn) => fn(false));
    scheduleReconnect();
  };
  ws.onerror = () => ws?.close();
}

function scheduleReconnect() {
  ws = null;
  if (reconnectTimer) return;
  const wait = backoff + Math.random() * 400;
  backoff = Math.min(30_000, backoff * 2);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, wait);
}

export function startRealtime() {
  if (started || typeof window === "undefined") return;
  started = true;
  on("clock.pong", onPong as Listener);
  connect();
  heartbeat = setInterval(beat, 20_000);
  clockTimer = setInterval(ping, 30_000);
  document.addEventListener("visibilitychange", beat);
  window.addEventListener("online", () => {
    if (!ws && reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      backoff = 1000;
      connect();
    }
  });
  void heartbeat;
  void clockTimer;
}
