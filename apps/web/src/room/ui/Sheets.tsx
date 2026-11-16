"use client";

import { Play, Square, Trash } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Dialog } from "@/components/dialogs";
import { Button, Chip, IconButton, inputClass, Slider } from "@/components/ui";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/prefs";
import { useLikes, usePlaylist, usePlaylists } from "@/lib/queries";
import type { City, Track, Weather } from "@/lib/types";
import { playTracks, setSleep } from "@/player/controls";

import { AMBIENT_SOUNDS, setAmbientLevel, setAmbientLevels, startAmbient, stopAmbient, useAmbient, type AmbientId } from "../ambient";
import { METRIC_LABELS, PLANT_STAGES, plantStage, progressOf, type Stats, type Unlockable } from "../calendar";
import { saveAmbientMixes, useAmbientMixes, useHiddenNotes } from "../data";
import { moonPhaseName, PHASE_LABELS, skyAt, type SkyState } from "../sky";
import { roomNow } from "../clock";
import { useRoom } from "../state";
import { localTime, WEATHER_LABELS } from "./RoomView";

const close = () => useRoom.setState({ sheet: null });

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-semibold text-muted">{label}</span>
      <span className="tabular text-end font-bold" dir="auto">
        {value}
      </span>
    </div>
  );
}

const timeOf = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

function SkySection({ title, sky, weather, city }: { title?: string; sky: SkyState | null; weather: Weather | null; city: City | null }) {
  const now = roomNow();
  return (
    <section className="grid gap-1 rounded-card bg-surface-solid/60 p-4">
      {title && (
        <h3 dir="auto" className="font-display text-lg font-semibold">
          {title}
        </h3>
      )}
      <Row label="City" value={city ? [city.name, city.country].filter(Boolean).join(", ") : "Not set"} />
      <Row label="Local time" value={localTime(now, weather)} />
      {sky && <Row label="Sky" value={PHASE_LABELS[sky.phase]} />}
      {weather && <Row label="Weather" value={`${WEATHER_LABELS[weather.condition]}, ${Math.round(weather.temperature_c)}°C`} />}
      {sky && <Row label="Sunrise" value={timeOf(sky.sunrise)} />}
      {sky && <Row label="Sunset" value={timeOf(sky.sunset)} />}
      {sky && <Row label="Moon" value={`${moonPhaseName(sky.moon.phase)}, ${Math.round(sky.moon.fraction * 100)}%`} />}
    </section>
  );
}

function SkySheet({ sky, place, weather, other }: { sky: SkyState | null; place: City | null; weather: Weather | null; other: { name: string; city: City } | null }) {
  const otherSky = other ? skyAt(roomNow(), other.city.lat, other.city.lon) : null;
  return (
    <>
      <div className="grid gap-3">
        <SkySection title={other ? place?.name : undefined} sky={sky} weather={weather} city={place} />
        {other && <SkySection title={`${other.name}: ${other.city.name}`} sky={otherSky} weather={null} city={other.city} />}
      </div>
      <Link href="/settings/#location" onClick={close} className="mt-4 inline-flex min-h-11 items-center font-bold text-accent-strong hover:underline">
        City settings
      </Link>
    </>
  );
}

function AmbientSheet() {
  const levels = usePrefs((p) => p.ambient);
  const on = useAmbient((s) => s.on);
  const mixes = useAmbientMixes();
  const [name, setName] = useState("");
  const any = Object.values(levels).some((v) => v > 0);
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!any && !on} onClick={() => (on ? stopAmbient() : startAmbient())}>
          {on ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
          {on ? "Stop" : "Play"}
        </Button>
      </div>
      <div className="grid gap-3">
        {AMBIENT_SOUNDS.map((s) => (
          <label key={s.id} className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <span className="font-semibold">{s.label}</span>
            <Slider label={s.label} min={0} max={1} step={0.01} value={[levels[s.id] ?? 0]} onValueChange={([v]) => setAmbientLevel(s.id as AmbientId, v)} />
          </label>
        ))}
      </div>
      <section className="grid gap-2">
        <h3 className="font-display text-lg font-semibold">Saved mixes</h3>
        <div className="flex flex-wrap gap-2">
          {mixes.map((m) => (
            <span key={m.name} className="inline-flex items-center gap-1">
              <Chip onClick={() => setAmbientLevels(m.levels)}>{m.name}</Chip>
              <IconButton label={`Delete ${m.name}`} size="sm" onClick={() => void saveAmbientMixes(mixes.filter((x) => x.name !== m.name))}>
                <Trash />
              </IconButton>
            </span>
          ))}
          {!mixes.length && <span className="font-semibold text-muted">No saved mixes</span>}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n || !any) return;
            void saveAmbientMixes([...mixes.filter((m) => m.name !== n), { name: n, levels }]);
            setName("");
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mix name" aria-label="Mix name" maxLength={40} className={inputClass} />
          <Button type="submit" disabled={!name.trim() || !any} className="shrink-0">
            Save mix
          </Button>
        </form>
      </section>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

