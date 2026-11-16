"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "./api";
import { queryClient } from "./queries";
import { on, send } from "./realtime";
import { toast } from "./toast";
import type { Track } from "./types";

export type CardTrack = Pick<Track, "id" | "title" | "artists"> & {
  artwork_url: string | null;
  artwork_thumb_url: string | null;
  duration_ms: number | null;
};

export type LyricLine = { text: string; ms: number | null };

export type ChatData = { track_id: string; track: CardTrack; start_ms?: number; note?: string; lines?: LyricLine[] };

export type ChatMessage = {
  id: string;
  sender_id: string;
  client_key: string;
  kind: "text" | "song" | "lyric" | "swap";
  body: string;
  data?: ChatData;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  reactions: { user_id: string; emoji: string }[];
  status?: "sending" | "failed";
};

export type ChatRead = { user_id: string; message_id: string | null; read_at: string };

export type Person = {
  id: string;
  display_name: string;
  online: boolean | null;
  last_seen: string | null;
  quiet: boolean;
  listening?: boolean | null;
};
export type Lamp = { from: string; to: string; on_until: string; sent_at: string };
export type Presence = { people: Person[]; lamps: Lamp[]; unread: number };

export type Swap = { week: string; user_id: string; track: Track | null; note: string; updated_at: string };
export type Swaps = { week: string; reveal_at: string; current: Swap[]; history: Swap[] };

type ChatState = { messages: ChatMessage[]; reads: ChatRead[]; hasMore: boolean };

export const socialKeys = { chat: ["chat"] as const, presence: ["presence"] as const, swaps: ["swaps"] as const };

