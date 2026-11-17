"use client";

import { BellOff, Check, CheckCheck, Clock, Lamp, Music2, Pencil, Play, Reply, RotateCcw, Send, Smile, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/avatar";
import { SwapSheet } from "@/components/SwapSheet";
import { Artwork } from "@/components/media";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { keys, queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import {
  loadOlder, notifyTyping, retryMessage, sendMessage, socialApi, socialKeys, typing, useChat, usePresence,
  type ChatMessage,
} from "@/lib/social";
import { toast } from "@/lib/toast";
import { playTracks, seek } from "@/player/controls";

const QUICK = ["❤️", "😂", "😮", "😢", "🔥", "👍"];

async function playCard(id: string, ms?: number | null) {
  try {
    const t = await queryClient.query({ queryKey: keys.track(id), queryFn: () => api.track(id), staleTime: 60_000 });
    playTracks([t], 0, { type: "queue", name: "Chat" });
    if (ms && ms > 0) setTimeout(() => seek(ms / 1000), 350);
  } catch {
    toast("Song unavailable");
  }
}

function lastSeenText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  return `Last seen ${sameDay ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " "}${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function SongCard({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const d = m.data!;
  return (
    <div className="flex items-center gap-3">
      <Artwork src={d.track.artwork_thumb_url ?? d.track.artwork_url} className="size-14 shrink-0 rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate font-bold">{d.track.title}</p>
        <p dir="auto" className="truncate text-sm opacity-75">{d.track.artists.join(", ")}</p>
        {d.start_ms ? <p className="text-xs font-bold opacity-75">From {fmtTime(d.start_ms / 1000)}</p> : null}
      </div>
      <IconButton label={`Play ${d.track.title}`} onClick={() => playCard(d.track_id, d.start_ms)} className={cn("bg-surface-solid/80", mine && "bg-white/60")}>
        <Play />
      </IconButton>
    </div>
  );
}

function LyricCard({ m }: { m: ChatMessage }) {
  const d = m.data!;
  const first = d.lines?.find((l) => l.ms != null)?.ms ?? null;
  return (
    <button type="button" onClick={() => playCard(d.track_id, first)} className="grid w-full gap-2 text-start" aria-label={`Play ${d.track.title} from these lines`}>
      <div className="grid gap-1 font-hand text-[22px] leading-snug">
        {d.lines?.map((l, i) => (
          <p key={i} dir="auto">
            {l.text}
          </p>
        ))}
      </div>
      <p dir="auto" className="flex items-center gap-1.5 truncate text-sm font-bold opacity-75">
        <Music2 className="size-3.5 shrink-0" /> {d.track.title} · {d.track.artists.join(", ")}
      </p>
    </button>
  );
}

function Bubble({
  m, mine, replyTo, nameOf, onReply, onEdit, me,
}: {
  m: ChatMessage;
  mine: boolean;
  replyTo: ChatMessage | undefined;
  nameOf: (id: string) => string;
  onReply: () => void;
  onEdit: () => void;
  me: string;
}) {
  const card = m.kind === "song" || m.kind === "lyric";
  const myReaction = m.reactions.find((r) => r.user_id === me)?.emoji ?? "";
  const react = (emoji: string) => socialApi.react(m.id, emoji === myReaction ? "" : emoji).catch(() => toast("Reaction not saved"));
  return (
    <div className={cn("group flex max-w-[85%] flex-col gap-1", mine ? "items-end self-end" : "items-start self-start")}>
      <div
        className={cn(
          "relative rounded-[20px] px-4 py-2.5 shadow-[0_2px_10px_rgba(59,47,63,0.08)]",
          mine ? "rounded-br-[6px] bg-accent-soft text-ink" : "rounded-bl-[6px] bg-surface-solid text-ink",
          card && "min-w-[240px]",
          m.status === "sending" && "opacity-60",
        )}
      >
        {replyTo && (
          <p dir="auto" className="mb-1.5 line-clamp-2 border-s-2 border-accent-strong/60 ps-2 text-sm opacity-75">
            <span className="font-bold">{nameOf(replyTo.sender_id)}: </span>
            {replyTo.deleted ? "Deleted message" : replyTo.kind === "text" ? replyTo.body : replyTo.data?.track.title}
          </p>
        )}
        {m.deleted ? (
          <p className="italic opacity-60">Deleted message</p>
        ) : m.kind === "song" ? (
          <SongCard m={m} mine={mine} />
        ) : m.kind === "lyric" ? (
          <LyricCard m={m} />
        ) : (
          <p dir="auto" className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">
            {m.body}
          </p>
        )}
        {m.data?.note && !m.deleted && (
          <p dir="auto" className="mt-2 whitespace-pre-wrap border-t border-line pt-2 text-[15px]">
            {m.data.note}
          </p>
        )}
        {!m.deleted && !m.status && (
          <div className={cn("absolute top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", mine ? "-start-10" : "-end-10")}>
            <Menu modal={false}>
              <MenuTrigger aria-label="Message actions" className="grid size-8 place-items-center rounded-full bg-surface-solid text-muted shadow-soft">
                <Smile className="size-4" />
              </MenuTrigger>
              <MenuContent align={mine ? "end" : "start"}>
                <div className="flex gap-1 px-2 py-1">
                  {QUICK.map((e) => (
                    <button
                      key={e}
                      type="button"
                      aria-label={`React ${e}`}
                      onClick={() => react(e)}
                      className={cn("grid size-9 place-items-center rounded-full text-lg hover:bg-accent-soft/60", myReaction === e && "bg-accent-soft")}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <MenuItem icon={<Reply />} onSelect={onReply}>Reply</MenuItem>
                {mine && m.kind === "text" && <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit</MenuItem>}
                {mine && (
                  <MenuItem icon={<Trash2 />} onSelect={() => socialApi.remove(m.id).catch(() => toast("Message not deleted"))}>
                    Delete
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-1 text-xs font-semibold text-muted">
        {m.reactions.length > 0 && (
          <span className="rounded-full bg-surface-solid px-2 py-0.5 shadow-soft" aria-label="Reactions">
            {m.reactions.map((r) => r.emoji).join(" ")}
          </span>
        )}
        {m.status === "failed" ? (
          <button type="button" onClick={() => retryMessage(m.client_key)} className="flex items-center gap-1 font-bold text-danger">
            <RotateCcw className="size-3.5" /> Not sent · Retry
          </button>
        ) : m.status === "sending" ? (
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" /> Sending
          </span>
        ) : (
          <span>
            {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            {m.edited_at && !m.deleted ? " · Edited" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const me = useMe().data;
  const members = useMembers();
  const presence = usePresence();
  const chat = useChat();
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const other = members.data?.find((u) => u.id !== me?.id) ?? null;
  const otherState = presence.data?.people.find((p) => p.id === other?.id);
  const myState = presence.data?.people.find((p) => p.id === me?.id);
  const nameOf = (id: string) => (id === me?.id ? "You" : (members.data?.find((u) => u.id === id)?.display_name ?? "Someone"));
  const messages = useMemo(() => chat.data?.messages ?? [], [chat.data]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    typing.listeners.add(fn);
    const t = setInterval(fn, 1000);
    return () => {
      typing.listeners.delete(fn);
      clearInterval(t);
    };
  }, []);
  const otherTyping = !!other && typing.user === other.id && typing.until > Date.now();

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, otherTyping]);

  useEffect(() => {
    const el = topRef.current;
    if (!el || !chat.data?.hasMore) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      const list = listRef.current;
      const before = list ? list.scrollHeight - list.scrollTop : 0;
      await loadOlder();
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - before;
      });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [chat.data?.hasMore]);

  const newestTheirs = [...messages].reverse().find((m) => m.sender_id !== me?.id && !m.status);
  useEffect(() => {
    if (!newestTheirs || document.visibilityState !== "visible") return;
    socialApi.read(newestTheirs.id).catch(() => {});
    queryClient.setQueryData(socialKeys.presence, (p: { unread: number } | undefined) => (p ? { ...p, unread: 0 } : p));
  }, [newestTheirs?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastMine = [...messages].reverse().find((m) => m.sender_id === me?.id && !m.status);
  const theirRead = chat.data?.reads.find((r) => r.user_id === other?.id);
  const seen = !!lastMine && !!theirRead?.message_id && (byId.get(theirRead.message_id)?.created_at ?? "") >= lastMine.created_at;

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      try {
        await socialApi.edit(editing.id, body);
        setEditing(null);
        setText("");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Message not saved");
      }
      return;
    }
    sendMessage("text", body, undefined, replyTo?.id ?? null);
    setText("");
    setReplyTo(null);
    atBottom.current = true;
  };

  const toggleQuiet = () =>
    socialApi
      .quiet(!myState?.quiet)
      .then(() => queryClient.invalidateQueries({ queryKey: socialKeys.presence }))
      .catch(() => toast("Quiet mode not changed"));

  const lampOn = !!presence.data?.lamps.some((l) => l.from === me?.id);
  const sendLamp = () =>
    socialApi
      .lamp(!lampOn)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: socialKeys.presence });
        if (!lampOn) toast("Lamp switched on in their room");
      })
      .catch((err) => toast(err instanceof ApiError ? err.message : "Lamp not sent"));

  const status = otherState?.online ? "Online" : otherState?.last_seen ? lastSeenText(otherState.last_seen) : "";

  return (
    <div className="-mx-4 -mt-6 flex h-[calc(100dvh-10.5rem-env(safe-area-inset-bottom))] flex-col lg:-mx-10 lg:-mt-10 lg:h-[calc(100dvh-7rem)]">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 lg:px-6">
        {other && (
          <Link href={`/profile/?id=${other.id}`} aria-label={other.display_name} className="shrink-0 rounded-full bg-accent-soft/60">
            <Avatar userId={other.id} size={44} pose={otherState?.listening ? "listening" : "idle"} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="truncate font-display text-xl font-semibold">{other?.display_name ?? "Chat"}</h1>
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-muted">
            {otherState?.online && <span aria-hidden className="size-2 rounded-full bg-sage" />}
            {otherTyping ? "Typing…" : status}
            {otherState?.quiet && (
              <span className="flex items-center gap-1">
                <BellOff className="size-3.5" /> Quiet mode
              </span>
            )}
          </p>
        </div>
        <IconButton label={lampOn ? "Switch off their lamp" : "Thinking of you"} active={lampOn} onClick={sendLamp} disabled={!other}>
          <Lamp />
        </IconButton>
        <IconButton label="Song swap" onClick={() => setSwapOpen(true)}>
          <Music2 />
        </IconButton>
        <IconButton label={myState?.quiet ? "Quiet mode on" : "Quiet mode off"} active={!!myState?.quiet} onClick={toggleQuiet}>
          <BellOff />
        </IconButton>
      </header>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="chat-paper flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 lg:px-6"
      >
        <div ref={topRef} className="h-px shrink-0" />
        {chat.isPending && <p className="m-auto font-semibold text-muted">Loading</p>}
        {!chat.isPending && messages.length === 0 && <p className="m-auto font-semibold text-muted">No messages yet</p>}
        {messages.map((m) => (
          <Bubble
            key={m.id}
            m={m}
            me={me?.id ?? ""}
            mine={m.sender_id === me?.id}
            replyTo={m.reply_to ? byId.get(m.reply_to) : undefined}
            nameOf={nameOf}
            onReply={() => {
              setEditing(null);
              setReplyTo(m);
            }}
            onEdit={() => {
              setReplyTo(null);
              setEditing(m);
              setText(m.body);
            }}
          />
        ))}
        {seen && (
          <p className="-mt-2 flex items-center gap-1 self-end px-1 text-xs font-bold text-muted">
            <CheckCheck className="size-3.5" /> Seen
          </p>
        )}
        {!seen && lastMine && (
          <p className="-mt-2 flex items-center gap-1 self-end px-1 text-xs font-bold text-muted">
            <Check className="size-3.5" /> Sent
          </p>
        )}
        {otherTyping && <p className="self-start rounded-full bg-surface-solid px-4 py-2 text-sm font-bold text-muted shadow-soft">Typing…</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="border-t border-line px-3 py-3 lg:px-6"
      >
        {(replyTo || editing) && (
          <div className="mb-2 flex items-center gap-2 rounded-button bg-surface-solid px-3 py-2 text-sm">
            {editing ? <Pencil className="size-4 shrink-0" /> : <Reply className="size-4 shrink-0" />}
            <p dir="auto" className="min-w-0 flex-1 truncate">
              <span className="font-bold">{editing ? "Editing" : `Reply to ${nameOf(replyTo!.sender_id)}`}: </span>
              {(editing ?? replyTo)!.kind === "text" ? (editing ?? replyTo)!.body : (editing ?? replyTo)!.data?.track.title}
            </p>
            <IconButton
              label="Cancel"
              size="sm"
              onClick={() => {
                setReplyTo(null);
                if (editing) setText("");
                setEditing(null);
              }}
            >
              <X />
            </IconButton>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            id="chat-input"
            dir="auto"
            rows={1}
            value={text}
            placeholder="Message"
            onChange={(e) => {
              setText(e.target.value);
              notifyTyping();
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-surface-solid px-4 py-2.5 text-[16px] outline-none focus:border-accent"
          />
          <Button type="submit" variant="primary" className="size-11 rounded-full p-0" aria-label={editing ? "Save" : "Send"} disabled={!text.trim()}>
            <Send className="size-5" />
          </Button>
        </div>
      </form>
      <SwapSheet open={swapOpen} onOpenChange={setSwapOpen} />
    </div>
  );
}
