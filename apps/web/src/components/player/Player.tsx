"use client";

import { ChevronDown, ListMusic, MicVocal, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useDragControls } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { gentle, soft } from "@/lib/motion";
import { EFFECT_LABELS, EQ_PRESET_LABELS, usePrefs } from "@/lib/prefs";
import { useTrackDetail } from "@/lib/queries";
import { useAlbumColors } from "@/lib/theme";
import type { Track } from "@/lib/types";
import { collapse, expand, togglePanel } from "@/player/controls";
import { selectCurrent, usePlayer, type Panel, type PlayContext, type QueueItem } from "@/player/store";

import { DedicationMark } from "../Dedications";
import { Artwork, LevelMeter } from "../media";
import { TrackMenu } from "../tracks";
import { IconButton } from "../ui";
import { LyricsPanel } from "./LyricsPanel";
import { QueuePanel } from "./QueuePanel";
import { SongNotes } from "./SongNotes";
import { SoundPanel, useSleepRemaining } from "./SoundPanel";
import { LikeButton, NextButton, PlayButton, PrevButton, RepeatButton, ShuffleButton, VolumeControl } from "./Transport";
import { ProgressLine, Waveform } from "./Waveform";

const CONTEXT_LABELS: Record<PlayContext["type"], string> = {
  playlist: "Playlist",
  album: "Album",
  artist: "Artist",
  likes: "Likes",
  history: "History",
  search: "Search",
  queue: "Queue",
};

function useCurrent(): { item: QueueItem | null; track: Track | null } {
  const item = usePlayer(selectCurrent);
  const detail = useTrackDetail(item?.track.id ?? null);
  const track = useMemo(() => {
    if (!item) return null;
    return detail.data?.id === item.track.id ? { ...item.track, ...detail.data } : item.track;
  }, [item, detail.data]);
  return { item, track };
}

function tintStyle(accent: string | null): CSSProperties {
  return { "--tint": accent ?? "var(--accent)" } as CSSProperties;
}

const swap = {
  enter: (d: number) => ({ x: `${d * 40}%`, opacity: 0, filter: "blur(8px)" }),
  center: { x: "0%", opacity: 1, filter: "blur(0px)" },
  exit: (d: number) => ({ x: `${d * -40}%`, opacity: 0, filter: "blur(8px)" }),
};

function SwapArtwork({ uid, src, eager }: { uid: string; src: string | null; eager?: boolean }) {
  const direction = usePlayer((s) => s.direction);
  return (
    <AnimatePresence initial={false} custom={direction} mode="popLayout">
      <motion.div
        key={uid}
        custom={direction}
        variants={swap}
        initial="enter"
        animate="center"
        exit="exit"
        transition={soft}
        className="absolute inset-0"
      >
        <Artwork src={src} className="size-full" eager={eager} />
      </motion.div>
    </AnimatePresence>
  );
}

export function PlayerDock() {
  const expanded = usePlayer((s) => s.expanded);
  const loaded = usePlayer((s) => s.index >= 0);
  const pathname = usePathname();
  useEffect(() => {
    if (usePlayer.getState().expanded) collapse();
  }, [pathname]);
  return (
    <LayoutGroup id="player">
      <AnimatePresence initial={false}>{loaded && (expanded ? <NowPlaying key="full" /> : <MiniPlayer key="mini" />)}</AnimatePresence>
    </LayoutGroup>
  );
}

