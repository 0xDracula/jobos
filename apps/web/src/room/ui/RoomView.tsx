"use client";

import { CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, Cloud, Ellipsis, Moon, Sun } from "lucide-react";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ContinueHere } from "@/components/ContinueHere";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/prefs";
import { usePlaylist, useTrackDetail } from "@/lib/queries";
import { purr, uiSound } from "@/lib/sounds";
import { useAlbumColors } from "@/lib/theme";
import { toast } from "@/lib/toast";
import type { Weather } from "@/lib/types";
import { expand, playTracks } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";

import { isWeekend, plantStage, seasonAt, UNLOCKABLES, unlockedIds } from "../calendar";
import { readClockParams, roomClock, roomNow } from "../clock";
import { findNote, useCity, useHiddenNotes, useOtherCity, useRoomLayout, useRoomStats, useWeather } from "../data";
import { hotspotElements, roomView } from "../hotspots";
import { fallbackPlace, skyAt } from "../sky";
import { openSheet, useRoom } from "../state";
import { EditPanel } from "./EditPanel";
import { LoadingKitten } from "./LoadingKitten";
import { RoomSheets } from "./Sheets";
import { SleepOverlay } from "./SleepOverlay";

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

export function localTime(now: Date, weather: Weather | null | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
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

export function RoomView() {
  const router = useRouter();
  const city = useCity();
  const place = city.data?.city ?? null;
  const weatherQuery = useWeather(place);
  const weather = {
    data: weatherQuery.data && roomClock.weather ? { ...weatherQuery.data, condition: roomClock.weather as Weather["condition"] }
      : roomClock.weather ? ({ condition: roomClock.weather, code: 0, temperature_c: 20, cloud_cover: 80, precipitation_mm: 0, wind_kmh: 0, is_day: true, timezone: "", utc_offset_s: -new Date().getTimezoneOffset() * 60, fetched_at: "" } as Weather)
      : weatherQuery.data,
  };
  const other = useOtherCity(place);
  const stats = useRoomStats();
  const notes = useHiddenNotes();
  const saved = useRoomLayout();
  const draft = useRoom((s) => s.draft);
  const layout = draft ?? saved;
  const seasonsOn = usePrefs((p) => p.seasons);
  const motionPref = usePrefs((p) => p.motion);
  const weekendPlaylist = usePrefs((p) => p.weekendPlaylist);
  const osReduced = useReducedMotion();
  const reducedMotion = motionPref === "reduced" || (motionPref === "system" && !!osReduced);
  const expanded = usePlayer((s) => s.expanded);
  const sleepMode = useRoom((s) => s.sleepMode);
  const editing = useRoom((s) => s.sheet === "edit");
  const track = usePlayer(selectTrack);
  const detail = useTrackDetail(track?.id ?? null);
  const { accent } = useAlbumColors(detail.data?.palette ?? track?.palette);
  const now = useClock(30_000);

  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [visible, setVisible] = useState(true);
  const [wide, setWide] = useState(false);
  const loaded = usePlayer((s) => s.index >= 0);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 300);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onWide = () => setWide(mq.matches);
    onWide();
    mq.addEventListener("change", onWide);
    const onVis = () => setVisible(document.visibilityState === "visible");
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
        if (s.playing && !prev.playing) uiSound("needle");
      }),
    [],
  );

  const hours = (stats.data?.listening_seconds ?? 0) / 3600;
  const metrics = useMemo(() => ({ hours, likes: stats.data?.liked_songs ?? 0, days: stats.data?.active_days ?? 0 }), [hours, stats.data]);
  const unlocked = useMemo(() => unlockedIds(metrics), [metrics]);

  useEffect(() => {
    if (!stats.data) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem("jobbos.unlocks.seen") ?? "[]");
    } catch {
      seen = [];
    }
    const fresh = [...unlocked].filter((id) => !seen.includes(id));
    if (!fresh.length) return;
    try {
      localStorage.setItem("jobbos.unlocks.seen", JSON.stringify([...seen, ...fresh]));
    } catch {
    }
    if (seen.length || localStorage.getItem("jobbos.unlocks.init")) {
      useRoom.setState({ unlocked: fresh[0] });
      uiSound("chime");
    }
    try {
      localStorage.setItem("jobbos.unlocks.init", "1");
    } catch {
    }
  }, [unlocked, stats.data]);

  const fallback = useMemo(() => (now ? fallbackPlace(now) : { lat: 30, lon: 31 }), [now]);
  const lat = place?.lat ?? fallback.lat;
  const lon = place?.lon ?? fallback.lon;
  const season = seasonsOn && now ? seasonAt(now, lat) : null;
  const sky = useMemo(() => (now ? skyAt(now, lat, lon) : null), [now, lat, lon]);
  const otherSky = useMemo(() => (now && other ? skyAt(now, other.city.lat, other.city.lon) : null), [now, other]);
  const lampManual = useRoom((s) => s.lampOn);
  const lampOn = lampManual ?? (sky?.lamp ?? 0) > 0.5;
  const weekend = now ? isWeekend(now) : false;
  const weekendTray = !!now && weekend && now.getHours() >= 6 && now.getHours() < 15;
  const weekendList = usePlaylist(weekend ? weekendPlaylist : null);

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

  const hotspots: Hotspot[] = [
    {
      id: "record_player",
      label: "Record player",
      opens: "Now playing",
      action: () => (usePlayer.getState().index >= 0 ? expand() : router.push("/library/")),
    },
    { id: "records", label: "Records", opens: "Library", action: () => router.push("/library/") },
    { id: "window", label: "Window", opens: "Sky and weather", action: () => openSheet("sky") },
    { id: "lamp", label: "Lamp", action: () => useRoom.setState({ lampOn: !lampOn }) },
    { id: "bed", label: "Bed", opens: "Sleep mode", action: () => openSheet("sleep") },
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
  if (other) hotspots.push({ id: "second_window", label: `${other.city.name} window`, opens: "Sky and weather", action: () => openSheet("sky") });
  const noteSpots = useMemo(() => new Set<string>((notes.data ?? []).filter((n) => !n.found).map((n) => n.spot)), [notes.data]);
  for (const spot of noteSpots) hotspots.push({ id: spot, label: "Hidden note", note: true, action: () => void openNote(spot) });
  const hotspotIds = hotspots.map((h) => h.id);

  const Icon = weather.data ? WEATHER_ICON[weather.data.condition] : sky && sky.night > 0.5 ? Moon : Sun;
  const chip = (sky?.night ?? 1) > 0.5
    ? "border border-white/15 bg-[#1e1b3a]/70 text-[#f5eef8] backdrop-blur-md"
    : "border border-white/60 bg-[#fff7f0]/80 text-[#3b2f3f] backdrop-blur-md";
  const background: CSSProperties = sky ? { background: `linear-gradient(180deg, ${sky.top}, ${sky.horizon})` } : { background: "var(--bg)" };
  const active = visible && !expanded && !sleepMode;

  return (
    <div className="relative size-full overflow-hidden" style={background}>
      <div className="absolute inset-0">
        {sky && (
          <PixelRoom
            sky={sky}
            weather={weather.data ?? null}
            season={season}
            layout={layout}
            plantStage={plantStage(hours)}
            unlocked={unlocked}
            notes={noteSpots}
            accent={accent}
            lampOn={lampOn}
            otherSky={otherSky}
            weekendTray={weekendTray}
            reducedMotion={reducedMotion}
            hotspotIds={hotspotIds}
            inset={loaded ? (wide ? 96 : 76) : wide ? 16 : 4}
            active={active}
            onActivate={(id) => hotspots.find((h) => h.id === id)?.action()}
            onReady={() => setReady(true)}
          />
        )}
      </div>
      {!ready && slow && <LoadingKitten />}

      {ready && (
        <div className="pointer-events-none absolute inset-0 [&>*]:pointer-events-auto" role="group" aria-label="Room">
          {hotspots.map((h) => (
            <HotspotButton key={h.id} h={h} />
          ))}
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
          {now && <span className="tabular font-semibold opacity-75">· {localTime(now, weather.data)}</span>}
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
              <MenuItem onSelect={() => openSheet("ambient")}>Ambient sounds</MenuItem>
              <MenuItem onSelect={() => openSheet("growth")}>Growth</MenuItem>
              <MenuItem onSelect={() => openSheet("notes")}>Found notes</MenuItem>
              <MenuItem onSelect={() => openSheet("sleep")}>Sleep mode</MenuItem>
              {weekend && weekendList.data && (
                <MenuItem onSelect={() => playTracks(weekendList.data!.tracks, -1, { type: "playlist", id: weekendList.data!.id, name: weekendList.data!.name }, { shuffle: true })}>
                  Weekend playlist
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-3 top-[calc(max(env(safe-area-inset-top),12px)+56px)] flex justify-center lg:top-20">
        <ContinueHere className="pointer-events-auto w-full max-w-xl" />
      </div>

      <RoomSheets sky={sky} place={place} weather={weather.data ?? null} other={other} metrics={metrics} unlocked={unlocked} unlockables={UNLOCKABLES} />
      {editing && <EditPanel saved={saved} unlocked={unlocked} />}
      {sleepMode && <SleepOverlay />}
    </div>
  );
}
