"use client";

import { Headphones, LogOut, Radio, Square } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { sessionTitle } from "@/lib/sessions";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import { useTogether } from "@/lib/together";
import { startRadio } from "@/player/radio";
import { joinSession, leaveSession } from "@/player/together";

import { ReactionLayer } from "./together/Reactions";
import { Button } from "./ui";

const PILL = "pointer-events-none fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom)+4.75rem)] z-40 flex justify-center px-4 lg:bottom-[calc(1rem+4.75rem)] lg:left-64";

function SetlistEnd() {
  const room = useTogether().data;
  const [dismissed, setDismissed] = useState(0);
  if (!room?.finished || dismissed === room.version) return null;
  const last = room.queue[room.index];
  const keepGoing = async () => {
    setDismissed(room.version);
    if (!last) return;
    if (!(await startRadio({ type: "track", id: last.track_id, name: `${sessionTitle(room)} radio` }))) toast("Radio unavailable");
  };
  return (
    <div className={PILL}>
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-[18px] border-2 border-b-[5px] border-panel-line bg-panel px-3 py-2 shadow-soft">
        <span className="px-1 text-sm font-bold">Setlist finished</span>
        <Button size="sm" variant="primary" onClick={() => void keepGoing()}>
          <Radio className="size-4" /> Keep going
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(room.version)}>
          <Square className="size-4" /> Stop
        </Button>
      </div>
    </div>
  );
}

export function TogetherBanner() {
  const me = useMe().data;
  const members = useMembers();
  const room = useTogether().data;
  const pathname = usePathname();
  if (!me || !room?.active) return null;
  const inside = room.members.includes(me.id);
  const hidden = pathname.startsWith("/chat") || pathname.startsWith("/together");
  const others = room.members.filter((id) => id !== me.id);
  const names = others.map((id) => members.data?.find((u) => u.id === id)?.display_name ?? "").filter(Boolean);
  const title = sessionTitle(room);
  return (
    <>
      {inside && <ReactionLayer />}
      {inside && room.finished ? (
        <SetlistEnd />
      ) : (
        !hidden && (
          <div className={PILL}>
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border-2 border-panel-line bg-panel py-1.5 pe-1.5 ps-3 shadow-soft">
              <Headphones aria-hidden className="size-4 shrink-0 text-accent-strong" />
              <Link href={`/together/?id=${room.session_id}`} className="max-w-[55vw] truncate text-sm font-bold">
                {inside ? (names.length ? `${title} · with ${names.join(", ")}` : title) : `${names.join(", ") || "Someone"} · ${title}`}
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
        )
      )}
    </>
  );
}
