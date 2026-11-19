"use client";

import { useQuery } from "@tanstack/react-query";

import { request } from "./api";
import { playEffect } from "./effects";
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

export type ChatData = {
  track_id?: string;
  track?: CardTrack;
  start_ms?: number;
  note?: string;
  lines?: LyricLine[];
  clip_id?: string;
  duration_ms?: number;
  peaks?: number[];
  photo_id?: string;
  width?: number;
  height?: number;
  sticker?: string;
  sticker_id?: string;
  mood?: string;
  week?: string;
  pick_by?: string;
  local_url?: string;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_key: string;
  kind: "text" | "song" | "lyric" | "swap" | "session" | "voice" | "photo" | "sticker";
  body: string;
  data?: ChatData;
  reply_to: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  reactions: { user_id: string; emoji: string }[];
  pinned_at?: string | null;
  pinned_by?: string | null;
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
  playing?: { track_id: string; title: string; artists: string[]; artwork_thumb_url: string | null; position_ms: number; device: string; at: string } | null;
};
export type Lamp = { from: string; to: string; on_until: string; sent_at: string };
export type Presence = { people: Person[]; lamps: Lamp[]; unread: number };

export type Swap = { week: string; user_id: string; track: Track | null; note: string; updated_at: string; reaction: string };
export type Swaps = { week: string; reveal_at: string; current: Swap[]; history: Swap[] };

type ChatState = { messages: ChatMessage[]; reads: ChatRead[]; hasMore: boolean; hasNewer?: boolean };

export type UploadedSticker = { id: string; name: string; mime: string; position: number; url: string };

export type ConversationMember = { id: string; username: string; display_name: string; avatar?: unknown; role: "owner" | "member" };

export type Conversation = {
  id: string;
  kind: "direct" | "group";
  partner: boolean;
  title: string;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
  members: ConversationMember[];
  accepted: boolean;
  role: "owner" | "member";
  unread: number;
  last?: ChatMessage;
};

export const socialKeys = {
  chatAll: ["chat"] as const,
  chat: (conv: string) => ["chat", conv] as const,
  presence: ["presence"] as const,
  swaps: ["swaps"] as const,
  pins: (conv: string) => ["chat", conv, "pins"] as const,
  stickers: ["chat-stickers"] as const,
  effects: ["chat-effects"] as const,
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversations", id] as const,
};

const conv = (id: string) => `/api/conversations/${id}`;

export const conversationApi = {
  list: async () => (await request<{ conversations: Conversation[] }>("/api/conversations")).conversations,
  get: (id: string) => request<Conversation>(conv(id)),
  open: (body: { user_id: string } | { title: string; members: string[] }) =>
    request<{ id: string }>("/api/conversations", { method: "POST", body: JSON.stringify(body) }),
  rename: (id: string, title: string) => request<null>(conv(id), { method: "PATCH", body: JSON.stringify({ title }) }),
  remove: (id: string) => request<null>(conv(id), { method: "DELETE" }),
  accept: (id: string) => request<null>(`${conv(id)}/accept`, { method: "POST" }),
  addMembers: (id: string, userIds: string[]) => request<null>(`${conv(id)}/members`, { method: "POST", body: JSON.stringify({ user_ids: userIds }) }),
  removeMember: (id: string, user: string) => request<null>(`${conv(id)}/members/${user}`, { method: "DELETE" }),
};

export const useConversations = () => useQuery({ queryKey: socialKeys.conversations, queryFn: conversationApi.list, staleTime: 30_000 });
export const useConversation = (id: string | null) =>
  useQuery({ queryKey: socialKeys.conversation(id ?? ""), queryFn: () => conversationApi.get(id!), enabled: !!id, staleTime: 30_000 });

export async function partnerConversation(): Promise<string | null> {
  const list = await queryClient.fetchQuery({ queryKey: socialKeys.conversations, queryFn: conversationApi.list, staleTime: 30_000 });
  return list.find((c) => c.partner)?.id ?? null;
}

export function conversationName(c: Pick<Conversation, "kind" | "title" | "members">, me: string | undefined): string {
  if (c.kind === "group") return c.title || c.members.filter((m) => m.id !== me).map((m) => m.display_name).join(", ") || "Group";
  return c.members.find((m) => m.id !== me)?.display_name ?? "Chat";
}

