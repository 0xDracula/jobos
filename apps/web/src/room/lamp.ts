"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/lib/api";
import { useRoomConfig } from "@/lib/gift";
import { useMe, useMembers } from "@/lib/session";
import { socialApi, socialKeys, usePresence, type Lamp } from "@/lib/social";
import { toast } from "@/lib/toast";

const LAMP_EVERY = 10 * 60_000;
const LAMP_KEY = "jobbos.lamp.sent";

const readNumber = (key: string) => {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
};

export type LampState = {
  received: Lamp | null;
  sending: boolean;
  toggle: () => Promise<void>;
};

export function useLamp(): LampState {
  const qc = useQueryClient();
  const meId = useMe().data?.id ?? "";
  const members = useMembers();
  const presence = usePresence();
  const config = useRoomConfig();
  const [sentUntil, setSentUntil] = useState(0);
  const lamps = presence.data?.lamps ?? [];
  const nowMs = Date.now();
  const received = lamps.find((l) => l.to === meId && Date.parse(l.on_until) > nowMs) ?? null;
  const sentLamp = lamps.find((l) => l.from === meId && Date.parse(l.on_until) > nowMs);
  const sending = !!sentLamp || sentUntil > nowMs;
  const otherUser = members.data?.find((u) => u.id !== meId) ?? null;
  const lastSent = Math.max(readNumber(LAMP_KEY), ...lamps.filter((l) => l.from === meId).map((l) => Date.parse(l.sent_at) || 0));
  const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const toggle = async () => {
    if (sending) {
      try {
        await socialApi.lamp(false);
        setSentUntil(0);
        toast("Lamp off");
      } catch {
        toast("Lamp unavailable");
      }
      void qc.invalidateQueries({ queryKey: socialKeys.presence });
      return;
    }
    if (lastSent && Date.now() - lastSent < LAMP_EVERY) {
      toast(`Lamp available at ${timeOf(lastSent + LAMP_EVERY)}`);
      return;
    }
    try {
      await socialApi.lamp(true);
      try {
        localStorage.setItem(LAMP_KEY, String(Date.now()));
      } catch {
      }
      setSentUntil(Date.now() + (config.data?.lamp_minutes ?? 60) * 60_000);
      toast(otherUser ? `Lamp on in ${otherUser.display_name}'s room` : "Lamp on");
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const retry = Date.parse(String((err.body as { retry_at?: string } | null)?.retry_at ?? ""));
        toast(`Lamp available at ${timeOf(Number.isFinite(retry) ? retry : (lastSent || Date.now()) + LAMP_EVERY)}`);
      } else if (err instanceof ApiError && err.status === 409) toast(err.message);
      else toast("Lamp unavailable");
    }
    void qc.invalidateQueries({ queryKey: socialKeys.presence });
  };
  return { received, sending, toggle };
}
