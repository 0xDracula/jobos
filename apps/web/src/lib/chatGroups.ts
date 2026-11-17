export const GROUP_MS = 5 * 60_000;

type Message = { id: string; sender_id: string; created_at: string };

export type ChatRow<M extends Message> =
  | { kind: "day"; key: string; label: string }
  | { kind: "group"; key: string; sender: string; items: M[] };

export function dayLabel(d: Date, now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

export function groupMessages<M extends Message>(messages: M[], now: Date = new Date()): ChatRow<M>[] {
  const rows: ChatRow<M>[] = [];
  let day = "";
  let group: Extract<ChatRow<M>, { kind: "group" }> | null = null;
  for (const m of messages) {
    const at = new Date(m.created_at);
    if (at.toDateString() !== day) {
      day = at.toDateString();
      rows.push({ kind: "day", key: `day-${day}`, label: dayLabel(at, now) });
      group = null;
    }
    const prev = group?.items[group.items.length - 1];
    if (group && prev && group.sender === m.sender_id && at.getTime() - new Date(prev.created_at).getTime() < GROUP_MS) {
      group.items.push(m);
    } else {
      group = { kind: "group", key: m.id, sender: m.sender_id, items: [m] };
      rows.push(group);
    }
  }
  return rows;
}
