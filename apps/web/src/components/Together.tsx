"use client";

import { Headphones, LogOut } from "lucide-react";
import Link from "next/link";

import { useMe, useMembers } from "@/lib/session";
import { useTogether } from "@/lib/together";
import { joinSession, leaveSession } from "@/player/together";

import { Button } from "./ui";

export function TogetherBanner() {
  const me = useMe().data;
  const members = useMembers();
  const room = useTogether().data;
  if (!me || !room?.active) return null;
  const inside = room.members.includes(me.id);
  const others = room.members.filter((id) => id !== me.id);
  const names = others.map((id) => members.data?.find((u) => u.id === id)?.display_name ?? "").filter(Boolean);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),8px)] z-40 flex justify-center px-4 lg:left-64">
      <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pe-1.5 ps-3 shadow-soft [background:var(--surface-solid)]">
        <Headphones aria-hidden className="size-4 text-accent-strong" />
        <Link href="/together/" className="max-w-[50vw] truncate text-sm font-bold">
          {inside ? (names.length ? `Listening with ${names.join(", ")}` : "Listening together") : `${names.join(", ") || "Someone"} is listening`}
        </Link>
        {inside ? (
          <Button size="sm" variant="ghost" onClick={leaveSession} aria-label="Leave">
            <LogOut className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={joinSession}>
            Join
          </Button>
        )}
      </div>
    </div>
  );
}