export const socialApi = {
  presence: () => request<Presence>("/api/presence"),
  messages: (c: string, q: string) => request<{ messages: ChatMessage[]; reads: ChatRead[] }>(`${conv(c)}/messages${q}`),
  send: (c: string, body: { client_key: string; kind: string; body?: string; data?: unknown; reply_to?: string | null }) =>
    request<ChatMessage>(`${conv(c)}/messages`, { method: "POST", body: JSON.stringify(body) }),
  edit: (id: string, body: string) => request<ChatMessage>(`/api/chat/messages/${id}`, { method: "PATCH", body: JSON.stringify({ body }) }),
  remove: (id: string) => request<ChatMessage>(`/api/chat/messages/${id}`, { method: "DELETE" }),
  react: (id: string, emoji: string) =>
    emoji
      ? request<ChatMessage>(`/api/chat/messages/${id}/reaction`, { method: "PUT", body: JSON.stringify({ emoji }) })
      : request<ChatMessage>(`/api/chat/messages/${id}/reaction`, { method: "DELETE" }),
  read: (c: string, messageId: string) => request<null>(`${conv(c)}/read`, { method: "POST", body: JSON.stringify({ message_id: messageId }) }),
  quiet: (on: boolean) => request<{ on: boolean }>("/api/quiet", { method: "PUT", body: JSON.stringify({ on }) }),
  lamp: (on: boolean) => request<unknown>("/api/signals/lamp", { method: "POST", body: JSON.stringify({ on }) }),
  pin: (id: string, on: boolean) => request<ChatMessage>(`/api/chat/messages/${id}/pin`, { method: on ? "PUT" : "DELETE" }),
  pins: (c: string) => request<{ messages: ChatMessage[] }>(`${conv(c)}/pins`),
  search: (c: string, q: string) => request<{ messages: ChatMessage[] }>(`${conv(c)}/search?q=${encodeURIComponent(q)}`),
  stickers: () => request<{ stickers: UploadedSticker[] }>("/api/chat/stickers"),
  effects: () => request<{ effects: Record<string, string> }>("/api/chat/effects"),
  reactSwap: (week: string, user: string, emoji: string) =>
    request<null>(`/api/swaps/${week}/${user}/reaction`, { method: "PUT", body: JSON.stringify({ emoji }) }),
  replySwap: (week: string, user: string, body: string) =>
    request<ChatMessage>(`/api/swaps/${week}/${user}/reply`, { method: "POST", body: JSON.stringify({ client_key: crypto.randomUUID(), body }) }),
  swaps: () => request<Swaps>("/api/swaps"),
  setSwap: (trackId: string, note: string) => request<null>("/api/swaps/current", { method: "PUT", body: JSON.stringify({ track_id: trackId, note }) }),
  pushKey: () => request<{ key: string }>("/api/push/key"),
  subscribe: (sub: PushSubscriptionJSON) => request<null>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
};

export const usePresence = () => useQuery({ queryKey: socialKeys.presence, queryFn: socialApi.presence, staleTime: 60_000 });
export const useSwaps = () => useQuery({ queryKey: socialKeys.swaps, queryFn: socialApi.swaps, staleTime: 60_000 });
export const usePins = (c: string) => useQuery({ queryKey: socialKeys.pins(c), queryFn: async () => (await socialApi.pins(c)).messages, staleTime: 60_000 });
export const useUploadedStickers = () =>
  useQuery({ queryKey: socialKeys.stickers, queryFn: async () => (await socialApi.stickers()).stickers, staleTime: 10 * 60_000 });
export const useChatEffects = () => useQuery({ queryKey: socialKeys.effects, queryFn: async () => (await socialApi.effects()).effects, staleTime: 10 * 60_000 });

const OUTBOX = "jobbos.chat.outbox";
type Outgoing = {
  conversation_id: string;
  client_key: string;
  kind: "text" | "song" | "lyric" | "voice" | "photo" | "sticker";
  body: string;
  data?: unknown;
  reply_to: string | null;
  created_at: string;
};

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

function merge(state: ChatState | undefined, incoming: ChatMessage[]): ChatState {
  const base = state ?? { messages: [], reads: [], hasMore: true };
  const byKey = new Map(base.messages.map((m) => [m.id, m]));
  for (const m of incoming) {
    for (const [k, v] of byKey) if (v.status && v.client_key === m.client_key && v.sender_id === m.sender_id) byKey.delete(k);
    byKey.set(m.id, m);
  }
  const messages = [...byKey.values()].sort(sortAsc);
  return { ...base, messages };
}

function localMessage(o: Outgoing, me: string, status: "sending" | "failed"): ChatMessage {
  return {
    id: `local-${o.client_key}`, conversation_id: o.conversation_id, sender_id: me, client_key: o.client_key, kind: o.kind, body: o.body,
    data: o.data as ChatData | undefined, reply_to: o.reply_to, created_at: o.created_at, edited_at: null, deleted: false, reactions: [], status,
  };
}