const STAGE_LABELS = ["Sprouts", "Seedlings", "Leafy", "Flowering", "In full bloom"];

function GrowthSheet({ metrics, unlocked, unlockables }: { metrics: Stats; unlocked: Set<string>; unlockables: Unlockable[] }) {
  const stage = plantStage(metrics.hours);
  const next = PLANT_STAGES[stage + 1];
  return (
    <div className="grid gap-4">
      <section className="grid gap-2 rounded-card bg-surface-solid/60 p-4">
        <h3 className="font-display text-lg font-semibold">Plants: {STAGE_LABELS[stage]}</h3>
        <Row label="Listening hours" value={metrics.hours.toFixed(1)} />
        {next !== undefined && (
          <>
            <Bar value={(metrics.hours - PLANT_STAGES[stage]) / (next - PLANT_STAGES[stage])} />
            <span className="text-sm font-semibold text-muted">Next stage at {next} h</span>
          </>
        )}
      </section>
      <section className="grid gap-3">
        <h3 className="font-display text-lg font-semibold">Decorations</h3>
        {unlockables.map((u) => (
          <div key={u.id} className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">{u.label}</span>
              <span className={cn("text-sm font-bold", unlocked.has(u.id) ? "text-accent-strong" : "text-muted")}>
                {unlocked.has(u.id) ? "Unlocked" : `${METRIC_LABELS[u.metric]}: ${Math.floor(metrics[u.metric])}/${u.threshold}`}
              </span>
            </div>
            <Bar value={progressOf(u, metrics)} />
          </div>
        ))}
      </section>
    </div>
  );
}

