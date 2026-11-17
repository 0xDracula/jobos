"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { Failed, Loading } from "@/components/common";
import { Dialog } from "@/components/dialogs";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDayRange, tilt } from "@/lib/days";
import { plural } from "@/lib/format";
import { memoriesApi, memoryKeys, useChapters, useMemoriesLive, type Chapter, type Photo } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useResolvedTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";
import { usePlayer } from "@/player/store";

import { Byline, PhotoImage, SongChip, panelClass, playSong, useReducedMotionPref } from "./parts";
import { ChapterEditor } from "./StoryEditor";

const COVER = "cover";
const TURN_S = 0.25;
const PAPER = { day: "#fffaf2", night: "#2a2656" } as const;
const BOARD = { day: "#a8445e", night: "#5e2b55" } as const;
const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role=slider], [role=menu], [role=menuitem], [role=listbox], [role=option], [role=tablist]";

const wideQuery = () => window.matchMedia("(min-width: 1024px)");

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = wideQuery();
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => wideQuery().matches,
    () => false,
  );
}

type Turn = { from: string; to: string; dir: 1 | -1; phase: 1 | 2 };
type Over = { key: string; side: "left" | "right" | "single"; mode: "fold" | "unfold"; origin: "left" | "right"; onDone: () => void };

