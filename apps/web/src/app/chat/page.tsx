"use client";

import { ArrowDown, BellOff, Check, CheckCheck, Clock, Headphones, Lamp, Music2, Pencil, Pin, PinOff, Play, Reply, RotateCcw, Search, Send, Smile, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import { Avatar } from "@/avatar";
import { PhotoButton, PhotoMessage, StickerButton, StickerMessage, VoiceButton, VoiceNote } from "@/components/chat/Media";
import { ChatSearch, messageText, PinnedBar } from "@/components/chat/PinsSearch";
import { MoodChip } from "@/components/profile/Mood";
import { SwapSheet } from "@/components/SwapSheet";
import { Artwork } from "@/components/media";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { groupMessages } from "@/lib/chatGroups";
import { sessionWhen } from "@/lib/sessions";
import { cn } from "@/lib/cn";
import { effectOf, jumboEmoji, playEffect } from "@/lib/effects";
import { fmtTime, plural } from "@/lib/format";
import { moodOf, useProfile } from "@/lib/profiles";
import { keys, queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import {
  jumpTo, loadNewer, loadOlder, notifyTyping, retryMessage, sendMessage, showLatest, socialApi, socialKeys, typing, useChat, useChatEffects,
  usePresence, type ChatMessage,
} from "@/lib/social";
import { toast } from "@/lib/toast";
import { useTogether } from "@/lib/together";
import { playTracks, seek } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";
import { joinSession, listenAlong } from "@/player/together";

const QUICK = ["❤️", "😂", "😮", "😢", "🔥", "👍"];


const ON_SKY = "[text-shadow:0_1px_8px_var(--chat-shadow)]";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
  const d = m.data! as Required<Pick<NonNullable<ChatMessage["data"]>, "track" | "track_id">> & NonNullable<ChatMessage["data"]>;
  return (
    <div className="flex items-center gap-3">
      <Artwork src={d.track.artwork_thumb_url ?? d.track.artwork_url} className="size-14 shrink-0 rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate font-bold">{d.track.title}</p>
        <p dir="auto" className="truncate text-sm opacity-75">{d.track.artists.join(", ")}</p>
        {d.start_ms ? <p className="text-xs font-bold opacity-75">From {fmtTime(d.start_ms / 1000)}</p> : null}
        {moodOf(d.mood) && (
          <p className="text-xs font-bold opacity-75">
            Re: {moodOf(d.mood)!.emoji} {moodOf(d.mood)!.label}
          </p>
        )}
      </div>
      <IconButton label={`Play ${d.track.title}`} onClick={() => playCard(d.track_id, d.start_ms)} className={cn("bg-surface-solid/80", mine && "bg-white/70 text-[var(--chat-mine-ink)]")}>
        <Play />
      </IconButton>
    </div>
  );
}

function LyricCard({ m }: { m: ChatMessage }) {
  const d = m.data! as Required<Pick<NonNullable<ChatMessage["data"]>, "track" | "track_id">> & NonNullable<ChatMessage["data"]>;
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

function SwapCard({ m, mine, nameOf, me }: { m: ChatMessage; mine: boolean; nameOf: (id: string) => string; me: string }) {
  const d = m.data ?? {};
  const t = d.track;
  return (
    <div className="flex items-center gap-3">
      {t && <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-12 shrink-0 rounded-[10px]" />}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold opacity-70">{!d.pick_by ? "Song swap" : d.pick_by === me ? "Your swap pick" : `${nameOf(d.pick_by)}'s swap pick`}</p>
        {t && (
          <p dir="auto" className="truncate font-bold">
            {t.title} · {t.artists.join(", ")}
          </p>
        )}
      </div>
      {t && d.track_id && (
        <IconButton label={`Play ${t.title}`} onClick={() => playCard(d.track_id!)} className={cn("bg-surface-solid/80", mine && "bg-white/70 text-[var(--chat-mine-ink)]")}>
          <Play />
        </IconButton>
      )}
    </div>
  );
}

function SessionCard({ m }: { m: ChatMessage }) {
  const d = (m.data ?? {}) as unknown as { session_id?: string; title?: string; scheduled_at?: string | null; songs?: number };
  return (
    <Link href={`/together/?id=${d.session_id ?? ""}`} className="flex items-center gap-3">
      <span className="grid size-14 shrink-0 place-items-center rounded-[10px] bg-[var(--chat-action)]">
        <PixelIcon name="headphones" size={36} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-extrabold opacity-70">Listen together</span>
        <span dir="auto" className="block truncate font-bold">
          {d.title || m.body}
        </span>
        <span className="block text-sm opacity-75">
          {sessionWhen(d.scheduled_at ?? null)}
          {d.songs ? ` · ${plural(d.songs, "song")}` : ""}
        </span>
      </span>
    </Link>
  );
}

function Bubble({
  m, mine, tail, replyTo, nameOf, onReply, onEdit, me, focused,
}: {
  focused: boolean;
  m: ChatMessage;
  mine: boolean;
  tail: boolean;
  replyTo: ChatMessage | undefined;
  nameOf: (id: string) => string;
  onReply: () => void;
  onEdit: () => void;
  me: string;
}) {
  const card = m.kind === "song" || m.kind === "lyric" || m.kind === "session" || m.kind === "swap" || m.kind === "voice";
  const bare = !m.deleted && (m.kind === "sticker" || (m.kind === "text" && !replyTo && jumboEmoji(m.body)));
  const myReaction = m.reactions.find((r) => r.user_id === me)?.emoji ?? "";
  const react = (emoji: string) => socialApi.react(m.id, emoji === myReaction ? "" : emoji).catch(() => toast("Reaction not saved"));
  const edited = !!m.edited_at && !m.deleted;
  return (
    <div data-message-id={m.id} className={cn("group flex max-w-full scroll-mt-24 flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "relative max-w-full rounded-[18px] transition-shadow duration-500",
          bare
            ? "px-1"
            : mine
              ? "bg-[var(--chat-mine)] px-4 py-2.5 text-[var(--chat-mine-ink)] shadow-[0_0_18px_var(--chat-mine-glow)]"
              : "border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] px-4 py-2.5 text-ink",
          m.kind === "photo" && !m.deleted && "p-1.5",
          tail && !bare && (mine ? "rounded-br-[6px]" : "rounded-bl-[6px]"),
          card && "min-w-[240px]",
          m.status === "sending" && "opacity-60",
          focused && "ring-4 ring-accent/70",
        )}
      >
        {replyTo && (
          <p dir="auto" className="mb-1.5 line-clamp-2 border-s-2 border-accent-strong/60 ps-2 text-sm opacity-75">
            <span className="font-bold">{nameOf(replyTo.sender_id)}: </span>
            {messageText(replyTo)}
          </p>
        )}
        {m.deleted ? (
          <p className="italic opacity-60">Deleted message</p>
        ) : m.kind === "song" ? (
          <SongCard m={m} mine={mine} />
        ) : m.kind === "lyric" ? (
          <LyricCard m={m} />
        ) : m.kind === "session" ? (
          <SessionCard m={m} />
        ) : m.kind === "voice" ? (
          <VoiceNote m={m} mine={mine} />
        ) : m.kind === "photo" ? (
          <>
            <PhotoMessage m={m} />
            {m.body && (
              <p dir="auto" className="whitespace-pre-wrap break-words px-2.5 pb-1 pt-2 text-[16px] leading-relaxed">
                {m.body}
              </p>
            )}
          </>
        ) : m.kind === "sticker" ? (
          <StickerMessage m={m} />
        ) : m.kind === "swap" ? (
          <>
            <SwapCard m={m} mine={mine} nameOf={nameOf} me={me} />
            <p dir="auto" className="mt-2 whitespace-pre-wrap break-words border-t border-current/15 pt-2 text-[16px] leading-relaxed">
              {m.body}
            </p>
          </>
        ) : (
          <p dir="auto" className={cn("whitespace-pre-wrap break-words leading-relaxed", bare ? "text-5xl leading-tight" : "text-[16px]")}>
            {m.body}
          </p>
        )}
        {m.data?.note && !m.deleted && (
          <p dir="auto" className="mt-2 whitespace-pre-wrap border-t border-current/15 pt-2 text-[15px]">
            {m.data.note}
          </p>
        )}
        {!m.deleted && !m.status && (
          <div className={cn("absolute top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", mine ? "-start-10" : "-end-10")}>
            <Menu modal={false}>
              <MenuTrigger aria-label="Message actions" className="grid size-8 place-items-center rounded-full border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] text-muted">
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
                <MenuItem
                  icon={m.pinned_at ? <PinOff /> : <Pin />}
                  onSelect={() => socialApi.pin(m.id, !m.pinned_at).catch(() => toast(m.pinned_at ? "Message not unpinned" : "Message not pinned"))}
                >
                  {m.pinned_at ? "Unpin" : "Pin"}
                </MenuItem>
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
      {(m.reactions.length > 0 || m.status || edited || m.pinned_at) && (
        <div className={cn("flex items-center gap-2 px-1 text-xs font-bold text-[var(--chat-meta)]", ON_SKY)}>
          {m.reactions.length > 0 && (
            <span className="rounded-full border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] px-2 py-0.5 [text-shadow:none]" aria-label="Reactions">
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
          ) : edited ? (
            <span>Edited</span>
          ) : null}
          {m.pinned_at && !m.status && (
            <span className="flex items-center gap-1">
              <Pin className="size-3.5" /> Pinned
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ChatAction({ label, pressed, children, className, ...props }: ComponentProps<"button"> & { label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      className={cn("group grid w-11 justify-items-center gap-1 text-[11px] font-extrabold text-[var(--chat-meta)] disabled:opacity-40 sm:w-14", ON_SKY, className)}
      {...props}
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-full bg-[var(--chat-action)] text-ink transition-colors group-hover:bg-accent-soft/60 [&>svg]:size-5",
          pressed && "bg-[var(--chat-mine)] text-[var(--chat-mine-ink)] shadow-[0_0_14px_var(--chat-mine-glow)] group-hover:bg-[var(--chat-mine)]",
        )}
      >
        {children}
      </span>
      <span aria-hidden className="max-sm:hidden">
        {label}
      </span>
    </button>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}

const EFFECTS_SEEN = "jobbos.chat.effects-seen";

function Chat() {
  const params = useSearchParams();
  const me = useMe().data;
  const members = useMembers();
  const presence = usePresence();
  const chat = useChat();
  const track = usePlayer(selectTrack);
  const room = useTogether().data;
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [swapOpen, setSwapOpen] = useState(params.get("swap") === "1");
  const [searching, setSearching] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const effects = useChatEffects();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const other = members.data?.find((u) => u.id !== me?.id) ?? null;
  const otherState = presence.data?.people.find((p) => p.id === other?.id);
  const otherProfile = useProfile(other?.id);
  const myState = presence.data?.people.find((p) => p.id === me?.id);
  const nameOf = (id: string) => (id === me?.id ? "You" : (members.data?.find((u) => u.id === id)?.display_name ?? "Someone"));
  const messages = useMemo(() => chat.data?.messages ?? [], [chat.data]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const rows = useMemo(() => groupMessages(messages), [messages]);
  const together = !!room?.active && !!me && room.members.includes(me.id);
  const hasNewer = !!chat.data?.hasNewer;

  const jump = async (id: string) => {
    setSearching(false);
    try {
      await jumpTo(id);
    } catch {
      toast("Message unavailable");
      return;
    }
    atBottom.current = false;
    setFocusId(id);
  };
  useEffect(() => {
    if (!focusId) return;
    const el = listRef.current?.querySelector(`[data-message-id="${focusId}"]`);
    el?.scrollIntoView({ block: "center" });
    const t = setTimeout(() => setFocusId(null), 1800);
    return () => clearTimeout(t);
  }, [focusId, messages.length]);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el || !hasNewer) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void loadNewer());
    io.observe(el);
    return () => io.disconnect();
  }, [hasNewer]);

  useEffect(() => {
    if (!me || !effects.data || chat.isPending || hasNewer) return;
    let seen = "";
    try {
      seen = localStorage.getItem(EFFECTS_SEEN) ?? "";
    } catch {
      return;
    }
    const newest = messages.at(-1)?.created_at ?? "";
    if (seen) {
      const fresh = messages.filter((m) => m.sender_id !== me.id && !m.deleted && m.created_at > seen && m.kind === "text");
      const effect = fresh.map((m) => effectOf(m.body, effects.data)).filter(Boolean).at(-1);
      if (effect) playEffect(effect);
    }
    if (newest && newest > seen) {
      try {
        localStorage.setItem(EFFECTS_SEEN, newest);
      } catch {
      }
    }
  }, [messages, effects.data, me, chat.isPending, hasNewer]);
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
    if (hasNewer) await showLatest();
    sendMessage("text", body, undefined, replyTo?.id ?? null);
    setText("");
    setReplyTo(null);
    atBottom.current = true;
  };
  const sentOther = () => {
    setReplyTo(null);
    atBottom.current = true;
    if (hasNewer) void showLatest();
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
  const theirSong = !together ? otherState?.playing : null;
  const joinThem = async () => {
    if (room?.active) return joinSession();
    if (!theirSong) return;
    const elapsed = Date.now() - new Date(theirSong.at).getTime();
    try {
      await listenAlong(theirSong.track_id, theirSong.position_ms + Math.max(0, elapsed));
    } catch {
      toast("Listen together unavailable");
    }
  };

  return (
    <div className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] flex flex-col bg-bg lg:bottom-0 lg:left-[88px]">
      <header className="relative flex items-center gap-3 border-b border-line bg-sidebar px-4 pb-2.5 pt-[max(env(safe-area-inset-top),12px)] lg:px-8 lg:pb-3 lg:pt-4">
        {other && (
          <Link href={`/profile/?id=${other.id}`} aria-label={other.display_name} className="shrink-0 rounded-full bg-[var(--chat-action)]">
            <Avatar userId={other.id} size={44} pose={otherState?.listening ? "listening" : "idle"} />
          </Link>
        )}
        <div ref={headRef} className="min-w-0 flex-1">
          <h1 dir="auto" className={cn("truncate font-display text-[22px] font-semibold leading-tight text-ink", ON_SKY)}>
            {other?.display_name ?? "Chat"}
          </h1>
          <p className={cn("flex items-center gap-1.5 truncate text-[13px] font-bold text-[var(--chat-meta)]", ON_SKY)}>
            {otherState?.online && <span aria-hidden className="size-2 shrink-0 rounded-full bg-sage" />}
            {otherTyping ? "Typing…" : status}
            {together && (
              <Link href="/together/" className="flex items-center gap-1">
                <Headphones className="size-3.5" /> Listening together
              </Link>
            )}
            {otherState?.quiet && (
              <span className="flex items-center gap-1">
                <BellOff className="size-3.5" /> Quiet mode
              </span>
            )}
          </p>
          {otherProfile?.mood && <MoodChip mood={otherProfile.mood} note className={cn("mt-0.5 max-w-full text-[13px] font-bold text-[var(--chat-meta)]", ON_SKY)} />}
          {theirSong && (
            <p className={cn("mt-0.5 flex items-center gap-1.5 text-[13px] font-bold text-[var(--chat-meta)]", ON_SKY)}>
              <Music2 className="size-3.5 shrink-0" />
              <span dir="auto" className="min-w-0 truncate">
                {theirSong.title} · {theirSong.artists.join(", ")}
              </span>
              <button
                type="button"
                onClick={() => void joinThem()}
                className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-extrabold text-on-accent [text-shadow:none]"
              >
                Join
              </button>
            </p>
          )}
        </div>
        <div ref={actionsRef} className="flex shrink-0">
          <ChatAction label="Lamp" title={lampOn ? "Switch off their lamp" : "Thinking of you"} pressed={lampOn} onClick={sendLamp} disabled={!other}>
            <Lamp />
          </ChatAction>
          <ChatAction label="Search" title="Search messages" pressed={searching} onClick={() => setSearching((v) => !v)}>
            <Search />
          </ChatAction>
          <ChatAction label="Swap" title="Song swap" onClick={() => setSwapOpen(true)}>
            <Music2 />
          </ChatAction>
          <ChatAction label="Quiet" title={myState?.quiet ? "Quiet mode on" : "Quiet mode off"} pressed={!!myState?.quiet} onClick={toggleQuiet}>
            <BellOff />
          </ChatAction>
        </div>
      </header>
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-1 lg:px-8">
        {searching ? <ChatSearch nameOf={nameOf} onJump={(id) => void jump(id)} onClose={() => setSearching(false)} /> : <PinnedBar onJump={(id) => void jump(id)} />}
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="relative flex flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-1.5 px-4 py-3 lg:px-8">
          <div ref={topRef} className="h-px shrink-0" />
          {chat.isPending && <p className={cn("m-auto font-bold text-[var(--chat-meta)]", ON_SKY)}>Loading</p>}
          {!chat.isPending && messages.length === 0 && <p className={cn("m-auto font-bold text-[var(--chat-meta)]", ON_SKY)}>No messages yet</p>}
          {rows.map((row) => {
            if (row.kind === "day") {
              return (
                <p key={row.key} className={cn("my-2 self-center font-hand text-xl text-[var(--chat-date)]", ON_SKY)}>
                  {row.label}
                </p>
              );
            }
            const mine = row.sender === me?.id;
            const last = row.items[row.items.length - 1];
            const receipt = mine && !!lastMine && row.items.some((m) => m.id === lastMine.id);
            return (
              <div key={row.key} className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && (
                  <span className="mb-5 shrink-0 overflow-hidden rounded-full bg-[var(--chat-action)]">
                    <Avatar userId={row.sender} size={28} />
                  </span>
                )}
                <div className={cn("flex min-w-0 max-w-[82%] flex-col gap-1", mine ? "items-end" : "items-start")}>
                  {row.items.map((m, i) => (
                    <Bubble
                      key={m.id}
                      m={m}
                      me={me?.id ?? ""}
                      mine={mine}
                      tail={i === row.items.length - 1}
                      replyTo={m.reply_to ? byId.get(m.reply_to) : undefined}
                      nameOf={nameOf}
                      focused={focusId === m.id}
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
                  <p className={cn("flex items-center gap-1 px-1 text-[11px] font-bold text-[var(--chat-meta)]", ON_SKY)}>
                    {timeOf(last.created_at)}
                    {receipt &&
                      (seen ? (
                        <>
                          {" · "}
                          <CheckCheck className="size-3.5" /> Seen
                        </>
                      ) : (
                        <>
                          {" · "}
                          <Check className="size-3.5" /> Sent
                        </>
                      ))}
                  </p>
                </div>
              </div>
            );
          })}
          {otherTyping && (
            <p className="self-start rounded-[18px] rounded-bl-[6px] border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] px-4 py-2 text-sm font-bold text-muted">Typing…</p>
          )}
          <div ref={bottomRef} className="h-px shrink-0" />
        </div>
      </div>
      {hasNewer && (
        <div className="pointer-events-none relative">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              atBottom.current = true;
              void showLatest();
            }}
            className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 shadow-soft"
          >
            <ArrowDown className="size-4" /> Latest
          </Button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="relative mx-auto w-full max-w-3xl px-3 pb-3 pt-2 lg:px-8 lg:pb-6"
      >
        {(replyTo || editing) && (
          <div className="mb-2 flex items-center gap-2 rounded-[14px] border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] px-3 py-2 text-sm">
            {editing ? <Pencil className="size-4 shrink-0" /> : <Reply className="size-4 shrink-0" />}
            <p dir="auto" className="min-w-0 flex-1 truncate">
              <span className="font-bold">{editing ? "Editing" : `Reply to ${nameOf(replyTo!.sender_id)}`}: </span>
              {(editing ?? replyTo)!.kind === "text" ? (editing ?? replyTo)!.body : ((editing ?? replyTo)!.data?.track?.title ?? (editing ?? replyTo)!.body)}
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
        <div className="flex items-end gap-1.5">
          {!editing && (
            <span className="flex shrink-0 rounded-full bg-[var(--chat-input)]">
              <StickerButton replyTo={replyTo?.id ?? null} onSent={sentOther} />
              <PhotoButton replyTo={replyTo?.id ?? null} onSent={sentOther} />
            </span>
          )}
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
            className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border-2 border-[var(--chat-theirs-line)] bg-[var(--chat-input)] px-4 py-2 text-[16px] text-ink outline-none placeholder:text-muted focus:border-accent"
          />
          <span className="shrink-0 rounded-full bg-[var(--chat-input)]">
            {text.trim() || editing ? (
              <Button type="submit" variant="primary" className="size-11 rounded-full p-0" aria-label={editing ? "Save" : "Send"} disabled={!text.trim()}>
                <Send className="size-5" />
              </Button>
            ) : (
              <VoiceButton replyTo={replyTo?.id ?? null} onSent={sentOther} />
            )}
          </span>
        </div>
      </form>
      {track && <div aria-hidden className="h-[calc(0.6rem+74px)] shrink-0 lg:h-[calc(1rem+78px)]" />}
      <SwapSheet open={swapOpen} onOpenChange={setSwapOpen} />
    </div>
  );
}
