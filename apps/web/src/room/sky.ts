import * as SunCalc from "suncalc";

export type Phase = "dawn" | "day" | "golden" | "dusk" | "night";

export type SkyState = {
  phase: Phase;
  sunAltitude: number;
  sunAzimuth: number;
  top: string;
  horizon: string;
  tint: string;
  tintAlpha: number;
  night: number;
  lamp: number;
  moon: { altitude: number; azimuth: number; fraction: number; phase: number; angle: number };
  sunrise: Date | null;
  sunset: Date | null;
};

type Key = {
  alt: number;
  top: string;
  horizon: string;
  tint: string;
  tintA: number;
  night: number;
  lamp: number;
};

const NIGHT: Omit<Key, "alt"> = { top: "#0b1029", horizon: "#2e3466", tint: "#11163a", tintA: 0.62, night: 1, lamp: 1 };
const DAY: Omit<Key, "alt"> = { top: "#6f96c0", horizon: "#cfd8de", tint: "#ffffff", tintA: 0, night: 0, lamp: 0 };

const EVENING: Key[] = [
  { alt: -14, ...NIGHT },
  { alt: -9, top: "#141a40", horizon: "#3d3a72", tint: "#141a40", tintA: 0.58, night: 0.92, lamp: 1 },
  { alt: -4, top: "#2b3367", horizon: "#9a5f80", tint: "#2a2556", tintA: 0.45, night: 0.5, lamp: 1 },
  { alt: 0, top: "#46508a", horizon: "#e09a72", tint: "#c46a5a", tintA: 0.22, night: 0.12, lamp: 0.35 },
  { alt: 6, top: "#6588b6", horizon: "#e8b98a", tint: "#e8a060", tintA: 0.12, night: 0, lamp: 0 },
  { alt: 12, ...DAY },
];
const MORNING: Key[] = [
  { alt: -14, ...NIGHT },
  { alt: -8, top: "#171e48", horizon: "#3f3f78", tint: "#141a40", tintA: 0.55, night: 0.85, lamp: 1 },
  { alt: -3, top: "#3c4a86", horizon: "#c98b86", tint: "#4a3a6a", tintA: 0.36, night: 0.4, lamp: 0.6 },
  { alt: 2, top: "#6a8cbc", horizon: "#f0c0a0", tint: "#e8a080", tintA: 0.14, night: 0.05, lamp: 0 },
  { alt: 8, top: "#6c93c0", horizon: "#d8dcdc", tint: "#ffffff", tintA: 0.03, night: 0, lamp: 0 },
  { alt: 12, ...DAY },
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

function sample(keys: Key[], alt: number): Omit<Key, "alt"> {
  if (alt <= keys[0].alt) return keys[0];
  if (alt >= keys[keys.length - 1].alt) return keys[keys.length - 1];
  let i = 0;
  while (keys[i + 1].alt < alt) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const t = smooth((alt - a.alt) / (b.alt - a.alt));
  return {
    top: mixHex(a.top, b.top, t),
    horizon: mixHex(a.horizon, b.horizon, t),
    tint: mixHex(a.tint, b.tint, t),
    tintA: lerp(a.tintA, b.tintA, t),
    night: lerp(a.night, b.night, t),
    lamp: lerp(a.lamp, b.lamp, t),
  };
}

const MIN = 60_000;

const valid = (d: Date | null | undefined): d is Date => !!d && !Number.isNaN(d.getTime());

export function phaseAt(date: Date, sunrise: Date | null, sunset: Date | null, altitude: number): Phase {
  const t = date.getTime();
  if (sunrise && t >= sunrise.getTime() - 30 * MIN && t < sunrise.getTime() + 60 * MIN) return "dawn";
  if (sunset && t >= sunset.getTime() - 60 * MIN && t < sunset.getTime()) return "golden";
  if (sunset && t >= sunset.getTime() && t < sunset.getTime() + 45 * MIN) return "dusk";
  if (sunrise && sunset) return t > sunrise.getTime() && t < sunset.getTime() ? "day" : "night";
  return altitude > 0 ? "day" : "night";
}

export function fallbackPlace(date: Date): { lat: number; lon: number } {
  return { lat: 30, lon: -date.getTimezoneOffset() / 4 };
}

export function skyAt(date: Date, lat: number, lon: number): SkyState {
  const sun = SunCalc.getPosition(date, lat, lon);
  const alt = sun.altitude;
  const rising = sun.azimuth < 180;
  const k = sample(rising ? MORNING : EVENING, alt);
  const times = SunCalc.getTimes(date, lat, lon);
  const sunrise = valid(times.sunrise) ? times.sunrise : null;
  const sunset = valid(times.sunset) ? times.sunset : null;
  const moonPos = SunCalc.getMoonPosition(date, lat, lon);
  const moonIll = SunCalc.getMoonIllumination(date);
  return {
    phase: phaseAt(date, sunrise, sunset, alt),
    sunAltitude: alt,
    sunAzimuth: sun.azimuth,
    top: k.top,
    horizon: k.horizon,
    tint: k.tint,
    tintAlpha: k.tintA,
    night: k.night,
    lamp: k.lamp,
    moon: {
      altitude: moonPos.altitude,
      azimuth: moonPos.azimuth,
      fraction: moonIll.fraction,
      phase: moonIll.phase,
      angle: moonIll.angle,
    },
    sunrise,
    sunset,
  };
}

export function skyPoint(altitudeDeg: number, azimuthDeg: number): { x: number; y: number } {
  const az = ((azimuthDeg % 360) + 360) % 360;
  return { x: Math.max(-1, Math.min(1, (az - 180) / 90)), y: Math.max(0, Math.min(1, altitudeDeg / 90)) };
}

export const PHASE_LABELS: Record<Phase, string> = {
  dawn: "Dawn",
  day: "Day",
  golden: "Golden hour",
  dusk: "Dusk",
  night: "Night",
};

export function moonPhaseName(phase: number): string {
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return names[Math.round(phase * 8) % 8];
}
