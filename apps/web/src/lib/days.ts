export function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function fmtDay(day: string | null | undefined, opts: { short?: boolean } = {}): string {
  const d = day ? parseDay(day) : null;
  if (!d) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(opts.short ? {} : { year: "numeric" }) });
}

export function fmtDayRange(from: string | null, to: string | null): string {
  const a = from ? parseDay(from) : null;
  const b = to ? parseDay(to) : null;
  if (!a && !b) return "";
  if (a && !b) return `${fmtDay(from)} – now`;
  if (!a) return fmtDay(to);
  if (from === to) return fmtDay(from);
  const sameYear = a.getFullYear() === b!.getFullYear();
  return `${a.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) })} – ${fmtDay(to)}`;
}

export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function tilt(id: string, max = 4): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (((h >>> 0) % 1000) / 1000) * 2 * max - max;
}
