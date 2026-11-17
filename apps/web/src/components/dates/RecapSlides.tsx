"use client";

import { motion, useReducedMotion } from "motion/react";
import { useMemo, type CSSProperties, type ReactNode } from "react";

import { Artwork } from "@/components/media";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon, type PixelIconName } from "@/components/pixel/PixelIcon";
import { fmtCount, fmtHours, hourLabel } from "@/lib/dateMath";
import type { Recap, RecapHighlight, RecapNoteView, Slide, SourcedFigure } from "@/lib/dates";
import type { User } from "@/lib/types";

import { HourBars } from "./HourBars";
import { fmtDay, fmtMonthName } from "./parts";

export type SlideTheme = {
  sky: string;
  text: string;
  muted: string;
  card: string;
  line: string;
  bar: string;
  far: string;
  near: string;
  window: string;
  lit: string;
  stars: string[];
};

export const SLIDE_THEMES: Record<"day" | "night", SlideTheme> = {
  night: {
    sky: "linear-gradient(180deg, #0d0f2b 0%, #15163b 55%, #1c1a3d 100%)",
    text: "#f8f2fb",
    muted: "#cfc6ea",
    card: "rgba(255,255,255,0.08)",
    line: "rgba(245,238,248,0.14)",
    bar: "#d96a8b",
    far: "#24224f",
    near: "#2e2b61",
    window: "#36326f",
    lit: "#ffcf7a",
    stars: ["#ffffff", "#ffe6a7", "#c9b8f0"],
  },
  day: {
    sky: "linear-gradient(180deg, #9fcbee 0%, #cfe3f3 40%, #f9dccb 78%, #fff7f0 100%)",
    text: "#2c2340",
    muted: "#4f4466",
    card: "rgba(255,255,255,0.62)",
    line: "rgba(59,47,63,0.12)",
    bar: "#a8445e",
    far: "#d6d0ea",
    near: "#c3bbdc",
    window: "#eeebf8",
    lit: "#fff4cf",
    stars: [],
  },
};

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Skyline({ seed, theme }: { seed: number; theme: SlideTheme }) {
  const rects = useMemo(() => {
    const r = random(seed);
    const out: { x: number; y: number; w: number; h: number; c: string }[] = [];
    const W = 90;
    const H = 160;
    for (let i = 0; i < theme.stars.length * 6; i++) {
      const zone = r();
      const x = zone < 0.4 ? Math.floor(r() * W) : zone < 0.7 ? Math.floor(r() * 5) : W - 1 - Math.floor(r() * 5);
      const y = zone < 0.4 ? Math.floor(r() * 8) : 10 + Math.floor(r() * 110);
      out.push({ x, y, w: 1, h: 1, c: theme.stars[i % theme.stars.length] });
    }
    for (const [row, color, base] of [
      [0, theme.far, 12],
      [1, theme.near, 6],
    ] as const) {
      let x = -2;
      while (x < W) {
        const w = 5 + Math.floor(r() * 8);
        const h = base + Math.floor(r() * (row ? 8 : 10));
        out.push({ x, y: H - h, w, h, c: color });
        if (row === 1) {
          for (let wy = H - h + 3; wy < H - 2; wy += 3) {
            for (let wx = x + 1; wx < x + w - 1; wx += 2) out.push({ x: wx, y: wy, w: 1, h: 1, c: r() < 0.3 ? theme.lit : theme.window });
          }
        }
        x += w + Math.floor(r() * 2);
      }
    }
    return out;
  }, [seed, theme]);
  return (
    <svg aria-hidden viewBox="0 0 90 160" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" className="pointer-events-none absolute inset-0 size-full">
      {rects.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.c} />
      ))}
    </svg>
  );
}

const card = (t: SlideTheme): CSSProperties => ({ background: t.card, borderColor: t.line });

function Label({ children, t }: { children: ReactNode; t: SlideTheme }) {
  return (
    <p className="text-[13px] font-extrabold uppercase tracking-[0.08em]" style={{ color: t.muted }}>
      {children}
    </p>
  );
}

