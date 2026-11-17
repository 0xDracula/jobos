export type Season = "winter" | "spring" | "summer" | "autumn";

export function seasonAt(date: Date, lat: number): Season {
  const m = date.getMonth();
  const north: Season = m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
  if (lat >= 0) return north;
  const flip: Record<Season, Season> = { winter: "summer", spring: "autumn", summer: "winter", autumn: "spring" };
  return flip[north];
}

export const isWeekend = (date: Date) => date.getDay() === 5 || date.getDay() === 6;

export function weekendMorning(date: Date): number {
  if (!isWeekend(date)) return 0;
  const h = date.getHours() + date.getMinutes() / 60;
  if (h < 6.5 || h >= 11.5) return 0;
  return Math.max(0, Math.min(1, (h - 6.5) / 0.75, 11.5 - h));
}

export const DEFAULT_PLANT_STAGES: readonly number[] = [0, 1, 5, 20, 60];

export let PLANT_STAGES: readonly number[] = DEFAULT_PLANT_STAGES;

export function setPlantStages(stages: readonly number[] | null | undefined) {
  const valid = !!stages && stages.length === DEFAULT_PLANT_STAGES.length && stages[0] === 0 && stages.every((h, i) => i === 0 || h > stages[i - 1]);
  PLANT_STAGES = valid ? stages : DEFAULT_PLANT_STAGES;
}

export function plantStage(hours: number): number {
  let stage = 0;
  PLANT_STAGES.forEach((h, i) => {
    if (hours >= h) stage = i;
  });
  return stage;
}

export type Metric = "hours" | "likes" | "days" | "milestone";

export type Unlockable = { id: string; label: string; metric: Metric; threshold: number; milestone?: string };

export type MilestoneDay = { id: string; label: string; date: string; reached: boolean };

export const UNLOCKABLES: Unlockable[] = [
  { id: "fairy_jar", label: "Fairy light jar", metric: "hours", threshold: 10 },
  { id: "moon_lamp", label: "Moon lamp", metric: "days", threshold: 7 },
  { id: "hanging_plant", label: "Hanging plant", metric: "likes", threshold: 25 },
  { id: "bunting", label: "Bunting", metric: "hours", threshold: 50 },
  { id: "bean_bag", label: "Bean bag", metric: "days", threshold: 30 },
  { id: "disco_ball", label: "Disco ball", metric: "hours", threshold: 100 },
];

export const METRIC_LABELS: Record<Metric, string> = { hours: "Listening hours", likes: "Liked songs", days: "Days listening", milestone: "Milestone" };

export type Stats = { hours: number; likes: number; days: number };

const reachedMilestone = (u: Unlockable, milestones: MilestoneDay[]) => !!u.milestone && milestones.some((m) => m.id === u.milestone && m.reached);

export function progressOf(u: Unlockable, s: Stats, milestones: MilestoneDay[] = []): number {
  if (u.metric === "milestone") return reachedMilestone(u, milestones) ? 1 : 0;
  return Math.min(1, s[u.metric] / Math.max(1, u.threshold));
}

export function isUnlocked(u: Unlockable, s: Stats, milestones: MilestoneDay[] = []): boolean {
  if (u.metric === "milestone") return reachedMilestone(u, milestones);
  return s[u.metric] >= u.threshold;
}

export const unlockedIds = (s: Stats, list: Unlockable[] = UNLOCKABLES, milestones: MilestoneDay[] = []) =>
  new Set(list.filter((u) => isUnlocked(u, s, milestones)).map((u) => u.id));

export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function milestoneToday(milestones: MilestoneDay[], now: Date): MilestoneDay | null {
  const today = dayOf(now);
  return milestones.find((m) => m.reached && m.date === today) ?? null;
}

export type HolidayRange = { start: string; end: string; decorations: string[] };

export function inHoliday(h: Pick<HolidayRange, "start" | "end">, now: Date): boolean {
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (!/^\d\d-\d\d$/.test(h.start) || !/^\d\d-\d\d$/.test(h.end)) return false;
  return h.start <= h.end ? md >= h.start && md <= h.end : md >= h.start || md <= h.end;
}

export function holidayDecorations(holidays: HolidayRange[], now: Date): string[] {
  const out = new Set<string>();
  for (const h of holidays) if (inHoliday(h, now)) for (const d of h.decorations ?? []) out.add(d);
  return [...out];
}
