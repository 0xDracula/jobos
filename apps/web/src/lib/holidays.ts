export function holidayActive(h: { start: string; end: string }, date: Date): boolean {
  const md = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return h.start <= h.end ? md >= h.start && md <= h.end : md >= h.start || md <= h.end;
}