function Fold({ mode, origin, onDone, children }: { mode: Over["mode"]; origin: Over["origin"]; onDone: () => void; children: ReactNode }) {
  const folding = mode === "fold";
  return (
    <motion.div
      aria-hidden
      inert
      className="absolute inset-0 z-10 overflow-hidden"
      style={{ transformOrigin: `${origin} center` }}
      initial={{ scaleX: folding ? 1 : 0 }}
      animate={{ scaleX: folding ? 0 : 1 }}
      transition={{ duration: TURN_S, ease: folding ? "easeIn" : "easeOut" }}
      onAnimationComplete={onDone}
    >
      {children}
      <motion.div
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(to ${origin}, rgba(30,27,58,0) 15%, rgba(30,27,58,0.5) 100%)` }}
        initial={{ opacity: folding ? 0 : 1 }}
        animate={{ opacity: folding ? 1 : 0 }}
        transition={{ duration: TURN_S, ease: "linear" }}
      />
    </motion.div>
  );
}

function Paper({ side, children, className }: { side: Over["side"]; children: ReactNode; className?: string }) {
  const theme = useResolvedTheme();
  const shade = side === "left" ? "inset -24px 0 28px -24px rgba(30,27,58,0.35)" : "inset 24px 0 28px -24px rgba(30,27,58,0.35)";
  return (
    <div className={cn("flex flex-col", className)} style={{ background: PAPER[theme], boxShadow: shade }}>
      {children}
    </div>
  );
}

function Page({ side, fade, fill, children }: { side: Over["side"]; fade: boolean; fill?: boolean; children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: fade ? 0 : 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className={cn(fill ? "absolute inset-0 overflow-y-auto" : "relative")}
    >
      <Paper side={side} className={cn("relative", fill ? "min-h-full" : "min-h-[30rem]")}>
        {children}
      </Paper>
    </motion.div>
  );
}

function Endpaper() {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        backgroundImage:
          "radial-gradient(circle at 25% 25%, rgba(232,143,163,0.38) 0 2px, transparent 2.5px), radial-gradient(circle at 75% 75%, rgba(201,184,240,0.5) 0 2px, transparent 2.5px)",
        backgroundSize: "26px 26px",
      }}
    />
  );
}

function Cover({ count, onOpen }: { count: number; onOpen: () => void }) {
  const theme = useResolvedTheme();
  return (
    <div
      className="relative flex min-h-[30rem] flex-col items-center justify-center gap-6 overflow-hidden px-8 py-12 text-center lg:absolute lg:inset-0 lg:min-h-0"
      style={{ background: `repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 3px, transparent 3px 8px), ${BOARD[theme]}` }}
    >
      <span aria-hidden className="absolute inset-y-0 start-0 w-4 bg-black/20" />
      <span aria-hidden className="pointer-events-none absolute inset-4 rounded-[6px] border-2 border-dashed border-[#ffd98a]/55" />
      <PixelIcon name="star" size={56} />
      <div className="rounded-[10px] border-2 border-b-[5px] border-[#2e2c48]/25 bg-[#fff4e8] px-7 py-4 shadow-[0_8px_18px_rgba(10,8,30,0.25)]">
        <p className="font-display text-[30px] font-semibold leading-tight text-[#a8445e]">Story book</p>
        <p className="mt-0.5 text-sm font-bold text-[#7a6a7e]">{plural(count, "chapter")}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={!count}
        className="min-h-11 rounded-button bg-[#fff4e8] px-7 text-[15px] font-extrabold text-[#a8445e] shadow-soft transition-transform hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-50"
      >
        Open
      </button>
    </div>
  );
}

function ChapterPhotos({ chapter, onView, compact }: { chapter: Chapter; onView: (i: number) => void; compact?: boolean }) {
  const [first, ...rest] = chapter.photos;
  if (!first) return compact ? null : <Endpaper />;
  const more = rest.length - 5;
  return (
    <div className={cn("flex flex-col gap-4", compact ? "px-5 pt-6" : "absolute inset-0 p-6 lg:p-8")}>
      <button
        type="button"
        onClick={() => onView(0)}
        aria-label={first.caption || "Photo"}
        className={cn("block rounded-[4px] bg-white p-2 pb-7 shadow-[0_8px_18px_rgba(10,8,30,0.28)] transition-transform hover:scale-[1.01]", compact ? "w-full" : "min-h-0 flex-1")}
        style={{ rotate: `${tilt(first.id, 1.5)}deg` }}
      >
        <PhotoImage photo={first} size="display" alt={first.caption} className={cn("w-full rounded-[2px]", compact ? "aspect-[4/3]" : "h-full")} />
      </button>
      {rest.length > 0 && (
        <ul className="flex flex-wrap gap-2.5">
          {rest.slice(0, 5).map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onView(i + 1)}
                aria-label={p.caption || `Photo ${i + 2}`}
                className="block size-16 rounded-[3px] bg-white p-1 shadow-[0_4px_10px_rgba(10,8,30,0.25)] transition-transform hover:scale-105"
                style={{ rotate: `${tilt(p.id, 3)}deg` }}
              >
                <PhotoImage photo={p} className="size-full rounded-[2px]" />
              </button>
            </li>
          ))}
          {more > 0 && (
            <li>
              <button
                type="button"
                onClick={() => onView(6)}
                className="grid size-16 place-items-center rounded-[6px] border-2 border-panel-line bg-panel text-sm font-extrabold text-muted"
              >
                +{more}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ChapterText({ chapter, number, total, onEdit }: { chapter: Chapter; number: number; total: number; onEdit: () => void }) {
  const dates = fmtDayRange(chapter.date_from, chapter.date_to);
  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pb-5 pt-6 lg:px-9 lg:pt-8">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted">Chapter {number}</p>
          <h2 dir="auto" className="mt-1 break-words font-hand text-[40px] leading-[1.05]">
            {chapter.title}
          </h2>
          {dates && <p className="mt-1.5 text-sm font-bold text-muted">{dates}</p>}
        </div>
        <IconButton label="Edit chapter" onClick={onEdit} className="-me-2 -mt-1">
          <Pencil />
        </IconButton>
      </div>
      {(chapter.placeholder || chapter.track) && (
        <div className="flex flex-wrap items-center gap-2">
          {chapter.placeholder && <PlaceholderMark />}
          <SongChip track={chapter.track} name={chapter.title} />
        </div>
      )}
      {chapter.body && (
        <p dir="auto" className="max-w-[60ch] whitespace-pre-wrap break-words text-[17px] leading-[1.7]">
          {chapter.body}
        </p>
      )}
      <div className="mt-auto flex items-end justify-between gap-3 pt-2">
        <Byline userId={chapter.created_by} />
        <span className="tabular text-xs font-bold text-muted">
          {number} / {total}
        </span>
      </div>
    </div>
  );
}

function PhotoViewer({ viewing, onClose }: { viewing: { photos: Photo[]; index: number } | null; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (viewing) setIndex(viewing.index);
  }, [viewing]);
  const photos = viewing?.photos ?? [];
  const photo = photos[index] ?? photos[0];
  return (
    <Dialog open={!!viewing} onOpenChange={(o) => !o && onClose()} title="Photo" wide>
      {photo && (
        <div className="grid gap-3">
          <PhotoImage photo={photo} size="display" fit="contain" alt={photo.caption} eager className="max-h-[64dvh] w-full rounded-[8px]" />
          {photo.caption && (
            <p dir="auto" className="font-hand text-xl leading-snug">
              {photo.caption}
            </p>
          )}
          {photos.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={p.caption || `Photo ${i + 1}`}
                    aria-pressed={i === index}
                    className={cn("block size-14 overflow-hidden rounded-[6px] border-2", i === index ? "border-accent-strong" : "border-transparent opacity-80 hover:opacity-100")}
                  >
                    <PhotoImage photo={p} className="size-full" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Contents({
  chapters,
  current,
  onOpen,
  onMove,
  moving,
}: {
  chapters: Chapter[];
  current: string;
  onOpen: (index: number) => void;
  onMove: (index: number, d: -1 | 1) => void;
  moving: boolean;
}) {
  return (
    <nav aria-label="Contents" className={cn(panelClass, "p-2")}>
      <h2 className="px-2 pb-1 pt-1.5 font-display text-lg font-semibold">Contents</h2>
      <ol className="grid grid-cols-1 gap-0.5">
        {chapters.map((c, i) => {
          const here = c.id === current;
          const dates = fmtDayRange(c.date_from, c.date_to);
          return (
            <li key={c.id} className={cn("flex items-center rounded-[8px] pe-0.5", here && "bg-accent-soft/60")}>
              <button
                type="button"
                onClick={() => onOpen(i + 1)}
                aria-current={here ? "page" : undefined}
                className="flex min-h-12 min-w-0 flex-1 items-start gap-2.5 rounded-[8px] px-2 py-2 text-start hover:bg-accent-soft/40"
              >
                <span className="tabular mt-0.5 w-5 shrink-0 text-end text-sm font-extrabold text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="line-clamp-2 font-bold leading-snug">
                    {c.title}
                  </span>
                  {(dates || c.placeholder) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {dates && <span className="text-xs font-semibold text-muted">{dates}</span>}
                      {c.placeholder && <PlaceholderMark />}
                    </span>
                  )}
                </span>
              </button>
              <IconButton label="Move earlier" onClick={() => onMove(i, -1)} disabled={moving || i === 0}>
                <ArrowUp />
              </IconButton>
              <IconButton label="Move later" onClick={() => onMove(i, 1)} disabled={moving || i === chapters.length - 1}>
                <ArrowDown />
              </IconButton>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StoryBook() {
  useMemoriesLive();
  const q = useChapters();
  const params = useSearchParams();
  const wide = useWide();
  const reduced = useReducedMotionPref();
  const theme = useResolvedTheme();
  const chapters = useMemo(() => q.data ?? [], [q.data]);
  const keys = useMemo(() => [COVER, ...chapters.map((c) => c.id)], [chapters]);
  const [shown, setShown] = useState(COVER);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [editing, setEditing] = useState<Chapter | "new" | null>(null);
  const [viewing, setViewing] = useState<{ photos: Photo[]; index: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const [held, setHeld] = useState<number | null>(null);
  const bookRef = useRef<HTMLElement>(null);
  const applied = useRef(false);
  const turnRef = useRef(turn);
  turnRef.current = turn;

  const index = Math.max(0, keys.indexOf(shown));
  const byId = (id: string) => chapters.find((c) => c.id === id) ?? null;

  useEffect(() => {
    if (applied.current || !q.data) return;
    applied.current = true;
    const wanted = params.get("chapter");
    if (wanted && q.data.some((c) => c.id === wanted)) setShown(wanted);
  }, [q.data, params]);

  useEffect(() => {
    if (q.data && !keys.includes(shown)) setShown(COVER);
  }, [q.data, keys, shown]);

  const go = (to: number) => {
    if (turnRef.current) return;
    const from = keys[index];
    const toKey = keys[to];
    if (!toKey || toKey === from) return;
    const chapter = byId(toKey);
    if (chapter) playSong(chapter.track, chapter.title);
    window.history.replaceState(null, "", toKey === COVER ? "/story/" : `/story/?chapter=${toKey}`);
    const book = bookRef.current;
    if (book && book.getBoundingClientRect().top < 0) book.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    if (reduced) {
      setShown(toKey);
      return;
    }
    setHeld(book?.offsetHeight ?? null);
    setTurn({ from, to: toKey, dir: to > index ? 1 : -1, phase: 1 });
  };
  const stepRef = useRef<(d: 1 | -1) => void>(() => {});
  stepRef.current = (d) => go(index + d);

  const finish = () => {
    const t = turnRef.current;
    if (t) setShown(t.to);
    setTurn(null);
    setHeld(null);
  };
  const nextPhase = () => setTurn((t) => (t ? { ...t, phase: 2 } : t));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=menu][data-state=open]")) return;
      if (usePlayer.getState().expanded) return;
      e.preventDefault();
      stepRef.current(e.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const move = async (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= chapters.length || moving) return;
    const ids = chapters.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setMoving(true);
    try {
      const r = await memoriesApi.reorderChapters(ids);
      queryClient.setQueryData(memoryKeys.chapters, r.chapters);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setMoving(false);
    }
  };

  const view = (chapter: Chapter, i: number) => setViewing({ photos: chapter.photos, index: i });

  const leftOf = (key: string) => {
    const c = byId(key);
    return c ? <ChapterPhotos chapter={c} onView={(i) => view(c, i)} /> : <Endpaper />;
  };
  const rightOf = (key: string) => {
    const c = byId(key);
    if (!c) return <Cover count={chapters.length} onOpen={() => go(1)} />;
    return <ChapterText chapter={c} number={keys.indexOf(key)} total={chapters.length} onEdit={() => setEditing(c)} />;
  };
  const singleOf = (key: string) => {
    const c = byId(key);
    if (!c) return <Cover count={chapters.length} onOpen={() => go(1)} />;
    return (
      <>
        <ChapterPhotos chapter={c} onView={(i) => view(c, i)} compact />
        <ChapterText chapter={c} number={keys.indexOf(key)} total={chapters.length} onEdit={() => setEditing(c)} />
      </>
    );
  };

  let baseLeft = shown;
  let baseRight = shown;
  let baseSingle = shown;
  let over: Over | null = null;
  if (turn && wide) {
    const forward = turn.dir === 1;
    baseLeft = forward ? turn.from : turn.to;
    baseRight = forward ? turn.to : turn.from;
    if (turn.phase === 1) {
      over = forward
        ? { key: turn.from, side: "right", mode: "fold", origin: "left", onDone: nextPhase }
        : { key: turn.from, side: "left", mode: "fold", origin: "right", onDone: nextPhase };
    } else {
      over = forward
        ? { key: turn.to, side: "left", mode: "unfold", origin: "right", onDone: finish }
        : { key: turn.to, side: "right", mode: "unfold", origin: "left", onDone: finish };
    }
  } else if (turn) {
    baseSingle = turn.dir === 1 ? turn.to : turn.from;
    over =
      turn.dir === 1
        ? { key: turn.from, side: "single", mode: "fold", origin: "left", onDone: finish }
        : { key: turn.to, side: "single", mode: "unfold", origin: "left", onDone: finish };
  }

  const fold = (side: Over["side"]) =>
    over?.side === side && (
      <Fold key={`${side}-${turn?.phase}-${over.key}`} mode={over.mode} origin={over.origin} onDone={over.onDone}>
        <Paper side={side} className={side === "single" ? "relative min-h-full" : "absolute inset-0"}>
          {side === "left" ? leftOf(over.key) : side === "right" ? rightOf(over.key) : singleOf(over.key)}
        </Paper>
      </Fold>
    );

  return (
    <>
      <PageHero title="Story book" meta={q.data ? plural(chapters.length, "chapter") : undefined}>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-5" /> Add chapter
        </Button>
      </PageHero>
      {q.isLoading && <Loading />}
      {q.isError && <Failed what="Story book" />}
      {q.data && !chapters.length && <Empty>No chapters</Empty>}
      {chapters.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <div className="grid min-w-0 gap-3">
            <motion.section
              ref={bookRef}
              aria-label="Book"
              onPanEnd={(e, info) => {
                if (e.pointerType !== "touch") return;
                const { x, y } = info.offset;
                if (Math.abs(x) < 60 || Math.abs(x) < Math.abs(y) * 1.5) return;
                stepRef.current(x < 0 ? 1 : -1);
              }}
              style={{ touchAction: "pan-y", minHeight: held ?? undefined, background: BOARD[theme] }}
              className="scroll-mt-4 rounded-[16px] p-1.5 shadow-soft lg:p-2"
            >
              {wide ? (
                <div className="relative grid h-[min(74dvh,660px)] min-h-[32rem] grid-cols-2 overflow-hidden rounded-[10px]">
                  <div className="relative min-w-0 overflow-hidden">
                    <Page key={`left-${baseLeft}`} side="left" fade={reduced} fill>
                      {leftOf(baseLeft)}
                    </Page>
                    {fold("left")}
                  </div>
                  <div className="relative min-w-0 overflow-hidden">
                    <Page key={`right-${baseRight}`} side="right" fade={reduced} fill>
                      {rightOf(baseRight)}
                    </Page>
                    {fold("right")}
                  </div>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-12 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(30,27,58,0.14)_44%,rgba(30,27,58,0.24)_50%,rgba(30,27,58,0.14)_56%,transparent)]"
                  />
                </div>
              ) : (
                <div className="relative overflow-hidden rounded-[10px]">
                  <Page key={`single-${baseSingle}`} side="single" fade={reduced}>
                    {singleOf(baseSingle)}
                  </Page>
                  {over && <div className="absolute inset-0 z-10 overflow-hidden">{fold("single")}</div>}
                </div>
              )}
            </motion.section>
            <div className="flex items-center justify-between gap-3">
              <IconButton label="Previous chapter" size="lg" onClick={() => go(index - 1)} disabled={index === 0}>
                <ChevronLeft />
              </IconButton>
              <p className="tabular text-sm font-extrabold text-muted" aria-live="polite">
                {index === 0 ? "Cover" : `Chapter ${index} / ${chapters.length}`}
              </p>
              <IconButton label="Next chapter" size="lg" onClick={() => go(index + 1)} disabled={index >= chapters.length}>
                <ChevronRight />
              </IconButton>
            </div>
          </div>
          <Contents chapters={chapters} current={shown} onOpen={go} onMove={(i, d) => void move(i, d)} moving={moving} />
        </div>
      )}
      <ChapterEditor
        chapter={editing}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          setEditing(null);
          if (id) {
            setShown(id);
            window.history.replaceState(null, "", `/story/?chapter=${id}`);
          }
        }}
        onDeleted={(id) => {
          setEditing(null);
          const i = keys.indexOf(id);
          const prev = keys[Math.max(0, i - 1)] ?? COVER;
          setShown(prev);
          window.history.replaceState(null, "", prev === COVER ? "/story/" : `/story/?chapter=${prev}`);
        }}
      />
      <PhotoViewer viewing={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
