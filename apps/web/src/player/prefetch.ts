import { api } from "@/lib/api";

import { usePlayer } from "./store";

const AHEAD = 3;
const LOOK = 12;

export function startPrefetch(): () => void {
  const requested = new Set<string>();
  return usePlayer.subscribe((s, prev) => {
    if (s.index < 0 || (s.queue === prev.queue && s.index === prev.index)) return;
    const ids: string[] = [];
    for (let i = s.index + 1; i < Math.min(s.queue.length, s.index + 1 + LOOK) && ids.length < AHEAD; i++) {
      const t = s.queue[i].track;
      if (!t.audio && t.source && !requested.has(t.id)) ids.push(t.id);
    }
    if (!ids.length) return;
    ids.forEach((id) => requested.add(id));
    api.prefetch(ids).catch(() => ids.forEach((id) => requested.delete(id)));
  });
}
