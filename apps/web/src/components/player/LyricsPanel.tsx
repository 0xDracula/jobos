"use client";

import { useQuery } from "@tanstack/react-query";
import { BookHeart, MessageCircleHeart, NotebookPen, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { keepsakeApi, keepsakeKeys, useTrackNotes, type CardLine, type SongNote } from "@/lib/keepsakes";
import { keys, queryClient } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { openSend } from "@/components/friends/sheets";
import { toast } from "@/lib/toast";
import { seek } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";

import { NoteDialog } from "../NoteDialog";
import { Button, Spinner } from "../ui";
import { usePlaybackClock } from "./clock";

const notYet = (err: unknown) => err instanceof ApiError && err.status === 404;

const MAX_LINES = 12;
const LONG_PRESS_MS = 450;

export function LyricsPanel({ trackId }: { trackId: string }) {
  const q = useQuery({
    queryKey: keys.lyrics(trackId),
    queryFn: () => api.lyrics(trackId),
    retry: false,
    refetchInterval: (query) => (notYet(query.state.error) && query.state.errorUpdateCount < 60 ? 5000 : false),
  });
  const center = "grid min-h-0 flex-1 place-items-center font-display text-xl font-semibold text-muted";
  if (q.isLoading) {
    return (
      <div className={center}>
        <Spinner className="size-7" />
      </div>
    );
  }
  if (q.error) {
    return (
      <div className={center}>
        <span className="inline-flex items-center gap-2">
          {notYet(q.error) && <Spinner className="size-5" />}
          {notYet(q.error) ? "Lyrics pending" : "Lyrics unavailable"}
        </span>
      </div>
    );
  }
  const v = q.data!;
  if (v.status === "synced" && v.lines?.length) {
    return <Lines key={trackId} trackId={trackId} lines={v.lines.map((l) => ({ text: l.text, ms: l.time_ms }))} offset={v.offset_ms} synced />;
  }
  if (v.status === "plain" && v.plain) {
    return <Lines key={trackId} trackId={trackId} lines={v.plain.split("\n").map((text) => ({ text, ms: null }))} offset={0} synced={false} />;
  }
  return <div className={center}>{v.status === "instrumental" ? "Instrumental" : "No lyrics"}</div>;
}

function lineAt(lines: CardLine[], offset: number, ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].ms ?? 0) + offset <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function Lines({ trackId, lines, offset, synced }: { trackId: string; lines: CardLine[]; offset: number; synced: boolean }) {
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [noting, setNoting] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number; fired: boolean } | null>(null);
  const reduced = useReducedMotion();
  const track = usePlayer(selectTrack);
  const notes = useTrackNotes(trackId);
  const byLine = useMemo(() => {
    const m = new Map<number, SongNote[]>();
    for (const n of notes.data ?? []) if (n.line_index != null) m.set(n.line_index, [...(m.get(n.line_index) ?? []), n]);
    return m;
  }, [notes.data]);

  usePlaybackClock((t) => {
    if (!synced) return;
    const i = lineAt(lines, offset, t * 1000 + 150);
    setActive((prev) => (prev === i ? prev : i));
  });

  useEffect(() => {
    if (!synced || selected || Date.now() - userScrolled.current < 4000) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${Math.max(0, active)}"]`);
    if (!el || !box.current) return;
    const top = active < 0 ? 0 : Math.max(0, el.offsetTop - box.current.clientHeight * 0.3);
    box.current.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced, synced, selected]);

  const markUser = () => {
    userScrolled.current = Date.now();
  };

  const startSelect = (i: number) => {
    setSelected(new Set([i]));
    if ("vibrate" in navigator) navigator.vibrate?.(15);
  };
  const toggle = (i: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else if (next.size < MAX_LINES) next.add(i);
      return next.size ? next : null;
    });

  const longPress = (i: number) => {
    if (!selected) startSelect(i);
    else toggle(i);
  };
  const onPointerDown = (i: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (press.current) clearTimeout(press.current.timer);
    const p = { x: e.clientX, y: e.clientY, fired: false, timer: undefined as unknown as ReturnType<typeof setTimeout> };
    p.timer = setTimeout(() => {
      p.fired = true;
      longPress(i);
    }, LONG_PRESS_MS);
    press.current = p;
  };
  const cancelPress = (e: ReactPointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (e.type === "pointermove" && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 10) return;
    clearTimeout(p.timer);
    if (!p.fired) press.current = null;
  };
  const onContextMenu = (i: number) => (e: ReactMouseEvent) => {
    e.preventDefault();
    const p = press.current;
    if (p) {
      clearTimeout(p.timer);
      if (p.fired) return;
      p.fired = true;
    }
    longPress(i);
  };
  const onClick = (i: number) => {
    const p = press.current;
    press.current = null;
    if (p?.fired) return;
    if (selected) toggle(i);
    else if (synced) seek(Math.max(0, ((lines[i].ms ?? 0) + offset) / 1000));
  };

  const picked = selected ? [...selected].sort((a, b) => a - b) : [];
  const pickedLines = picked.map((i) => lines[i]).filter((l) => l.text.trim());

  const sendToChat = async () => {
    if (!track || !pickedLines.length) return;
    openSend({ kind: "lyric", track, lines: pickedLines });
    toast("Sent to chat");
    setSelected(null);
  };
  const saveClipping = async () => {
    if (!pickedLines.length) return;
    try {
      await keepsakeApi.addClipping(trackId, pickedLines);
      void queryClient.invalidateQueries({ queryKey: keepsakeKeys.scrapbook });
      toast("Saved to scrapbook");
      setSelected(null);
    } catch {
      toast("Not saved");
    }
  };

  return (
    <>
      <div
        ref={box}
        onWheel={markUser}
        onTouchMove={markUser}
        className={cn(
          "no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1",
          synced ? "pt-4 [mask-image:linear-gradient(transparent,black_6%,black_80%,transparent)]" : "py-6",
        )}
      >
        {lines.map((line, i) => {
          const isSel = selected?.has(i) ?? false;
          const lineNotes = byLine.get(i);
          return (
            <div key={i}>
              <button
                type="button"
                data-line={i}
                dir="auto"
                aria-pressed={selected ? isSel : undefined}
                onPointerDown={onPointerDown(i)}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onPointerMove={cancelPress}
                onContextMenu={onContextMenu(i)}
                onClick={() => onClick(i)}
                className={cn(
                  "block w-full select-none rounded-[14px] px-3 py-2 text-start font-extrabold transition-[opacity,background-color] duration-300 [-webkit-touch-callout:none]",
                  synced ? "text-[clamp(22px,2.1vw,30px)] leading-[1.32] tracking-[-0.01em] [text-wrap:balance]" : "min-h-4 py-1 text-xl leading-relaxed lg:text-[22px]",
                  isSel && "bg-[var(--player-chip)]",
                  !synced || selected
                    ? "text-ink"
                    : i === active || (active < 0 && i === 0)
                      ? "text-ink"
                      : i < active
                        ? "text-ink opacity-35"
                        : "text-ink opacity-55 hover:opacity-85",
                )}
              >
                {line.text || (synced ? <Gap current={i === active} /> : " ")}
              </button>
              {lineNotes?.map((n) => <LineNote key={n.id} note={n} />)}
            </div>
          );
        })}
        {synced && <div aria-hidden className="h-[62%] shrink-0" />}
      </div>
      {selected && (
        <div role="toolbar" aria-label="Selected lines" className="flex flex-wrap items-center justify-center gap-2 border-t border-line px-2 pt-3">
          <span className="tabular px-2 text-sm font-bold text-muted">
            {picked.length} of {MAX_LINES}
          </span>
          <Button size="sm" variant="primary" onClick={() => void sendToChat()} disabled={!pickedLines.length || !track}>
            <MessageCircleHeart className="size-4" /> Send to chat
          </Button>
          <Button size="sm" onClick={() => void saveClipping()} disabled={!pickedLines.length}>
            <BookHeart className="size-4" /> Save to scrapbook
          </Button>
          {picked.length === 1 && (
            <Button size="sm" onClick={() => setNoting(picked[0])}>
              <NotebookPen className="size-4" /> Note
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)} aria-label="Cancel selection">
            <X className="size-4" />
          </Button>
        </div>
      )}
      <NoteDialog
        trackId={trackId}
        line={noting == null ? null : { index: noting, ...lines[noting] }}
        onClose={(saved) => {
          setNoting(null);
          if (saved) setSelected(null);
        }}
      />
    </>
  );
}

function Gap({ current }: { current: boolean }) {
  return (
    <span aria-label="Instrumental" className="flex justify-center gap-2 py-2">
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className={cn("size-2.5 rounded-full bg-current", current ? "animate-[gap-dot_1.2s_ease-in-out_infinite]" : "opacity-60")}
          style={{ animationDelay: `${d * 0.18}s` }}
        />
      ))}
    </span>
  );
}

function LineNote({ note }: { note: SongNote }) {
  const [open, setOpen] = useState(false);
  const members = useMembers();
  const name = members.data?.find((u) => u.id === note.author_id)?.display_name;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      className="mx-3 mb-2 block max-w-[calc(100%-24px)] rounded-[14px] bg-accent-soft/60 px-3 py-1.5 text-start"
    >
      <span dir="auto" className={cn("block font-hand text-lg leading-snug text-ink", !open && "line-clamp-2")}>
        {note.body}
      </span>
      {name && <span className="block text-xs font-bold text-muted">{name}</span>}
    </button>
  );
}

