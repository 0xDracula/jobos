"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Cloud, Ellipsis, Moon, Sun } from "lucide-react";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { avatarFrames } from "@/avatar/draw";
import { lookOf, type AvatarLook } from "@/avatar/look";
import type { AvatarFrames } from "@/avatar/types";
import { ContinueHere } from "@/components/ContinueHere";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMixtapes, useRoomConfig, useStars } from "@/lib/gift";
import { usePrefs } from "@/lib/prefs";
import { usePlaylist, useTrackDetail } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { socialApi, socialKeys, usePresence } from "@/lib/social";
import { purr, uiSound } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import { useTogether } from "@/lib/together";
import type { Weather } from "@/lib/types";
import { expand, playTracks } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";

import { holidayDecorations, inHoliday, isWeekend, milestoneToday, plantStage, seasonAt, UNLOCKABLES, unlockedIds, weekendMorning, type Season, type Unlockable } from "../calendar";
import { readClockParams, roomClock, roomNow } from "../clock";
import { findNote, useCity, useFavoriteArt, useHiddenNotes, useOtherCity, useRoomLayout, useRoomStats, useWeather } from "../data";
import { hotspotElements, roomView } from "../hotspots";
import { DECORATIONS, DEFAULT_ACCENT, resolveAccent } from "../layout";
import { moodLight, NEUTRAL_LIGHT } from "../light";
import type { KittenPose } from "../pixel/renderer";
import { ROOM_LABELS, type RoomId } from "../pixel/rooms/types";
import { fallbackPlace, skyAt } from "../sky";
import { openSheet, useRoom } from "../state";
import { EditPanel } from "./EditPanel";
import { LoadingKitten } from "./LoadingKitten";
import { RoomSheets } from "./Sheets";
import { SleepOverlay } from "./SleepOverlay";
import { StarDialog } from "./StarCard";

const PixelRoom = dynamic(() => import("../pixel/PixelRoom"), { ssr: false });

type Hotspot = { id: string; label: string; opens?: string; action: () => void; note?: boolean };

const WEATHER_ICON: Record<Weather["condition"], typeof Sun> = {
  clear: Sun,
  clouds: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  thunderstorm: CloudLightning,
};

export const WEATHER_LABELS: Record<Weather["condition"], string> = {
  clear: "Clear",
  clouds: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  snow: "Snow",
  thunderstorm: "Thunderstorm",
};

export function localTime(now: Date, weather: Weather | null | undefined, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (timeZone) {
    try {
      return now.toLocaleTimeString([], { ...opts, timeZone });
    } catch {
    }
  }
  if (!weather) return now.toLocaleTimeString([], opts);
  const shifted = new Date(now.getTime() + weather.utc_offset_s * 1000);
  return shifted.toLocaleTimeString([], { ...opts, timeZone: "UTC" });
}

function useClock(ms: number) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    readClockParams();
    setNow(roomNow());
    const t = setInterval(() => setNow(roomNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useAvatarFrames(look: AvatarLook | null): AvatarFrames | null {
  const [frames, setFrames] = useState<AvatarFrames | null>(null);
  const key = look ? `${look.style}|${look.hair}|${look.skin}|${look.outfit}|${look.glasses}` : "";
  useEffect(() => {
    if (!look) return setFrames(null);
    let dead = false;
    void avatarFrames(look)
      .then((f) => !dead && setFrames(f))
      .catch(() => !dead && setFrames(null));
    return () => {
      dead = true;
    };
  }, [key]);
  return frames;
}

function HotspotButton({ h }: { h: Hotspot }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [label, setLabel] = useState(false);
  const pointed = useRoom((s) => s.highlight === h.id);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    hotspotElements.set(h.id, el);
    return () => {
      hotspotElements.delete(h.id);
    };
  }, [h.id]);
  const show = (on: boolean) => {
    setLabel(on);
    useRoom.setState({ highlight: on ? h.id : null });
  };
  return (
    <button
      ref={ref}
      type="button"
      aria-label={h.opens ? `${h.label}: ${h.opens}` : h.label}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        h.action();
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && show(true)}
      onPointerLeave={() => show(false)}
      onFocus={() => {
        roomView.reveal(h.id);
        show(true);
      }}
      onBlur={() => show(false)}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        pressTimer.current = setTimeout(() => {
          longPressed.current = true;
          show(true);
        }, 450);
      }}
      onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onPointerCancel={() => pressTimer.current && clearTimeout(pressTimer.current)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ visibility: "hidden" }}
      className={cn("group absolute left-0 top-0 -ml-6 -mt-6 grid size-12 place-items-center rounded-full outline-offset-0 [-webkit-touch-callout:none] select-none", label && "z-10")}
    >
      <span
        aria-hidden
        className={cn(
          "size-2.5 rounded-full shadow-[0_0_0_2px_rgba(30,27,58,0.35)] transition-transform group-hover:scale-125 group-focus-visible:scale-125",
          h.note ? "bg-butter" : "bg-white/75",
        )}
      />
      {(label || pointed) && (
        <span className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-xs font-bold text-bg shadow-soft">
          {h.label}
          {h.opens && <span className="font-semibold opacity-75"> · {h.opens}</span>}
        </span>
      )}
    </button>
  );
}

