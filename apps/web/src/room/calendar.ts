export type Season = "winter" | "spring" | "summer" | "autumn";

export function seasonAt(date: Date, lat: number): Season {
  const m = date.getMonth();
  const north: Season = m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
  if (lat >= 0) return north;
  const flip: Record<Season, Season> = { winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" };
  return flip[north];
}

export const isWeekend = (date: Date) => date.getDay() === 5 || date.getDay() === 6;

export const PLANT_STAGES = [0, 1, 5, 20, 60] as const;

export function plantStage(hours: number): number {
  let stage = 0;
  PLANT_STAGES.forEach((h, i) => {
    if (hours >= h) stage = i;
  });
  return stage;
}

export type Metric = "hours" | "likes" | "days";

export type Unlockable = { id: string; label: string; metric: Metric; threshold: number };

export const UNLOCKABLES: Unlockable[] = [
  { id: "fairy_jar", label: "Fairy light jar", metric: "hours", threshold: 10 },
  { id: "moon_lamp", label: "Moon lamp", metric: "days", threshold: 7 },
  { id: "hanging_plant", label: "Hanging plant", metric: "likes", threshold: 25 },
  { id: "bunting", label: "Bunting", metric: "hours", threshold: 50 },
  { id: "bean_bag", label: "Bean bag", metric: "days", threshold: 30 },
  { id: "disco_ball", label: "Disco ball", metric: "hours", threshold: 100 },
];

export const METRIC_LABELS: Record<Metric, string> = { hours: "Listening hours", likes: "Liked songs", days: "Days listening" };

export type Stats = { hours: number; likes: number; days: number };

export const progressOf = (u: Unlockable, s: Stats) => Math.min(1, s[u.metric] / u.threshold);

export const unlockedIds = (s: Stats) => new Set(UNLOCKABLES.filter((u) => s[u.metric] >= u.threshold).map((u) => u.id));
