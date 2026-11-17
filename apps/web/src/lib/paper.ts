export type LetterKind = "welcome" | "standard" | "open_when" | "time_locked";

export type LetterSummary = {
  kind: LetterKind;
  author_id: string;
  status: "draft" | "published";
  locked: boolean;
  created_at: string;
  unlock_at: string | null;
};

const byTime = (key: (x: LetterSummary) => string, dir: 1 | -1) => (a: LetterSummary, b: LetterSummary) => dir * (Date.parse(key(a)) - Date.parse(key(b)));
const delivered = (l: LetterSummary) => (l.kind === "time_locked" && l.unlock_at ? l.unlock_at : l.created_at);

export function groupReceived<T extends LetterSummary>(letters: T[], me: string): { openWhen: T[]; sealed: T[]; letters: T[] } {
  const received = letters.filter((l) => l.author_id !== me && l.status === "published");
  return {
    openWhen: received.filter((l) => l.kind === "open_when").sort(byTime((l) => l.created_at, 1)),
    sealed: received.filter((l) => l.kind === "time_locked" && l.locked).sort(byTime((l) => l.unlock_at ?? l.created_at, 1)),
    letters: received.filter((l) => l.kind === "standard" || l.kind === "welcome" || (l.kind === "time_locked" && !l.locked)).sort(byTime(delivered, -1)),
  };
}

export function groupWritten<T extends LetterSummary>(letters: T[], me: string): { drafts: T[]; openWhen: T[]; timeLocked: T[]; letters: T[]; welcome: T[] } {
  const mine = letters.filter((l) => l.author_id === me).sort(byTime((l) => l.created_at, -1));
  const sent = mine.filter((l) => l.status === "published");
  return {
    drafts: mine.filter((l) => l.status === "draft"),
    openWhen: sent.filter((l) => l.kind === "open_when").sort(byTime((l) => l.created_at, 1)),
    timeLocked: sent.filter((l) => l.kind === "time_locked").sort(byTime((l) => l.unlock_at ?? l.created_at, 1)),
    letters: sent.filter((l) => l.kind === "standard"),
    welcome: sent.filter((l) => l.kind === "welcome"),
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }, locale?: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale ?? [], { ...opts, timeZone: "UTC" });
}

export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const zoneCity = (timeZone: string) => (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");

export const jarPapers = (left: number) => Math.min(Math.max(Math.floor(left), 0), 9);

export function splitByDate<T extends { date: string }>(list: T[], today: string): { upcoming: T[]; past: T[] } {
  return {
    upcoming: list.filter((x) => x.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
    past: list.filter((x) => x.date < today).sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export function msUntil(iso: string | null | undefined, now = Date.now(), min = 1000): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, min), 86_400_000);
}