export async function loadChat(c: string): Promise<ChatState> {
  const page = await socialApi.messages(c, "?limit=50");
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  const pending = readOutbox().filter((o) => o.conversation_id === c).map((o) => localMessage(o, me, "sending"));
  return { messages: [...page.messages, ...pending].sort(sortAsc), reads: page.reads, hasMore: page.messages.length === 50 };
}

export async function jumpTo(c: string, id: string) {
  const state = queryClient.getQueryData<ChatState>(socialKeys.chat(c));
  if (state?.messages.some((m) => m.id === id)) return;
  const page = await socialApi.messages(c, `?limit=50&around=${id}`);
  const at = page.messages.findIndex((m) => m.id === id);
  queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => ({
    messages: page.messages,
    reads: page.reads,
    hasMore: at >= 25,
    hasNewer: page.messages.length - at >= 25,
  }));
}

export async function loadNewer(c: string) {
  const state = queryClient.getQueryData<ChatState>(socialKeys.chat(c));
  const newest = state && [...state.messages].reverse().find((m) => !m.status);
  if (!state?.hasNewer || !newest) return;
  const page = await socialApi.messages(c, `?limit=50&after=${newest.id}`);
  queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => ({ ...merge(s, page.messages), hasNewer: page.messages.length === 50 }));
}

export const showLatest = (c: string) => queryClient.resetQueries({ queryKey: socialKeys.chat(c), exact: true });

export async function loadOlder(c: string) {
  const state = queryClient.getQueryData<ChatState>(socialKeys.chat(c));
  const oldest = state?.messages.find((m) => !m.status);
  if (!oldest) return;
  const page = await socialApi.messages(c, `?limit=50&before=${oldest.id}`);
  queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => ({ ...merge(s, page.messages), hasMore: page.messages.length === 50 }));
}

function loadedChats(): string[] {
  return queryClient
    .getQueriesData<ChatState>({ queryKey: socialKeys.chatAll })
    .filter(([key, data]) => key.length === 2 && !!data)
    .map(([key]) => String(key[1]));
}

async function catchUp() {
  void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
  for (const c of loadedChats()) {
    const state = queryClient.getQueryData<ChatState>(socialKeys.chat(c));
    if (!state || state.hasNewer) continue;
    const newest = [...state.messages].reverse().find((m) => !m.status);
    if (!newest) {
      void queryClient.invalidateQueries({ queryKey: socialKeys.chat(c), exact: true });
      continue;
    }
    try {
      const page = await socialApi.messages(c, `?limit=200&after=${newest.id}`);
      queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => ({ ...merge(s, page.messages), reads: page.reads }));
    } catch {
    }
  }
}

let flushing = false;

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    for (const o of readOutbox()) {
      try {
        if (!o.conversation_id) {
          o.conversation_id = (await partnerConversation()) ?? "";
          if (!o.conversation_id) throw Object.assign(new Error("no chat"), { status: 400 });
        }
        const { conversation_id: c, ...body } = o;
        const m = await socialApi.send(c, body);
        writeOutbox(readOutbox().filter((x) => x.client_key !== o.client_key));
        queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => merge(s, [m]));
      } catch (err) {
        const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
        queryClient.setQueryData<ChatState>(socialKeys.chat(o.conversation_id), (s) => merge(s, [localMessage(o, me, "failed")]));
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

export function sendMessage(
  c: string, kind: Outgoing["kind"], body: string, data?: unknown, replyTo: string | null = null, clientKey: string = crypto.randomUUID(),
) {
  const o: Outgoing = { conversation_id: c, client_key: clientKey, kind, body, data, reply_to: replyTo, created_at: new Date().toISOString() };
  writeOutbox([...readOutbox(), o]);
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => merge(s, [localMessage(o, me, "sending")]));
  void flushOutbox();
}

const uploadRetries = new Map<string, () => void>();

export function sendUpload(
  c: string, kind: "photo" | "voice", preview: Partial<ChatData>, upload: () => Promise<ChatData>, body = "", replyTo: string | null = null,
) {
  const key = crypto.randomUUID();
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  const created = new Date().toISOString();
  const local = (status: "sending" | "failed"): ChatMessage => ({
    ...localMessage({ conversation_id: c, client_key: key, kind, body, data: preview, reply_to: replyTo, created_at: created }, me, status),
  });
  const run = async () => {
    queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => merge(s, [local("sending")]));
    try {
      const data = await upload();
      uploadRetries.delete(key);
      sendMessage(c, kind, body, data, replyTo, key);
    } catch {
      queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) => merge(s, [local("failed")]));
      toast(kind === "photo" ? "Photo not sent" : "Voice note not sent");
    }
  };
  uploadRetries.set(key, () => void run());
  void run();
}

