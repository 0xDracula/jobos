"use client";

import { Headphones, Play, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/avatar";
import { Loading } from "@/components/common";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, SectionTitle } from "@/components/ui";
import { plural } from "@/lib/format";
import { sessionApi, sessionTitle, sessionWhen, useSessions, type ListeningSession } from "@/lib/sessions";
import { toast } from "@/lib/toast";
import { useTogether } from "@/lib/together";
import { startFromQueue } from "@/player/together";
import { usePlayer } from "@/player/store";

import { SessionForm } from "./SessionForm";

export function Covers({ covers, className }: { covers: string[]; className?: string }) {
  if (!covers.length) {
    return (
      <span className={`grid place-items-center rounded-[10px] bg-accent-soft/50 ${className ?? ""}`}>
        <PixelIcon name="headphones" size={32} />
      </span>
    );
  }
  return (
    <span className={`grid grid-cols-2 overflow-hidden rounded-[10px] ${className ?? ""}`}>
      {[0, 1, 2, 3].map((i) => (
        <img key={i} src={covers[i % covers.length]} alt="" className="size-full object-cover" />
      ))}
    </span>
  );
}

function PlannedCard({ s }: { s: ListeningSession }) {
  return (
    <Link href={`/together/?id=${s.id}`} className="flex items-center gap-3 rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel p-3 transition-transform hover:-translate-y-0.5">
      <Covers covers={s.covers} className="size-16 shrink-0" />
      <span className="min-w-0">
        <span dir="auto" className="block truncate font-display text-lg font-semibold">
          {sessionTitle(s)}
        </span>
        <span className="block text-sm font-bold text-muted">{sessionWhen(s.scheduled_at)}</span>
        <span className="block text-sm font-semibold text-muted">{plural(s.item_count, "song")}</span>
      </span>
    </Link>
  );
}

export function SessionsHome() {
  const router = useRouter();
  const q = useSessions();
  const room = useTogether().data;
  const queueLength = usePlayer((s) => s.queue.length);
  const [creating, setCreating] = useState(false);
  const list = q.data ?? [];
  const live = list.find((s) => s.status === "live");
  const planned = list
    .filter((s) => s.status === "planned")
    .sort((a, b) => (a.scheduled_at ?? a.created_at).localeCompare(b.scheduled_at ?? b.created_at));
  const ended = list.filter((s) => s.status === "ended").sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));
  const quickStart = async () => {
    try {
      const id = await startFromQueue();
      if (id) router.push(`/together/?id=${id}`);
    } catch {
      toast("Session not started");
    }
  };
  const planAgain = async (s: ListeningSession) => {
    try {
      const { id } = await sessionApi.copy(s.id);
      router.push(`/together/?id=${id}`);
    } catch {
      toast("Not copied");
    }
  };
  return (
    <>
      <PageHero title="Listen together" meta={`${plural(planned.length, "planned session")}${live ? " · 1 live" : ""}`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-5" /> New session
          </Button>
          {!live && queueLength > 0 && (
            <Button onClick={() => void quickStart()}>
              <Play className="size-5" /> Start with my queue
            </Button>
          )}
        </div>
      </PageHero>
      {q.isLoading && <Loading />}
      <div className="grid grid-cols-1 gap-10">
        {live && (
          <section>
            <SectionTitle>Live</SectionTitle>
            <Link
              href={`/together/?id=${live.id}`}
              className="flex flex-wrap items-center gap-4 rounded-[14px] border-2 border-b-[5px] border-panel-line bg-panel p-4 transition-transform hover:-translate-y-0.5"
            >
              <Covers covers={live.covers} className="size-20 shrink-0" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-display text-2xl font-semibold">
                  {sessionTitle(live)}
                </span>
                <span className="mt-1 flex items-center gap-2 text-sm font-bold text-muted">
                  <span className="size-2 rounded-full bg-sage" /> Live · {plural(live.item_count, "song")}
                </span>
              </span>
              <span className="flex -space-x-2">
                {(room?.members ?? []).map((m) => (
                  <span key={m} className="overflow-hidden rounded-full border-2 border-panel bg-accent-soft">
                    <Avatar userId={m} size={40} pose="listening" />
                  </span>
                ))}
              </span>
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-strong px-4 font-bold text-on-accent">
                <Headphones className="size-4" /> Open
              </span>
            </Link>
          </section>
        )}
        <section>
          <SectionTitle>Planned</SectionTitle>
          {planned.length ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {planned.map((s) => (
                <PlannedCard key={s.id} s={s} />
              ))}
            </div>
          ) : (
            <Empty>No planned sessions</Empty>
          )}
        </section>
        {ended.length > 0 && (
          <section>
            <SectionTitle>History</SectionTitle>
            <ul className="grid gap-1.5">
              {ended.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-[12px] border-2 border-panel-line bg-panel p-2.5">
                  <Link href={`/together/?id=${s.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Covers covers={s.covers} className="size-12 shrink-0" />
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate font-bold">
                        {sessionTitle(s)}
                      </span>
                      <span className="block text-sm font-semibold text-muted">
                        {s.ended_at && new Date(s.ended_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} · {plural(s.played_count, "song")} ·{" "}
                        {Math.round(s.together_ms / 60_000)} min together
                      </span>
                    </span>
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => void planAgain(s)}>
                    <RotateCcw className="size-4" /> Plan again
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <SessionForm open={creating} onOpenChange={setCreating} />
    </>
  );
}