export const socialApi = {
  presence: () => request<Presence>("/api/presence"),
  messages: (q: string) => request<{ messages: ChatMessage[]; reads: ChatRead[] }>(`/api/chat/messages${q}`),
  send: (body: { client_key: string; kind: string; body?: string; data?: unknown; reply_to?: string | null }) =>
    request<ChatMessage>("/api/chat/messages", { method: "POST", body: JSON.stringify(body) }),
  edit: (id: string, body: string) => request<ChatMessage>(`/api/chat/messages/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  remove: (id: string) => request<ChatMessage>(`/api/chat/messages/${id}`, { method: "DELETE" }),
  react: (id: string, emoji: string) =>
    emoji
      ? request<ChatMessage>(`/api/chat/messages/${id}/reaction`, { method: "PUT", body: JSON.stringify({ emoji }) })
      : request<ChatMessage>(`/api/chat/messages/${id}/reaction`, { method: "DELETE" }),
  read: (messageId: string) => request<null>("/api/chat/read", { method: "POST", body: JSON.stringify({ message_id: messageId }) }),
  quiet: (on: boolean) => request<{ on: boolean }>("/api/quiet", { method: "PUT", body: JSON.stringify({ on }) }),
  lamp: (on: boolean) => request<unknown>("/api/signals/lamp", { method: "POST", body: JSON.stringify({ on }) }),
  swaps: () => request<Swaps>("/api/swaps"),
  setSwap: (trackId: string, note: string) => request<null>("/api/swaps/current", { method: "PUT", body: JSON.stringify({ track_id: trackId, note }) }),
  pushKey: () => request<{ key: string }>("/api/push/key"),
  subscribe: (sub: PushSubscriptionJSON) => request<null>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
};

export const usePresence = () => useQuery({ queryKey: socialKeys.presence, queryFn: socialApi.presence, staleTime: 60_000 });
export const useSwaps = () => useQuery({ queryKey: socialKeys.swaps, queryFn: socialApi.swaps, staleTime: 60_000 });

const OUTBOX = "jobbos.chat.outbox";
type Outgoing = { client_key: string; kind: "text" | "song" | "lyric"; body: string; data?: unknown; reply_to: string | null; created_at: string };

function readOutbox(): Outgoing[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? "[]");
  } catch {
    return [];
  }
}
function writeOutbox(items: Outgoing[]) {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(items));
  } catch {
  }
}

const sortAsc = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

function merge(state: ChatState | undefined, incoming: ChatMessage[], position: "append" | "prepend" = "append"): ChatState {
  const base = state ?? { messages: [], reads: [], hasMore: true };
  const byKey = new Map(base.messages.map((m) => [m.id, m]));
  for (const m of incoming) {
    for (const [k, v] of byKey) if (v.status && v.client_key === m.client_key && v.sender_id === m.sender_id) byKey.delete(k);
    byKey.set(m.id, m);
  }
  const messages = [...byKey.values()].sort(sortAsc);
  return { ...base, messages, hasMore: position === "prepend" ? base.hasMore : base.hasMore };
}

function localMessage(o: Outgoing, me: string, status: "sending" | "failed"): ChatMessage {
  return {
    id: `local-${o.client_key}`, sender_id: me, client_key: o.client_key, kind: o.kind, body: o.body,
    data: o.data as ChatData | undefined, reply_to: o.reply_to, created_at: o.created_at, edited_at: null, deleted: false, reactions: [], status,
  };
}

export async function loadChat(): Promise<ChatState> {
  const page = await socialApi.messages("?limit=50");
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  const pending = readOutbox().map((o) => localMessage(o, me, "sending"));
  return { messages: [...page.messages, ...pending].sort(sortAsc), reads: page.reads, hasMore: page.messages.length === 50 };
}

export async function loadOlder() {
  const state = queryClient.getQueryData<ChatState>(socialKeys.chat);
  const oldest = state?.messages.find((m) => !m.status);
  if (!oldest) return;
  const page = await socialApi.messages(`?limit=50&before=${oldest.id}`);
  queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => ({ ...merge(s, page.messages, "prepend"), hasMore: page.messages.length === 50 }));
}

async function catchUp() {
  const state = queryClient.getQueryData<ChatState>(socialKeys.chat);
  if (!state) return;
  const newest = [...state.messages].reverse().find((m) => !m.status);
  if (!newest) return void queryClient.invalidateQueries({ queryKey: socialKeys.chat });
  const page = await socialApi.messages(`?limit=200&after=${newest.id}`);
  queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => ({ ...merge(s, page.messages), reads: page.reads }));
}

let flushing = false;

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    for (const o of readOutbox()) {
      try {
        const m = await socialApi.send(o);
        writeOutbox(readOutbox().filter((x) => x.client_key !== o.client_key));
        queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => merge(s, [m]));
      } catch (err) {
        const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
        queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => merge(s, [localMessage(o, me, "failed")]));
        if (err instanceof Error && "status" in err && (err as { status: number }).status === 400) {
          writeOutbox(readOutbox().filter((x) => x.client_key !== o.client_key));
        }
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function sendMessage(kind: Outgoing["kind"], body: string, data?: unknown, replyTo: string | null = null) {
  const o: Outgoing = { client_key: crypto.randomUUID(), kind, body, data, reply_to: replyTo, created_at: new Date().toISOString() };
  writeOutbox([...readOutbox(), o]);
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => merge(s, [localMessage(o, me, "sending")]));
  void flushOutbox();
}

export function retryMessage(clientKey: string) {
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  queryClient.setQueryData<ChatState>(socialKeys.chat, (s) =>
    s ? { ...s, messages: s.messages.map((m) => (m.client_key === clientKey && m.sender_id === me ? { ...m, status: "sending" } : m)) } : s,
  );
  void flushOutbox();
}

export const shareSong = (track: Track, opts: { startMs?: number; note?: string } = {}) =>
  sendMessage("song", "", { track_id: track.id, start_ms: opts.startMs, note: opts.note || undefined });

export const shareLyrics = (track: Track, lines: { text: string; ms: number | null }[]) => sendMessage("lyric", "", { track_id: track.id, lines });

export const useChat = () => useQuery({ queryKey: socialKeys.chat, queryFn: loadChat, staleTime: Infinity });

export const typing = { user: "" as string, until: 0, listeners: new Set<() => void>() };

let lastTypingSent = 0;
export function notifyTyping() {
  const now = Date.now();
  if (now - lastTypingSent < 3000) return;
  lastTypingSent = now;
  send("chat.typing");
}

let wired = false;

export function startSocial(meId: () => string, nameOf: (id: string) => string) {
  if (wired) return;
  wired = true;
  on<ChatMessage>("chat.message", (e) => {
    queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => (s ? merge(s, [e.data]) : s));
    if (e.data.sender_id !== meId()) {
      queryClient.setQueryData<Presence>(socialKeys.presence, (p) => (p ? { ...p, unread: p.unread + 1 } : p));
      if (typing.user === e.data.sender_id) {
        typing.until = 0;
        typing.listeners.forEach((fn) => fn());
      }
    }
  });
  on<ChatMessage>("chat.updated", (e) => queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => (s ? merge(s, [e.data]) : s)));
  on<ChatRead>("chat.read", (e) =>
    queryClient.setQueryData<ChatState>(socialKeys.chat, (s) => (s ? { ...s, reads: [...s.reads.filter((r) => r.user_id !== e.data.user_id), e.data] } : s)),
  );
  on<{ user: string }>("chat.typing", (e) => {
    typing.user = e.data.user;
    typing.until = Date.now() + 5000;
    typing.listeners.forEach((fn) => fn());
  });
  const refreshPresence = () => void queryClient.invalidateQueries({ queryKey: socialKeys.presence });
  on("presence.update", refreshPresence);
  on("quiet.update", refreshPresence);
  on("visibility.update", () => {
    refreshPresence();
    void queryClient.invalidateQueries({ queryKey: socialKeys.chat });
  });
  on<{ from: string; to?: string; on: boolean; name?: string }>("signal.lamp", (e) => {
    refreshPresence();
    if (e.data.on && e.data.to === meId()) toast(`${e.data.name ?? nameOf(e.data.from)} is thinking of you`);
  });
  on("swap.update", () => void queryClient.invalidateQueries({ queryKey: socialKeys.swaps }));
  on("realtime.open", () => {
    refreshPresence();
    void catchUp();
    void flushOutbox();
  });
  window.addEventListener("online", () => void flushOutbox());
}