export function retryMessage(c: string, clientKey: string) {
  const again = uploadRetries.get(clientKey);
  if (again) return again();
  const me = queryClient.getQueryData<{ id: string }>(["me"])?.id ?? "";
  queryClient.setQueryData<ChatState>(socialKeys.chat(c), (s) =>
    s ? { ...s, messages: s.messages.map((m) => (m.client_key === clientKey && m.sender_id === me ? { ...m, status: "sending" } : m)) } : s,
  );
  void flushOutbox();
}

export const shareSong = (c: string, track: Pick<Track, "id">, opts: { startMs?: number; note?: string; mood?: string } = {}) =>
  sendMessage(c, "song", "", { track_id: track.id, start_ms: opts.startMs, note: opts.note || undefined, mood: opts.mood });

export const shareLyrics = (c: string, track: Track, lines: { text: string; ms: number | null }[]) =>
  sendMessage(c, "lyric", "", { track_id: track.id, lines });

export async function shareSongWithPartner(track: Track, opts: { startMs?: number; note?: string; mood?: string } = {}): Promise<boolean> {
  const c = await partnerConversation();
  if (!c) return false;
  shareSong(c, track, opts);
  return true;
}

export const useChat = (c: string | null) =>
  useQuery({ queryKey: socialKeys.chat(c ?? ""), queryFn: () => loadChat(c!), enabled: !!c, staleTime: Infinity });

export const typing = { conv: "" as string, user: "" as string, until: 0, listeners: new Set<() => void>() };

let lastTypingSent = 0;
export function notifyTyping(c: string) {
  const now = Date.now();
  if (now - lastTypingSent < 3000) return;
  lastTypingSent = now;
  send("chat.typing", { conversation_id: c });
}

let wired = false;

export function startSocial(meId: () => string, nameOf: (id: string) => string) {
  if (wired) return;
  wired = true;
  const refreshList = () => void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
  on<ChatMessage>("chat.message", (e) => {
    queryClient.setQueryData<ChatState>(socialKeys.chat(e.data.conversation_id), (s) => (s && !s.hasNewer ? merge(s, [e.data]) : s));
    if (e.data.sender_id !== meId()) {
      queryClient.setQueryData<Presence>(socialKeys.presence, (p) => (p ? { ...p, unread: p.unread + 1 } : p));
      if (typing.user === e.data.sender_id && typing.conv === e.data.conversation_id) {
        typing.until = 0;
        typing.listeners.forEach((fn) => fn());
      }
    }
    refreshList();
  });
  on<ChatMessage>("chat.updated", (e) => {
    queryClient.setQueryData<ChatState>(socialKeys.chat(e.data.conversation_id), (s) =>
      s && s.messages.some((m) => m.id === e.data.id) ? merge(s, [e.data]) : s,
    );
    void queryClient.invalidateQueries({ queryKey: socialKeys.pins(e.data.conversation_id) });
  });
  on<{ id: string; deleted?: boolean }>("conversation.update", (e) => {
    refreshList();
    void queryClient.invalidateQueries({ queryKey: socialKeys.conversation(e.data.id) });
  });
  on("chat.stickers", () => void queryClient.invalidateQueries({ queryKey: socialKeys.stickers }));
  on("chat.effects", () => void queryClient.invalidateQueries({ queryKey: socialKeys.effects }));
  on<ChatRead & { conversation_id: string }>("chat.read", (e) => {
    queryClient.setQueryData<ChatState>(socialKeys.chat(e.data.conversation_id), (s) =>
      s ? { ...s, reads: [...s.reads.filter((r) => r.user_id !== e.data.user_id), e.data] } : s,
    );
    if (e.data.user_id === meId()) refreshList();
  });
  on<{ user: string; conversation_id?: string }>("chat.typing", (e) => {
    typing.conv = e.data.conversation_id ?? "";
    typing.user = e.data.user;
    typing.until = Date.now() + 5000;
    typing.listeners.forEach((fn) => fn());
  });
  const refreshPresence = () => void queryClient.invalidateQueries({ queryKey: socialKeys.presence });
  on("presence.update", refreshPresence);
  on("quiet.update", refreshPresence);
  on("visibility.update", () => {
    refreshPresence();
    void queryClient.invalidateQueries({ queryKey: socialKeys.chatAll });
  });
  on<{ from: string; to?: string; on: boolean; name?: string }>("signal.lamp", (e) => {
    refreshPresence();
    if (e.data.on && e.data.to === meId()) {
      toast(`${e.data.name ?? nameOf(e.data.from)} is thinking of you`);
      playEffect("hearts");
    }
  });
  on("swap.update", () => void queryClient.invalidateQueries({ queryKey: socialKeys.swaps }));
  on("realtime.open", () => {
    refreshPresence();
    void catchUp();
    void flushOutbox();
  });
  window.addEventListener("online", () => void flushOutbox());
}