function WindowTag({ id, text, above }: { id: string; text: string; above?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    hotspotElements.set(id, el);
    return () => {
      hotspotElements.delete(id);
    };
  }, [id]);
  return (
    <div ref={ref} aria-hidden style={{ visibility: "hidden" }} className="pointer-events-none absolute left-0 top-0">
      <span
        dir="auto"
        className={cn(
          "block max-w-[9.5rem] -translate-x-1/2 truncate whitespace-nowrap rounded-full bg-[#1e1b3a]/75 px-1.5 text-[10px] font-bold leading-[15px] text-[#f5eef8] shadow-soft",
          above && "-translate-y-full",
        )}
      >
        {text}
      </span>
    </div>
  );
}

const LAMP_EVERY = 10 * 60_000;
const LAMP_KEY = "jobbos.lamp.sent";
const UNLOCK_MS = 2800;

const readNumber = (key: string) => {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
};

export function RoomView() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const meId = me.data?.id ?? "";
  const members = useMembers();
  const now = useClock(30_000);
  const city = useCity();
  const place = city.data?.city ?? null;
  const weatherQuery = useWeather(place);
  const preview = roomClock.weather as Weather["condition"] | null;
  const cover = preview ? { clear: 5, clouds: 85, fog: 60, drizzle: 90, rain: 100, snow: 95, thunderstorm: 100 }[preview] : 0;
  const weather = {
    data: weatherQuery.data && preview ? { ...weatherQuery.data, condition: preview, cloud_cover: cover }
      : preview ? ({ condition: preview, code: 0, temperature_c: 20, cloud_cover: cover, precipitation_mm: 0, wind_kmh: 8, is_day: true, timezone: "", utc_offset_s: -new Date().getTimezoneOffset() * 60, fetched_at: "" } as Weather)
      : weatherQuery.data,
  };
  const other = useOtherCity(place);
  const otherWeather = useWeather(other?.city).data ?? null;
  const stats = useRoomStats();
  const notes = useHiddenNotes();
  const saved = useRoomLayout();
  const draft = useRoom((s) => s.draft);
  const layout = draft ?? saved;
  const room = (roomClock.room ?? layout.room) as RoomId;
  const config = useRoomConfig();
  const fav = useFavoriteArt();
  const presence = usePresence();
  const together = useTogether();
  const mixtapes = useMixtapes();
  const stars = useStars();
  const seasonsOn = usePrefs((p) => p.seasons);
  const motionPref = usePrefs((p) => p.motion);
  const weekendPlaylist = usePrefs((p) => p.weekendPlaylist);
  const osReduced = useReducedMotion();
  const reducedMotion = motionPref === "reduced" || (motionPref === "system" && !!osReduced);
  const expanded = usePlayer((s) => s.expanded);
  const playing = usePlayer((s) => s.playing);
  const sleepMode = useRoom((s) => s.sleepMode);
  const editing = useRoom((s) => s.sheet === "edit");
  const unlocking = useRoom((s) => s.unlocking);
  const openStar = useRoom((s) => s.star);
  const track = usePlayer(selectTrack);
  const detail = useTrackDetail(track?.id ?? null);

  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [visible, setVisible] = useState(true);
  const [wide, setWide] = useState(false);
  const [sentUntil, setSentUntil] = useState(0);
  const loaded = usePlayer((s) => s.index >= 0);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 300);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onWide = () => setWide(mq.matches);
    onWide();
    mq.addEventListener("change", onWide);
    const onVis = () => setVisible(document.visibilityState === "visible");
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", onWide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (s.playing && !prev.playing) setTimeout(() => uiSound("needle"), reducedMotion ? 0 : 450);
        if (!s.playing && prev.playing && s.index >= 0) uiSound("lift");
      }),
    [reducedMotion],
  );

  const unlockables: Unlockable[] = config.data?.unlockables ?? UNLOCKABLES;
  const milestones = useMemo(() => config.data?.milestones ?? [], [config.data]);
  const hours = (stats.data?.listening_seconds ?? 0) / 3600;
  const metrics = useMemo(() => ({ hours, likes: stats.data?.liked_songs ?? 0, days: stats.data?.active_days ?? 0 }), [hours, stats.data]);
  const unlocked = useMemo(() => {
    const set = unlockedIds(metrics, unlockables, milestones);
    if (roomClock.unlock) set.add(roomClock.unlock);
    return set;
  }, [metrics, unlockables, milestones]);
  const settled = !config.isLoading;

  const queue = useRef<string[]>([]);
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    if (!stats.data || !settled) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem("jobbos.unlocks.seen") ?? "[]");
    } catch {
      seen = [];
    }
    const fresh = [...unlocked].filter((id) => !seen.includes(id) && id !== roomClock.unlock);
    if (fresh.length) {
      try {
        localStorage.setItem("jobbos.unlocks.seen", JSON.stringify([...seen, ...fresh]));
      } catch {
      }
    }
    let first = false;
    try {
      first = !seen.length && !localStorage.getItem("jobbos.unlocks.init");
      localStorage.setItem("jobbos.unlocks.init", "1");
    } catch {
      first = false;
    }
    const show = first ? [] : fresh;
    if (roomClock.unlock && !queue.current.includes(roomClock.unlock) && !useRoom.getState().unlocking) show.push(roomClock.unlock);
    if (!show.length) return;
    queue.current.push(...show.filter((id) => DECORATIONS.some((d) => d.id === id)));
    setQueued((n) => n + 1);
  }, [unlocked, stats.data, settled]);
  useEffect(() => {
    if (!ready || unlocking || !queue.current.length) return;
    const id = queue.current.shift()!;
    useRoom.setState({ unlocking: { id, at: Date.now() } });
    roomView.revealDecoration(id);
    uiSound("chime");
    const label = unlockables.find((u) => u.id === id)?.label ?? DECORATIONS.find((d) => d.id === id)?.label ?? "";
    const t = setTimeout(() => {
      useRoom.setState({ unlocking: null });
      toast(`Unlocked: ${label}`, { label: "Place it", run: () => useRoom.setState({ sheet: "edit", draft: structuredClone(saved), selected: id }) });
    }, UNLOCK_MS);
    return () => clearTimeout(t);
  }, [ready, unlocking, queued, unlockables, saved]);

  const fallback = useMemo(() => (now ? fallbackPlace(now) : { lat: 30, lon: 31 }), [now]);
  const lat = place?.lat ?? fallback.lat;
  const lon = place?.lon ?? fallback.lon;
  const seasonPreview = roomClock.season;
  const season: Season | null = seasonPreview ? (seasonPreview === "off" ? null : (seasonPreview as Season)) : seasonsOn && now ? seasonAt(now, lat) : null;
  const sky = useMemo(() => (now ? skyAt(now, lat, lon) : null), [now, lat, lon]);
  const otherSky = useMemo(() => (now && other ? skyAt(now, other.city.lat, other.city.lon) : null), [now, other]);
  const weekend = now ? isWeekend(now) : false;
  const morning = roomClock.weekend ? 1 : now ? weekendMorning(now) : 0;
  const weekendTray = roomClock.weekend || (!!now && weekend && now.getHours() >= 6 && now.getHours() < 15);
  const weekendList = usePlaylist(weekend ? weekendPlaylist : null);
  const holidays = useMemo(() => config.data?.holidays ?? [], [config.data]);
  const holidayNow = now ? holidays.filter((h) => inHoliday(h, now)) : [];
  const decorations = useMemo(() => roomClock.holiday ?? (now ? holidayDecorations(holidays, now) : []), [holidays, now]);
  const holidayList = usePlaylist(holidayNow.find((h) => h.playlist_id)?.playlist_id ?? null);
  const milestoneDay = roomClock.milestone || (!!now && !!milestoneToday(milestones, now));

  const accent = resolveAccent(layout.look.accent, fav.accent);
  const light = useMemo(
    () => (track ? moodLight(detail.data?.palette ?? track.palette, detail.data?.audio?.energy, detail.data?.audio?.valence) : NEUTRAL_LIGHT),
    [track, detail.data],
  );
  const artwork = detail.data?.artwork_thumb_url ?? track?.artwork_thumb_url ?? track?.artwork_url ?? null;

  const lamps = presence.data?.lamps ?? [];
  const nowMs = Date.now();
  const received = lamps.find((l) => l.to === meId && Date.parse(l.on_until) > nowMs);
  const sentLamp = lamps.find((l) => l.from === meId && Date.parse(l.on_until) > nowMs);
  const sending = !!sentLamp || sentUntil > nowMs;
  const lampSignal = roomClock.lamp ?? (received ? "received" : sending ? "sent" : null);
  const lampOn = (sky?.lamp ?? 0) > 0.5 || !!lampSignal;
  const otherUser = members.data?.find((u) => u.id !== meId) ?? null;
  const lastSent = Math.max(readNumber(LAMP_KEY), ...lamps.filter((l) => l.from === meId).map((l) => Date.parse(l.sent_at) || 0));
  const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const toggleLamp = async () => {
    if (sending) {
      try {
        await socialApi.lamp(false);
        setSentUntil(0);
        toast("Lamp off");
      } catch {
        toast("Lamp unavailable");
      }
      void qc.invalidateQueries({ queryKey: socialKeys.presence });
      return;
    }
    if (lastSent && Date.now() - lastSent < LAMP_EVERY) {
      toast(`Lamp available at ${timeOf(lastSent + LAMP_EVERY)}`);
      return;
    }
    try {
      await socialApi.lamp(true);
      try {
        localStorage.setItem(LAMP_KEY, String(Date.now()));
      } catch {
      }
      setSentUntil(Date.now() + (config.data?.lamp_minutes ?? 60) * 60_000);
      toast(otherUser ? `Lamp on in ${otherUser.display_name}'s room` : "Lamp on");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) toast(`Lamp available at ${timeOf((lastSent || Date.now()) + LAMP_EVERY)}`);
      else if (err instanceof ApiError && err.status === 409) toast(err.message);
      else toast("Lamp unavailable");
    }
    void qc.invalidateQueries({ queryKey: socialKeys.presence });
  };

  const memberOf = (id: string | undefined) => members.data?.find((u) => u.id === id);
  const myLook = meId ? lookOf(meId, memberOf(meId)?.avatar) : null;
  const otherLook = otherUser ? lookOf(otherUser.id, otherUser.avatar) : null;
  const myFrames = useAvatarFrames(myLook);
  const otherFrames = useAvatarFrames(otherLook);
  const person = presence.data?.people.find((p) => p.id === otherUser?.id);
  const otherHere = person?.online === true || roomClock.other || roomClock.together;
  const session = together.data;
  const isTogether =
    roomClock.together || (!!session?.active && !!otherUser && session.members.includes(meId) && session.members.includes(otherUser.id) && otherHere);
  const avatars = useMemo(
    () => ({
      me: myFrames && meId ? { id: meId, frames: myFrames, pose: isTogether ? ("together" as const) : playing || roomClock.listening ? ("listening" as const) : ("idle" as const) } : null,
      other:
        otherFrames && otherUser && otherHere
          ? { id: otherUser.id, frames: otherFrames, pose: isTogether ? ("together" as const) : person?.listening ? ("listening" as const) : ("idle" as const) }
          : null,
      together: isTogether,
    }),
    [myFrames, meId, isTogether, playing, otherFrames, otherUser, otherHere, person?.listening],
  );

  const wrapped = mixtapes.data?.find((m) => m.to_user === meId && !m.opened_at) ?? null;
  const songStars = useMemo(() => (stars.data ?? []).map((s) => ({ id: s.id, at: s.at })), [stars.data]);
  const starOpen = stars.data?.find((s) => s.id === openStar) ?? null;

  const openNote = async (spot: string) => {
    const note = notes.data?.find((n) => n.spot === spot && !n.found);
    if (!note) return;
    try {
      const found = await findNote(note.id);
      uiSound("paper");
      useRoom.setState({ reveal: found });
    } catch {
      toast("Note unavailable");
    }
  };

  const night = (sky?.night ?? 0) > 0.5;
  const noteSpots = useMemo(() => new Set<string>((notes.data ?? []).filter((n) => !n.found).map((n) => n.spot)), [notes.data]);
  const hotspots: Hotspot[] = [
    {
      id: "record_player",
      label: "Record player",
      opens: "Now playing",
      action: () => (usePlayer.getState().index >= 0 ? expand() : router.push("/library/")),
    },
    { id: "pinned_record", label: "Our song", action: () => router.push("/song/") },
    { id: "records", label: "Records", opens: "Library", action: () => router.push("/library/") },
    wrapped
      ? { id: "cassette", label: "New mixtape", action: () => router.push(`/mixtapes/?id=${wrapped.id}`) }
      : { id: "cassette", label: "Mixtapes", action: () => router.push("/mixtapes/") },
    { id: "telephone", label: "Chat", action: () => router.push("/chat/") },
    { id: "window", label: "Discover", action: () => router.push("/discover/") },
    { id: "lamp", label: "Lamp", opens: otherUser ? "Shared lamp" : undefined, action: () => void toggleLamp() },
    { id: "bed", label: "Bed", opens: "Sleep mode", action: () => openSheet("sleep") },
    { id: "tea", label: "Listen together", action: () => router.push("/together/") },
    {
      id: "kitten",
      label: "الكوتي",
      action: () => {
        purr();
        useRoom.setState((s) => ({ pets: s.pets + 1, kittenAwakeUntil: Date.now() + 5000 }));
      },
    },
    { id: "plants", label: "Plants", opens: "Growth", action: () => openSheet("growth") },
    { id: "speaker", label: "Speaker", opens: "Ambient sounds", action: () => openSheet("ambient") },
  ];
  for (const a of [avatars.me, avatars.other]) {
    if (a) hotspots.push({ id: `avatar:${a.id}`, label: memberOf(a.id)?.display_name ?? "", opens: "Profile", action: () => router.push(`/profile/?id=${a.id}`) });
  }
  if (other) hotspots.push({ id: "second_window", label: `${other.city.name} window`, opens: "Sky and weather", action: () => openSheet("sky") });
  if (night) {
    hotspots.push({ id: "sky", label: "Night sky", opens: "Star map", action: () => router.push("/stars/") });
    if (!noteSpots.has("moon")) hotspots.push({ id: "moon", label: "Moon", opens: "Star map", action: () => router.push("/stars/") });
  }
  for (const spot of noteSpots) hotspots.push({ id: spot, label: "Hidden note", note: true, action: () => void openNote(spot) });
  const hotspotIds = hotspots.map((h) => h.id);

  const Icon = weather.data && !(weather.data.condition === "clear" && night) ? WEATHER_ICON[weather.data.condition] : night ? Moon : Sun;
  const chip = (sky?.night ?? 1) > 0.5
    ? "border border-white/15 bg-[#1e1b3a]/70 text-[#f5eef8] backdrop-blur-md"
    : "border border-white/60 bg-[#fff7f0]/80 text-[#3b2f3f] backdrop-blur-md";
  const background: CSSProperties = sky ? { background: `linear-gradient(180deg, ${sky.top}, ${sky.horizon})` } : { background: "var(--bg)" };
  const active = visible && !expanded && !sleepMode;
  const playlistChip = (list: typeof weekendList.data, label: string) =>
    list && (
      <MenuItem onSelect={() => playTracks(list.tracks, -1, { type: "playlist", id: list.id, name: list.name }, { shuffle: true })}>{label}</MenuItem>
    );

  return (
    <div className="relative size-full overflow-hidden" style={background}>
      <div className="absolute inset-0">
        {sky && (
          <PixelRoom
            room={room}
            sky={sky}
            weather={weather.data ?? null}
            season={season}
            layout={layout}
            plantStage={plantStage(hours)}
            unlocked={unlocked}
            notes={noteSpots}
            accent={accent}
            light={light}
            artwork={artwork}
            lamp={{ on: lampOn, signal: lampSignal }}
            otherSky={otherSky}
            otherWeather={otherWeather}
            weekendTray={weekendTray}
            weekendMorning={morning}
            favorites={fav}
            holiday={decorations}
            milestoneDay={milestoneDay}
            mixtape={wrapped?.color ?? null}
            avatars={avatars}
            songStars={songStars}
            unlocking={unlocking}
            kittenPose={(roomClock.kitten as KittenPose | null) ?? null}
            reducedMotion={reducedMotion}
            hotspotIds={hotspotIds}
            inset={loaded ? (wide ? 96 : 76) : wide ? 16 : 4}
            active={active}
            playing={playing}
            onActivate={(id) => hotspots.find((h) => h.id === id)?.action()}
            onStar={(id) => useRoom.setState({ star: id })}
            onReady={() => setReady(true)}
          />
        )}
      </div>
      {!ready && slow && <LoadingKitten />}

      {ready && (
        <div className="pointer-events-none absolute inset-0 [&>button]:pointer-events-auto" role="group" aria-label="Room">
          {hotspots.map((h) => (
            <HotspotButton key={h.id} h={h} />
          ))}
          {other && now && (
            <>
              <WindowTag id="window_label" text={[place?.name, localTime(now, weather.data, place?.timezone)].filter(Boolean).join(" · ")} />
              <WindowTag id="second_window_label" above text={`${other.city.name} · ${localTime(now, otherWeather, other.city.timezone)}`} />
            </>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-3 pt-[max(env(safe-area-inset-top),12px)] lg:p-5">
        <button
          type="button"
          onClick={() => openSheet("sky")}
          className={cn("pointer-events-auto flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold shadow-soft", chip)}
        >
          <Icon className="size-4" />
          <span dir="auto">{place?.name ?? "Sky"}</span>
          {now && <span className="tabular font-semibold opacity-75">· {localTime(now, weather.data, place?.timezone)}</span>}
          {weather.data && <span className="tabular font-semibold opacity-75">· {Math.round(weather.data.temperature_c)}°</span>}
        </button>
        {weekend && weekendList.data && (
          <button
            type="button"
            onClick={() => playTracks(weekendList.data!.tracks, -1, { type: "playlist", id: weekendList.data!.id, name: weekendList.data!.name }, { shuffle: true })}
            className={cn("pointer-events-auto hidden min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold shadow-soft sm:flex", chip)}
          >
            Weekend playlist
          </button>
        )}
        <div className="ms-auto pointer-events-auto">
          <Menu modal={false}>
            <MenuTrigger aria-label="Room options" className={cn("grid size-11 place-items-center rounded-full shadow-soft", chip)}>
              <Ellipsis className="size-5" />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => useRoom.setState({ sheet: "edit", draft: structuredClone(saved), selected: null })}>Edit room</MenuItem>
              <MenuItem onSelect={() => openSheet("sky")}>Sky and weather</MenuItem>
              <MenuItem onSelect={() => router.push("/stars/")}>Star map</MenuItem>
              <MenuItem onSelect={() => openSheet("ambient")}>Ambient sounds</MenuItem>
              <MenuItem onSelect={() => openSheet("growth")}>Growth</MenuItem>
              <MenuItem onSelect={() => openSheet("notes")}>Found notes</MenuItem>
              <MenuItem onSelect={() => openSheet("sleep")}>Sleep mode</MenuItem>
              {weekend && playlistChip(weekendList.data, "Weekend playlist")}
              {holidayNow.length > 0 && playlistChip(holidayList.data, `${holidayNow[0].name} playlist`)}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-[calc(max(env(safe-area-inset-top),12px)+56px)] flex justify-center lg:top-20">
        <ContinueHere className="pointer-events-auto w-full max-w-xl" />
      </div>

      <RoomSheets sky={sky} place={place} weather={weather.data ?? null} other={other} otherWeather={otherWeather} metrics={metrics} unlocked={unlocked} unlockables={unlockables} milestones={milestones} />
      <StarDialog star={starOpen} onClose={() => useRoom.setState({ star: null })} />
      {editing && <EditPanel saved={saved} unlocked={unlocked} favoriteAccent={fav.accent ?? DEFAULT_ACCENT} />}
      {sleepMode && <SleepOverlay />}
      <span className="sr-only" aria-live="polite">
        {ROOM_LABELS[room]}
      </span>
    </div>
  );
}
