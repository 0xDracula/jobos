"use client";

import { Headphones, LogOut, Play, Square } from "lucide-react";
import { useEffect, useMemo } from "react";

import { Artwork } from "@/components/media";
import { PageHero } from "@/components/sky/PageHero";
import { PersonBadge } from "@/components/PersonBadge";
import { Button, Empty } from "@/components/ui";
import { fmtMs } from "@/lib/format";
import { useMe, useMembers } from "@/lib/session";
import { useTogether } from "@/lib/together";
import { jumpTo } from "@/player/controls";
import { usePlayer } from "@/player/store";
import { endSession, joinSession, leaveSession, startSession } from "@/player/together";

export default function TogetherPage() {
  const me = useMe().data;
  const members = useMembers();
  const room = useTogether().data;
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const inside = !!(me && room?.active && room.members.includes(me.id));
  const name = (id: string) => (id === me?.id ? "You" : (members.data?.find((u) => u.id === id)?.display_name ?? ""));

  useEffect(() => {
    if (!room?.active || inside || new URLSearchParams(window.location.search).get("join") !== "1") return;
    joinSession();
    history.replaceState(null, "", "/together/");
  }, [room?.active, inside]);

  const addedBy = useMemo(() => new Map((room?.queue ?? []).map((q) => [q.key, q.added_by])), [room?.queue]);

  return (
    <>
      <PageHero title="Listen together" />
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-card bg-surface-solid/60 p-4 shadow-soft">
        <Headphones aria-hidden className="size-6 text-accent-strong" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{room?.active ? (inside ? "In session" : "Session running") : "No session"}</p>
          {room?.active && <p className="text-sm font-semibold text-muted">{room.members.map(name).join(", ")}</p>}
        </div>
        {!room?.active && (
          <Button variant="primary" onClick={() => startSession()} disabled={!queue.length}>
            <Play className="size-4" /> Start with my queue
          </Button>
        )}
        {room?.active && !inside && (
          <Button variant="primary" onClick={joinSession}>
            Join
          </Button>
        )}
        {inside && (
          <>
            <Button onClick={leaveSession}>
              <LogOut className="size-4" /> Leave
            </Button>
            <Button variant="ghost" onClick={endSession}>
              <Square className="size-4" /> End
            </Button>
          </>
        )}
      </div>
      {inside ? (
        <ol className="grid gap-0.5">
          {queue.map((q, i) => (
            <li key={q.uid}>
              <button
                type="button"
                onClick={() => jumpTo(q.uid)}
                aria-current={i === index ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-button p-1.5 text-start hover:bg-accent-soft/40 ${i === index ? "bg-accent-soft/50" : ""}`}
              >
                <Artwork src={q.track.artwork_thumb_url} className="size-11 shrink-0 rounded-chip" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate font-bold">
                    {q.track.title}
                  </span>
                  <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                    {q.track.artists.join(", ")} · {fmtMs(q.track.duration_ms)}
                  </span>
                </span>
                {addedBy.get(q.uid) && <PersonBadge userId={addedBy.get(q.uid)!} />}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        !room?.active && !queue.length && <Empty>Queue empty</Empty>
      )}
    </>
  );
}