function NotesSheet() {
  const notes = useHiddenNotes();
  const found = (notes.data ?? []).filter((n) => n.found);
  const hidden = (notes.data ?? []).length - found.length;
  return (
    <div className="grid gap-3">
      <p className="font-semibold text-muted">
        {found.length} found · {hidden} hidden
      </p>
      <ul className="grid grid-cols-1 gap-2">
        {found.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => useRoom.setState({ reveal: n, sheet: null })}
              className="flex w-full items-center justify-between gap-3 rounded-button bg-surface-solid/60 p-3 text-start hover:bg-accent-soft/40"
            >
              <span dir="auto" className="min-w-0 truncate font-hand text-2xl">
                {n.title || n.body?.slice(0, 40)}
              </span>
              <span className="shrink-0 text-sm font-semibold text-muted">{n.found_at ? new Date(n.found_at).toLocaleDateString() : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SLEEP_MINUTES = [15, 30, 45, 60];

function SleepSheet() {
  const prefs = usePrefs();
  const playlists = usePlaylists();
  const chosen = usePlaylist(prefs.sleepPlaylist && prefs.sleepPlaylist !== "likes" ? prefs.sleepPlaylist : null);
  const likes = useLikes("added");
  const [ambient, setAmbient] = useState<AmbientId | "">("");
  const source: Track[] | undefined = prefs.sleepPlaylist === "likes" ? likes.data : chosen.data?.tracks;
  const start = () => {
    if (!source?.length) return;
    const name = prefs.sleepPlaylist === "likes" ? "Likes" : (chosen.data?.name ?? "Sleep");
    playTracks(source, -1, { type: "playlist", id: chosen.data?.id, name }, { shuffle: true });
    setSleep({ mode: "time", minutes: prefs.sleepMinutes, endsAt: Date.now() + prefs.sleepMinutes * 60_000 });
    if (ambient) setAmbientLevels({ [ambient]: 0.5 });
    useRoom.setState({ sheet: null, sleepMode: true });
  };
  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h3 className="font-display text-lg font-semibold">Music</h3>
        <select
          aria-label="Sleep playlist"
          className={inputClass}
          value={prefs.sleepPlaylist ?? ""}
          onChange={(e) => prefs.set({ sleepPlaylist: e.target.value || null })}
        >
          <option value="">Choose a playlist</option>
          <option value="likes">Likes</option>
          {playlists.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-lg font-semibold">Timer</h3>
        <div className="flex flex-wrap gap-2">
          {SLEEP_MINUTES.map((m) => (
            <Chip key={m} selected={prefs.sleepMinutes === m} onClick={() => prefs.set({ sleepMinutes: m })}>
              {m} min
            </Chip>
          ))}
        </div>
      </section>
      <section className="grid gap-2">
        <h3 className="font-display text-lg font-semibold">Ambient sound</h3>
        <div className="flex flex-wrap gap-2">
          <Chip selected={!ambient} onClick={() => setAmbient("")}>
            Off
          </Chip>
          {AMBIENT_SOUNDS.map((s) => (
            <Chip key={s.id} selected={ambient === s.id} onClick={() => setAmbient(s.id)}>
              {s.label}
            </Chip>
          ))}
        </div>
      </section>
      <Button variant="primary" disabled={!source?.length} onClick={start}>
        Start sleep mode
      </Button>
    </div>
  );
}

function NoteReveal() {
  const note = useRoom((s) => s.reveal);
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && useRoom.setState({ reveal: null })} title={note?.title || "Note"}>
      {note && (
        <div className="rounded-card bg-[#fffdf8] p-5 shadow-soft [background-image:repeating-linear-gradient(transparent,transparent_31px,rgba(168,68,94,0.12)_32px)] dark:text-[#3b2f3f]">
          <p dir="auto" className="whitespace-pre-line font-hand text-[26px] leading-8 text-[#3b2f3f]">
            {note.body}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function Unlocked({ unlockables }: { unlockables: Unlockable[] }) {
  const id = useRoom((s) => s.unlocked);
  const u = unlockables.find((x) => x.id === id);
  return (
    <Dialog open={!!u} onOpenChange={(o) => !o && useRoom.setState({ unlocked: null })} title="Unlocked">
      {u && (
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <span aria-hidden className="text-5xl">
            ✨
          </span>
          <p className="font-display text-2xl font-semibold">{u.label}</p>
          <Button variant="primary" onClick={() => useRoom.setState({ unlocked: null, sheet: "edit", draft: null })}>
            Place it
          </Button>
        </div>
      )}
    </Dialog>
  );
}

const TITLES = { sky: "Sky", ambient: "Ambient sounds", growth: "Growth", notes: "Found notes", sleep: "Sleep mode" } as const;

export function RoomSheets({
  sky,
  place,
  weather,
  other,
  metrics,
  unlocked,
  unlockables,
}: {
  sky: SkyState | null;
  place: City | null;
  weather: Weather | null;
  other: { name: string; city: City } | null;
  metrics: Stats;
  unlocked: Set<string>;
  unlockables: Unlockable[];
}) {
  const sheet = useRoom((s) => s.sheet);
  const open = sheet && sheet !== "edit" ? sheet : null;
  return (
    <>
      <Dialog open={!!open} onOpenChange={(o) => !o && close()} title={open ? TITLES[open] : ""} wide={open === "ambient"}>
        {open === "sky" && <SkySheet sky={sky} place={place} weather={weather} other={other} />}
        {open === "ambient" && <AmbientSheet />}
        {open === "growth" && <GrowthSheet metrics={metrics} unlocked={unlocked} unlockables={unlockables} />}
        {open === "notes" && <NotesSheet />}
        {open === "sleep" && <SleepSheet />}
      </Dialog>
      <NoteReveal />
      <Unlocked unlockables={unlockables} />
    </>
  );
}