function Hero({ value, sub, t }: { value: ReactNode; sub?: ReactNode; t: SlideTheme }) {
  return (
    <div>
      <div className="text-[64px] font-extrabold leading-[0.95]">{value}</div>
      {sub && (
        <div className="mt-1 text-[15px] font-bold" style={{ color: t.muted }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, t }: { label: string; value: ReactNode; t: SlideTheme }) {
  return (
    <div className="rounded-[10px] border-2 px-3 py-2" style={card(t)}>
      <div className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: t.muted }}>
        {label}
      </div>
      <div className="text-[22px] font-extrabold leading-tight">{value}</div>
    </div>
  );
}

function TrackLine({ rank, title, artists, art, value, t }: { rank?: number; title: string; artists: string[]; art: string | null; value?: ReactNode; t: SlideTheme }) {
  return (
    <li className="flex items-center gap-3">
      {rank != null && (
        <span className="w-4 shrink-0 text-center text-sm font-extrabold" style={{ color: t.muted }}>
          {rank}
        </span>
      )}
      <Artwork src={art} eager className="size-12 shrink-0 rounded-[6px] shadow-[0_6px_14px_rgba(10,8,30,0.3)]" />
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-[15px] font-extrabold">
          {title}
        </span>
        <span dir="auto" className="block truncate text-[13px] font-semibold" style={{ color: t.muted }}>
          {artists.join(", ")}
        </span>
      </span>
      {value != null && <span className="shrink-0 text-sm font-extrabold">{value}</span>}
    </li>
  );
}

function Paper({ note, name }: { note: RecapNoteView; name: string }) {
  return (
    <div className="rotate-[-1.5deg] rounded-[6px] bg-[#fff8ec] p-4 text-[#3b2f2a] shadow-[0_10px_24px_rgba(10,8,30,0.3)]">
      <p dir="auto" className="whitespace-pre-wrap font-hand text-[24px] leading-snug">
        {note.body}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold opacity-70">From {name}</span>
        {note.placeholder && <PlaceholderMark />}
      </div>
    </div>
  );
}

const highlightsOf = (detail: unknown): RecapHighlight[] => {
  const list = Array.isArray(detail) ? detail : detail && typeof detail === "object" ? [detail] : [];
  return list.filter((d): d is RecapHighlight => !!d && typeof d === "object" && typeof (d as RecapHighlight).title === "string");
};

function Polaroid({ h }: { h: RecapHighlight }) {
  const reduced = useReducedMotion();
  return (
    <figure className="mx-auto w-[86%] rotate-[2deg] rounded-[4px] bg-white p-3 pb-4 text-[#3b2f2a] shadow-[0_14px_30px_rgba(10,8,30,0.35)]">
      <div className="aspect-square overflow-hidden bg-[#e9e2d6]">
        {h.photo_url && (
          <motion.img
            src={h.photo_url}
            alt=""
            className="size-full object-cover"
            initial={{ scale: 1.12, x: "-3%" }}
            animate={reduced ? { scale: 1.12, x: "-3%" } : { scale: 1.02, x: "3%" }}
            transition={{ duration: 9, ease: "easeInOut" }}
          />
        )}
      </div>
      <figcaption className="mt-3">
        <p dir="auto" className="font-hand text-[24px] leading-tight">
          {h.title}
        </p>
        {h.caption && (
          <p dir="auto" className="mt-1 text-[13px] font-semibold opacity-75">
            {h.caption}
          </p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          {h.date && <span className="text-[12px] font-bold opacity-60">{fmtDay(h.date)}</span>}
          {h.placeholder && <PlaceholderMark />}
        </div>
      </figcaption>
    </figure>
  );
}

const EXCHANGE: [string, string, PixelIconName][] = [
  ["card", "Song cards", "notes"],
  ["mixtape", "Mixtape songs", "cassette"],
  ["dedication", "Dedications", "mic"],
  ["swap", "Song swaps", "record"],
];

function SlideBody({ slide, recap, members, t, total }: { slide: Slide; recap: Recap; members: User[]; t: SlideTheme; total: number }) {
  const name = (id: string) => members.find((u) => u.id === id)?.display_name ?? "";
  const year = recap.period === "year";
  switch (slide.kind) {
    case "cover":
      return (
        <div className="flex h-full flex-col">
          <Label t={t}>{year ? "Year recap" : "Monthly recap"}</Label>
          <div className="mt-auto mb-auto">
            <PixelIcon name={year ? "rings" : "recap"} size={96} />
            {year ? (
              <>
                <h2 className="mt-4 font-display text-[52px] font-semibold leading-none">Our year</h2>
                <p className="mt-2 text-[17px] font-bold" style={{ color: t.muted }}>
                  {fmtDay(recap.starts_on)} – {fmtDay(recap.ends_on)}
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-4 font-display text-[56px] font-semibold leading-none">{fmtMonthName(recap.starts_on)}</h2>
                <p className="mt-1 font-display text-[28px] font-semibold" style={{ color: t.muted }}>
                  {recap.starts_on.slice(0, 4)}
                </p>
              </>
            )}
            <p dir="auto" className="mt-4 text-[17px] font-extrabold">
              {year ? members.map((u) => u.display_name).join(" & ") : slide.data.name}
            </p>
          </div>
          <p className="text-[12px] font-bold" style={{ color: t.muted }}>
            {total} slides
          </p>
        </div>
      );
    case "listening": {
      const d = slide.data;
      return (
        <div className="grid grid-cols-1 gap-5">
          <Label t={t}>Minutes listened</Label>
          <Hero value={fmtCount(d.totals.minutes)} sub={fmtHours(d.totals.minutes)} t={t} />
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Plays" value={fmtCount(d.totals.plays)} t={t} />
            <Tile label="Songs" value={fmtCount(d.totals.songs)} t={t} />
            <Tile label="Days" value={fmtCount(d.totals.days)} t={t} />
            <Tile label="Longest streak" value={`${d.longest_streak} ${d.longest_streak === 1 ? "day" : "days"}`} t={t} />
          </div>
          {d.top_hour >= 0 && (
            <div className="rounded-[10px] border-2 px-3 pb-2 pt-9" style={card(t)}>
              <HourBars hours={d.hours} color={t.bar} height={72} />
              <p className="mt-1 text-[13px] font-extrabold">Top hour {hourLabel(d.top_hour)}</p>
            </div>
          )}
        </div>
      );
    }
    case "top_songs":
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>Top songs</Label>
          <ol className="grid grid-cols-1 gap-3">
            {slide.data.tracks.map((s, i) => (
              <TrackLine key={s.id} rank={i + 1} title={s.title} artists={s.artists} art={s.artwork_thumb_url ?? s.artwork_url} value={s.plays} t={t} />
            ))}
          </ol>
        </div>
      );
    case "top_artists":
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>Top artists</Label>
          <ol className="grid grid-cols-1 gap-3">
            {slide.data.artists.map((a, i) => (
              <li key={a.id} className="flex items-center gap-3">
                <span className="w-4 shrink-0 text-center text-sm font-extrabold" style={{ color: t.muted }}>
                  {i + 1}
                </span>
                <Artwork src={a.image_url} eager className="size-11 shrink-0 rounded-full" />
                <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
                  {a.name}
                </span>
                <span className="shrink-0 text-sm font-extrabold">{a.plays}</span>
              </li>
            ))}
          </ol>
          {slide.data.genres.length > 0 && (
            <>
              <Label t={t}>Top genres</Label>
              <ul className="flex flex-wrap gap-2">
                {slide.data.genres.slice(0, 6).map((g) => (
                  <li key={g.name} dir="auto" className="rounded-full border-2 px-3 py-1 text-[13px] font-extrabold first-letter:uppercase" style={card(t)}>
                    {g.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      );
    case "together": {
      const d = slide.data;
      return (
        <div className="grid grid-cols-1 gap-5">
          <Label t={t}>Together</Label>
          <PixelIcon name="headphones" size={60} />
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Minutes together" value={fmtCount(d.minutes_together)} t={t} />
            <Tile label="Songs exchanged" value={fmtCount(d.exchanged.total)} t={t} />
            <Tile label="Liked by both" value={fmtCount(d.both_liked)} t={t} />
            <Tile label="Taste match" value={d.taste_match == null ? "—" : `${d.taste_match}%`} t={t} />
          </div>
          {d.our_song.track && (
            <div className="rounded-[10px] border-2 p-3" style={card(t)}>
              <p className="text-[11px] font-extrabold uppercase tracking-wide" style={{ color: t.muted }}>
                Our song
              </p>
              <ul className="mt-2 grid gap-3">
                <TrackLine title={d.our_song.track.title} artists={d.our_song.track.artists} art={d.our_song.track.artwork_thumb_url ?? d.our_song.track.artwork_url} t={t} />
              </ul>
              <p className="mt-2 text-[13px] font-bold" style={{ color: t.muted }}>
                {d.our_song.plays.map((p) => `${name(p.user_id)} ${p.plays}`).join(" · ")}
              </p>
            </div>
          )}
        </div>
      );
    }
    case "together_minutes":
      return (
        <div className="grid grid-cols-1 gap-5">
          <Label t={t}>Minutes listened together</Label>
          <PixelIcon name="headphones" size={72} />
          <Hero value={fmtCount(slide.data.minutes)} sub={fmtHours(slide.data.minutes)} t={t} />
          {slide.data.taste_match != null && <Tile label="Taste match" value={`${slide.data.taste_match}%`} t={t} />}
        </div>
      );
    case "shared_songs":
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>Top shared songs</Label>
          <ol className="grid grid-cols-1 gap-3">
            {slide.data.tracks.map((s, i) => (
              <TrackLine
                key={s.id}
                rank={i + 1}
                title={s.title}
                artists={s.artists}
                art={s.artwork_thumb_url ?? s.artwork_url}
                value={Object.values(s.plays).reduce((a, b) => a + b, 0)}
                t={t}
              />
            ))}
          </ol>
        </div>
      );
    case "exchanged": {
      const d = slide.data;
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>Songs exchanged</Label>
          <Hero value={fmtCount(d.total)} t={t} />
          <ul className="grid grid-cols-2 gap-2">
            {EXCHANGE.map(([k, label, icon]) => (
              <li key={k} className="flex items-center gap-2 rounded-[10px] border-2 px-2.5 py-2" style={card(t)}>
                <PixelIcon name={icon} size={24} />
                <span className="min-w-0">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wide" style={{ color: t.muted }}>
                    {label}
                  </span>
                  <span className="block text-[18px] font-extrabold leading-tight">{fmtCount(d.by_kind[k] ?? 0)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-4 gap-2">
            {d.recent.slice(0, 8).map((s) => (
              <Artwork key={s.id} src={s.track.artwork_thumb_url ?? s.track.artwork_url} eager className="aspect-square w-full rounded-[6px]" />
            ))}
          </div>
        </div>
      );
    }
    case "highlight": {
      const items = highlightsOf(slide.data.detail);
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>{slide.data.label}</Label>
          {items.length === 1 && items[0].photo_url ? (
            <Polaroid h={items[0]} />
          ) : (
            <ul className="grid grid-cols-1 gap-3">
              {items.slice(0, 6).map((h, i) => (
                <li key={i} className="flex items-center gap-3 rounded-[10px] border-2 px-3 py-2.5" style={card(t)}>
                  <PixelIcon name={slide.data.key.includes("letter") ? "seal" : "star"} size={24} />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-[16px] font-extrabold">
                      {h.title}
                    </span>
                    {h.date && (
                      <span className="block text-[13px] font-semibold" style={{ color: t.muted }}>
                        {fmtDay(h.date)}
                      </span>
                    )}
                  </span>
                  {h.placeholder && <PlaceholderMark />}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "figures":
      return (
        <div className="grid grid-cols-1 gap-4">
          <Label t={t}>{year ? "This year" : "This month"}</Label>
          <ul className="grid grid-cols-1 gap-2">
            {slide.data.figures.map((f: SourcedFigure) => (
              <li key={`${f.source}:${f.key}`} className="flex items-center justify-between gap-3 rounded-[10px] border-2 px-3 py-2.5" style={card(t)}>
                <span className="text-[15px] font-extrabold">{f.label}</span>
                <span className="text-[26px] font-extrabold leading-none">{fmtCount(f.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "note":
      return (
        <div className="flex h-full flex-col">
          <Label t={t}>Note</Label>
          <div className="my-auto">
            <Paper note={slide.data} name={name(slide.data.author_id)} />
          </div>
        </div>
      );
    case "notes":
      return (
        <div className="flex h-full flex-col">
          <Label t={t}>Notes</Label>
          <div className="my-auto grid grid-cols-1 gap-6">
            {slide.data.notes.map((n) => (
              <Paper key={n.author_id} note={n} name={name(n.author_id)} />
            ))}
          </div>
        </div>
      );
  }
}

export function SlideCard({
  slide,
  index,
  recap,
  members,
  theme,
  slideRef,
}: {
  slide: Slide;
  index: number;
  recap: Recap;
  members: User[];
  theme: "day" | "night";
  slideRef?: (el: HTMLDivElement | null) => void;
}) {
  const t = SLIDE_THEMES[theme];
  const seed = Number(recap.starts_on.replaceAll("-", "")) + index * 7919;
  return (
    <div ref={slideRef} className="relative size-full overflow-hidden rounded-[18px]" style={{ background: t.sky, color: t.text }}>
      <Skyline seed={seed} theme={t} />
      <div className="relative flex h-full flex-col px-6 pb-[26%] pt-10">
        <SlideBody slide={slide} recap={recap} members={members} t={t} total={recap.slides.length} />
      </div>
      <div className="absolute bottom-3 left-4 flex items-center gap-1.5 text-[12px] font-extrabold" style={{ color: theme === "night" ? t.muted : "#3b2f3f" }}>
        <PixelIcon name="record" size={24} />
        Jobbos
      </div>
    </div>
  );
}
