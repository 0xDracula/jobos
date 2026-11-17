export type Day = { y: number; m: number; d: number };

export function parseDay(s: string): Day {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

export const dayKey = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export const dayDate = (s: string) => {
  const { y, m, d } = parseDay(s);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

export function addDays(s: string, n: number): string {
  const t = dayDate(s);
  t.setUTCDate(t.getUTCDate() + n);
  return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const daysBetween = (from: string, to: string) => Math.round((dayDate(to).getTime() - dayDate(from).getTime()) / 86_400_000);

export function addMonths(s: string, n: number): string {
  const { y, m } = parseDay(s);
  const t = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

export const monthStart = (s: string) => `${s.slice(0, 7)}-01`;

export function monthEnd(s: string): string {
  return addDays(addMonths(s, 1), -1);
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseDay(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function monthGrid(month: string): { day: string; inMonth: boolean }[] {
  if (!isDay(monthStart(month))) return [];
  const first = monthStart(month);
  const start = addDays(first, -dayDate(first).getUTCDay());
  const last = monthEnd(month);
  const end = addDays(last, 6 - dayDate(last).getUTCDay());
  const out: { day: string; inMonth: boolean }[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push({ day: d, inMonth: d.slice(0, 7) === month.slice(0, 7) });
  return out;
}

export function relativeDays(n: number): string {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 1 ? `In ${n} days` : `${-n} days ago`;
}

export function dateIdOf(eventId: string): string | null {
  const [source, id] = eventId.split(":");
  return source === "date" && id ? id : null;
}

export function reminderOptions(timed: boolean): [number | null, string][] {
  return [
    [null, "None"],
    [0, timed ? "At the start" : "On the day"],
    ...(timed
      ? ([
          [10, "10 minutes before"],
          [60, "1 hour before"],
        ] as [number, string][])
      : []),
    [1440, "1 day before"],
    [10080, "1 week before"],
  ];
}

export function reminderLabel(minutes: number | null, timed: boolean): string {
  const hit = reminderOptions(timed).find(([m]) => m === minutes);
  if (hit) return hit[1];
  if (minutes == null) return "None";
  return minutes % 1440 === 0 ? `${minutes / 1440} days before` : `${minutes} minutes before`;
}

export const fmtCount = (n: number) => n.toLocaleString("en-US");

export function fmtHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${fmtCount(h)} h ${m} min` : `${fmtCount(h)} h`;
}

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
