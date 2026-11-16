"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebounced } from "@/components/common";
import { Button, inputClass, Segmented, Spinner, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { usePlaylists } from "@/lib/queries";

import { useCity, useSetCity } from "../data";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="font-bold">{label}</span>
      {children}
    </div>
  );
}

export function LocationSettings() {
  const city = useCity();
  const setCity = useSetCity();
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 350);
  const results = useQuery({
    queryKey: ["cities", query],
    queryFn: async () => (await api.cities(query)).places,
    enabled: query.length >= 2,
    staleTime: 24 * 60 * 60_000,
  });
  const current = city.data?.city;
  return (
    <section id="location" className="mb-10 scroll-mt-6">
      <h2 className="mb-3 font-display text-xl font-semibold">Location</h2>
      <div className="grid grid-cols-1 gap-1 rounded-card bg-surface-solid/60 p-2 shadow-soft">
        <Row label="City">
          <span dir="auto" className="font-bold text-muted">
            {current ? `${current.name}${current.country ? `, ${current.country}` : ""} · ${current.source === "manual" ? "Set by hand" : "Detected"}` : city.data?.detection ? "Not detected" : "Detection off"}
          </span>
        </Row>
        {current?.source === "manual" && (
          <Row label="Detection">
            <Button size="sm" onClick={() => setCity.mutate(null)} disabled={setCity.isPending}>
              Use detected city
            </Button>
          </Row>
        )}
        <div className="grid gap-2 px-3 py-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search for a city"
            aria-label="Search for a city"
            dir="auto"
            className={inputClass}
          />
          {results.isFetching && <Spinner className="size-5 text-muted" />}
          <ul className="grid grid-cols-1 gap-1">
            {results.data?.map((p) => (
              <li key={`${p.name}${p.lat}${p.lon}`}>
                <button
                  type="button"
                  onClick={() => {
                    setCity.mutate(p);
                    setQ("");
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-button px-3 py-2 text-start hover:bg-accent-soft/50"
                >
                  <span dir="auto" className="font-bold">
                    {p.name}
                  </span>
                  <span dir="auto" className="truncate text-sm font-semibold text-muted">
                    {[p.region, p.country].filter(Boolean).join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="px-3 pb-2 text-xs font-semibold text-muted">
          <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="underline">
            IP Geolocation by DB-IP
          </a>{" "}
          ·{" "}
          <a href="https://open-meteo.com" target="_blank" rel="noreferrer" className="underline">
            Weather data by Open-Meteo.com
          </a>
        </p>
      </div>
    </section>
  );
}

const BEAT_LEVELS: [string, string][] = [
  ["0", "Off"],
  ["0.35", "Low"],
  ["0.6", "Medium"],
  ["1", "High"],
];

export function RoomPrefs() {
  const prefs = usePrefs();
  const playlists = usePlaylists();
  const beatValue = BEAT_LEVELS.reduce((best, [v]) => (Math.abs(Number(v) - prefs.beatIntensity) < Math.abs(Number(best) - prefs.beatIntensity) ? v : best), "0.6");
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-display text-xl font-semibold">Room</h2>
      <div className="grid grid-cols-1 gap-1 rounded-card bg-surface-solid/60 p-2 shadow-soft">
        <Row label="Beat lighting">
          <Segmented label="Beat lighting" value={beatValue} options={BEAT_LEVELS} onChange={(v) => prefs.set({ beatIntensity: Number(v) })} />
        </Row>
        <Row label="Seasons">
          <Switch label="Seasons" checked={prefs.seasons} onCheckedChange={(seasons) => prefs.set({ seasons })} />
        </Row>
        <Row label="Interface sounds">
          <Switch label="Interface sounds" checked={prefs.uiSounds} onCheckedChange={(uiSounds) => prefs.set({ uiSounds })} />
        </Row>
        <Row label="Weekend playlist">
          <select
            aria-label="Weekend playlist"
            className={`${inputClass} max-w-64`}
            value={prefs.weekendPlaylist ?? ""}
            onChange={(e) => prefs.set({ weekendPlaylist: e.target.value || null })}
          >
            <option value="">None</option>
            {playlists.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
      </div>
    </section>
  );
}
