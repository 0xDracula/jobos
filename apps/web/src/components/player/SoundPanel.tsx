"use client";

import { useEffect, useState } from "react";

import { isIOS } from "@/lib/device";
import { fmtTime } from "@/lib/format";
import { EFFECT_LABELS, EQ_BANDS, EQ_PRESET_LABELS, EQ_PRESETS, usePrefs, type Effect } from "@/lib/prefs";
import { setSleep } from "@/player/controls";
import { usePlayer, type SleepTimer } from "@/player/store";

import { Chip, Slider, Switch } from "../ui";

const hz = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SoundPanel() {
  const prefs = usePrefs();
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIOS()), []);
  const presets = Object.keys(EQ_PRESETS) as (keyof typeof EQ_PRESETS)[];
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-7 overflow-y-auto overscroll-contain pb-8">
      <Section title="Equalizer">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Chip key={p} selected={prefs.eqPreset === p} onClick={() => prefs.set({ eqPreset: p, eqGains: [...EQ_PRESETS[p]] })}>
              {EQ_PRESET_LABELS[p]}
            </Chip>
          ))}
          {prefs.eqPreset === "custom" && <Chip selected>{EQ_PRESET_LABELS.custom}</Chip>}
        </div>
        <div className="flex justify-between gap-1 rounded-card bg-surface-solid/50 px-2 py-3">
          {EQ_BANDS.map((f, i) => (
            <div key={f} className="flex flex-col items-center gap-1.5">
              <span className="tabular text-[11px] font-bold text-muted">
                {prefs.eqGains[i] > 0 ? "+" : ""}
                {prefs.eqGains[i]}
              </span>
              <Slider
                label={`${hz(f)} Hz`}
                orientation="vertical"
                min={-12}
                max={12}
                step={1}
                value={[prefs.eqGains[i]]}
                onValueChange={([v]) => {
                  const gains = [...prefs.eqGains];
                  gains[i] = v;
                  prefs.set({ eqGains: gains, eqPreset: "custom" });
                }}
                className="h-28"
              />
              <span className="text-[11px] font-bold text-muted">{hz(f)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Effects">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(EFFECT_LABELS) as Effect[]).map((e) => (
            <Chip key={e} selected={prefs.effect === e} onClick={() => prefs.set({ effect: e })}>
              {EFFECT_LABELS[e]}
            </Chip>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">Vinyl crackle</span>
          <Switch label="Vinyl crackle" checked={prefs.vinyl} onCheckedChange={(vinyl) => prefs.set({ vinyl })} />
        </div>
      </Section>

      {!ios && (
        <Section title="Crossfade (seconds)" aside={<span className="tabular font-bold text-muted">{prefs.crossfade ? `${prefs.crossfade} s` : "Off"}</span>}>
          <Slider label="Crossfade (seconds)" min={0} max={12} step={1} value={[prefs.crossfade]} onValueChange={([v]) => prefs.set({ crossfade: v })} />
        </Section>
      )}

      <SleepSection />
    </div>
  );
}

const SLEEP_MINUTES = [15, 30, 45, 60];

function SleepSection() {
  const sleep = usePlayer((s) => s.sleep);
  const remaining = useSleepRemaining(sleep);
  const choose = (timer: SleepTimer) => setSleep(timer);
  return (
    <Section title="Sleep timer" aside={remaining != null && <span className="tabular font-bold text-accent-strong">{fmtTime(remaining)}</span>}>
      <div className="flex flex-wrap gap-2">
        <Chip selected={!sleep} onClick={() => choose(null)}>
          Off
        </Chip>
        {SLEEP_MINUTES.map((m) => (
          <Chip
            key={m}
            selected={sleep?.mode === "time" && sleep.minutes === m}
            onClick={() => choose({ mode: "time", minutes: m, endsAt: Date.now() + m * 60_000 })}
          >
            {m} min
          </Chip>
        ))}
        <Chip selected={sleep?.mode === "track"} onClick={() => choose({ mode: "track" })}>
          End of song
        </Chip>
        <Chip selected={sleep?.mode === "queue"} onClick={() => choose({ mode: "queue" })}>
          End of queue
        </Chip>
      </div>
    </Section>
  );
}

export function useSleepRemaining(sleep: SleepTimer): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleep?.mode !== "time") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sleep]);
  if (sleep?.mode !== "time") return null;
  return Math.max(0, (sleep.endsAt - now) / 1000);
}