function MiniPlayer() {
  const { item, track } = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const { accent } = useAlbumColors(track?.palette);
  if (!item || !track) return null;
  return (
    <motion.div
      layoutId="player-surface"
      transition={gentle}
      onPanEnd={(_, info) => {
        if (info.offset.y < -30 || info.velocity.y < -400) expand();
      }}
      style={{ borderRadius: 24, ...tintStyle(accent) }}
      className="glass fixed inset-x-2 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-40 overflow-hidden shadow-soft [touch-action:pan-x] lg:inset-x-auto lg:bottom-4 lg:left-[calc(16rem+1.5rem)] lg:right-6"
    >
      <div className="flex items-center gap-2 p-2 lg:gap-4 lg:px-3">
        <button
          id="mini-expand"
          type="button"
          onClick={() => expand()}
          aria-expanded={false}
          aria-label={`Expand player, ${track.title}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-button text-start lg:max-w-72 lg:flex-none lg:basis-72"
        >
          <motion.div layoutId="player-artwork" transition={gentle} style={{ borderRadius: 12 }} className="relative size-12 shrink-0 overflow-hidden shadow-soft">
            <SwapArtwork uid={item.uid} src={track.artwork_thumb_url} />
          </motion.div>
          <span className="min-w-0">
            <motion.span layoutId="player-title" transition={gentle} className="flex items-center gap-2">
              <span dir="auto" className="truncate font-bold">
                {track.title}
              </span>
              <LevelMeter playing={playing} className="shrink-0 text-tint" />
            </motion.span>
            <span dir="auto" className="block truncate text-sm font-semibold text-muted">
              {track.artists.join(", ")}
            </span>
          </span>
        </button>
        <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
          <PrevButton size="sm" />
          <PlayButton size="md" />
          <NextButton size="sm" />
          <Waveform compact peaks={track.audio?.waveform} duration={duration} className="mx-2 min-w-0 flex-1" />
          <MiniTime duration={duration} />
        </div>
        <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
          <LikeButton trackId={track.id} size="sm" />
          <IconButton label="Lyrics" size="sm" onClick={() => expand("lyrics")}>
            <MicVocal />
          </IconButton>
          <IconButton label="Queue" size="sm" onClick={() => expand("queue")}>
            <ListMusic />
          </IconButton>
          <VolumeControl />
        </div>
        <div className="flex items-center lg:hidden">
          <PlayButton size="sm" />
          <NextButton />
        </div>
      </div>
      <ProgressLine duration={duration} className="lg:hidden" />
    </motion.div>
  );
}

function MiniTime({ duration }: { duration: number }) {
  const position = usePlayer((s) => Math.floor(s.position));
  return (
    <span className="tabular w-[86px] shrink-0 text-end text-[13px] font-bold text-muted">
      {fmtTime(position)} / {fmtTime(duration)}
    </span>
  );
}

function ActiveSound() {
  const { effect, vinyl, eqPreset } = usePrefs(useShallow((p) => ({ effect: p.effect, vinyl: p.vinyl, eqPreset: p.eqPreset })));
  const sleep = usePlayer((s) => s.sleep);
  const remaining = useSleepRemaining(sleep);
  const chips = [
    effect !== "none" && EFFECT_LABELS[effect],
    vinyl && "Vinyl",
    eqPreset !== "flat" && `EQ ${EQ_PRESET_LABELS[eqPreset]}`,
    sleep && (remaining != null ? `Sleep ${fmtTime(remaining)}` : sleep.mode === "track" ? "Sleep: end of song" : "Sleep: end of queue"),
  ].filter((c): c is string => !!c);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => togglePanel("sound")}
          className="tabular rounded-full bg-tint/20 px-2.5 py-1 text-xs font-extrabold text-ink"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

const PANELS: [Exclude<Panel, null>, string, typeof MicVocal][] = [
  ["lyrics", "Lyrics", MicVocal],
  ["queue", "Queue", ListMusic],
  ["sound", "Sound", SlidersHorizontal],
];

function PanelBody({ panel, trackId }: { panel: Exclude<Panel, null>; trackId: string }) {
  if (panel === "queue") return <QueuePanel />;
  if (panel === "sound") return <SoundPanel />;
  return <LyricsPanel trackId={trackId} />;
}

function NowPlaying() {
  const { item, track } = useCurrent();
  const { panel, duration, context, expanded } = usePlayer(
    useShallow((s) => ({ panel: s.panel, duration: s.duration, context: s.context, expanded: s.expanded })),
  );
  const { accent, wash } = useAlbumColors(track?.palette);
  const dragControls = useDragControls();
  const collapseButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    collapseButton.current?.focus({ preventScroll: true });
    const content = document.getElementById("app-content");
    content?.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      content?.removeAttribute("inert");
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => document.getElementById("mini-expand")?.focus({ preventScroll: true }));
    };
  }, [expanded]);

  if (!item || !track) return null;
  const desktopPanel = panel ?? "lyrics";
  const background = wash
    ? `linear-gradient(180deg, color-mix(in oklab, ${wash} 46%, var(--bg)) 0%, color-mix(in oklab, ${wash} 16%, var(--bg)) 55%, var(--bg) 100%)`
    : "var(--bg)";

  return (
    <>
      <motion.div
        aria-hidden
        className={cn("fixed inset-0 z-50 hidden bg-[#1e1b3a]/30 backdrop-blur-sm lg:block", !expanded && "pointer-events-none")}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={collapse}
      />
      <motion.section
        layoutId="player-surface"
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        transition={gentle}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.06, bottom: 0.75 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 70 || info.velocity.y > 600) collapse();
        }}
        style={{ borderRadius: 32, background, ...tintStyle(accent) }}
        className={cn("fixed inset-0 z-50 flex flex-col overflow-hidden shadow-soft lg:inset-6 lg:mx-auto lg:max-w-6xl", !expanded && "pointer-events-none")}
      >
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),10px)] lg:px-6 lg:pt-5"
        >
          <IconButton ref={collapseButton} label="Collapse player" aria-expanded onClick={collapse}>
            <ChevronDown />
          </IconButton>
          <div className="min-w-0 flex-1 text-center">
            {context && (
              <>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted">{CONTEXT_LABELS[context.type]}</div>
                <div dir="auto" className="truncate text-sm font-bold">
                  {context.name}
                </div>
              </>
            )}
          </div>
          <TrackMenu track={track} className="size-11" />
        </motion.header>

        <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:px-10 lg:pb-8">
          <div className={cn("flex min-h-0 flex-col px-6 pb-[max(env(safe-area-inset-bottom),18px)] lg:px-0 lg:pb-0", panel && "max-lg:hidden")}>
            <div
              className="grid min-h-0 flex-1 place-items-center py-3 [container-type:size] [touch-action:none]"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <motion.div
                layoutId="player-artwork"
                transition={gentle}
                style={{ borderRadius: 28, width: "min(100cqw, 100cqh, 560px)", height: "min(100cqw, 100cqh, 560px)" }}
                className="relative overflow-hidden shadow-soft"
              >
                <SwapArtwork uid={item.uid} src={track.artwork_url ?? track.artwork_thumb_url} eager />
              </motion.div>
            </div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={soft} className="grid grid-cols-1 gap-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <motion.div layoutId="player-title" transition={gentle} dir="auto" className="truncate font-display text-[26px] font-semibold leading-tight">
                    {track.title}
                  </motion.div>
                  <div dir="auto" className="truncate text-[17px] font-bold text-muted">
                    {track.artists.join(", ")}
                  </div>
                </div>
                <DedicationMark track={track} className="size-11" />
                <LikeButton trackId={track.id} />
              </div>
              <SongNotes track={track} />
              <Waveform peaks={track.audio?.waveform} duration={duration} />
              <div className="flex items-center justify-between">
                <ShuffleButton />
                <PrevButton size="lg" />
                <PlayButton size="lg" />
                <NextButton size="lg" />
                <RepeatButton />
              </div>
              <ActiveSound />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 lg:hidden">
                  {PANELS.map(([key, label, Icon]) => (
                    <IconButton key={key} label={label} onClick={() => togglePanel(key)}>
                      <Icon />
                    </IconButton>
                  ))}
                </div>
                <VolumeControl className="ms-auto" />
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn("min-h-0 flex-col max-lg:px-4 max-lg:pb-[max(env(safe-area-inset-bottom),12px)] lg:flex", panel ? "flex" : "hidden")}
          >
            <div role="tablist" aria-label="Player panels" className="mb-3 flex items-center gap-1">
              {PANELS.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={desktopPanel === key}
                  onClick={() => usePlayer.setState({ panel: key })}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors",
                    desktopPanel === key ? "bg-ink text-bg" : "text-ink hover:bg-accent-soft/50",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
              <IconButton label="Close panel" size="sm" className="ms-auto lg:hidden" onClick={() => usePlayer.setState({ panel: null })}>
                <X />
              </IconButton>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <PanelBody panel={desktopPanel} trackId={track.id} />
            </div>
            {panel && (
              <div className="mt-2 flex items-center gap-3 rounded-card bg-surface-solid/60 p-2 lg:hidden">
                <div className="relative size-11 shrink-0 overflow-hidden rounded-chip">
                  <Artwork src={track.artwork_thumb_url} className="size-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate font-bold">
                    {track.title}
                  </div>
                  <ProgressLine duration={duration} className="mt-1.5 rounded-full" />
                </div>
                <PlayButton size="sm" />
              </div>
            )}
          </motion.div>
        </div>
      </motion.section>
    </>
  );
}
