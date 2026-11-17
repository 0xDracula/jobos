"use client";

import { Headphones } from "lucide-react";

import { MenuItem, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui";
import { openSessions, sessionApi, sessionTitle, useSessions, type ListeningSession } from "@/lib/sessions";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

export function SessionMenuItems({ track }: { track: Track }) {
  const sessions = openSessions(useSessions().data);
  if (!sessions.length) return null;
  const add = (s: ListeningSession) =>
    sessionApi
      .add(s.id, [track.id])
      .then(() => toast(`Added to ${sessionTitle(s)}`))
      .catch(() => toast("Not added"));
  if (sessions.length === 1) {
    return (
      <MenuItem icon={<Headphones />} onSelect={() => void add(sessions[0])}>
        Add to session
      </MenuItem>
    );
  }
  return (
    <MenuSub>
      <MenuSubTrigger icon={<Headphones />}>Add to session</MenuSubTrigger>
      <MenuSubContent>
        {sessions.map((s) => (
          <MenuItem key={s.id} onSelect={() => void add(s)}>
            <span dir="auto" className="truncate">
              {sessionTitle(s)}
            </span>
          </MenuItem>
        ))}
      </MenuSubContent>
    </MenuSub>
  );
}
