"use client";

import { MessageCircleQuestion, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Handwriting } from "@/components/letters/Handwriting";
import { SongPicker, SongRow } from "@/components/letters/SongPicker";
import { Button, IconButton, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { profileKeys, profilesApi, useQuestion, type AnsweredQuestion, type DailyAnswer } from "@/lib/profiles";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

const panel = "rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel";

const dayLabel = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : "");

function Answer({ a, name }: { a: DailyAnswer | null; name: string }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-surface p-3">
      <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{name}</p>
      {!a ? (
        <p className="mt-1 font-semibold text-muted">No answer</p>
      ) : (
        <>
          {a.track && (
            <SongRow track={a.track}>
              <IconButton label={`Play ${a.track.title}`} onClick={() => playTracks([a.track!], 0, { type: "queue", name: "Daily question" })}>
                <Play />
              </IconButton>
            </SongRow>
          )}
          {a.body && (
            <Handwriting authorId={a.user_id} className="mt-1 whitespace-pre-wrap text-[21px] leading-snug">
              {a.body}
            </Handwriting>
          )}
        </>
      )}
    </div>
  );
}

export function TodayQuestion({ q }: { q: AnsweredQuestion }) {
  const me = useMe().data;
  const members = useMembers();
  const other = members.data?.find((u) => u.id !== me?.id);
  const [body, setBody] = useState(q.mine?.body ?? "");
  const [track, setTrack] = useState<Track | null>(q.mine?.track ?? null);
  const [editing, setEditing] = useState(!q.mine);
  const save = async () => {
    try {
      await profilesApi.answer(q.id, body.trim(), track?.id ?? null);
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: profileKeys.question });
    } catch {
      toast("Answer not saved");
    }
  };
  const ready = q.kind === "song" ? !!track : !!body.trim();
  return (
    <section className={cn(panel, "grid gap-4 p-4")}>
      <div>
        <p className="text-xs font-extrabold uppercase tracking-wide text-accent-strong">{q.kind === "song" ? "Music question" : "Question"}</p>
        <p dir="auto" className="mt-1 font-display text-2xl font-semibold leading-snug">
          {q.body}
        </p>
      </div>
      {q.theirs ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Answer a={q.mine} name="You" />
          <Answer a={q.theirs} name={other?.display_name ?? ""} />
        </div>
      ) : editing ? (
        <div className="grid gap-3">
          {q.kind === "song" && <SongPicker value={track} onChange={setTrack} label="Your song" />}
          <textarea
            dir="auto"
            rows={3}
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={q.kind === "song" ? "Note" : "Your answer"}
            aria-label={q.kind === "song" ? "Note" : "Your answer"}
            className={cn(inputClass, "min-h-24 py-2")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={!ready}>
              {q.mine ? "Save answer" : "Answer"}
            </Button>
            {q.mine && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <Answer a={q.mine} name="You" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-muted">{q.they_answered ? `${other?.display_name ?? ""} answered` : `Waiting for ${other?.display_name ?? ""}`}</p>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function PastQuestion({ q }: { q: AnsweredQuestion }) {
  const me = useMe().data;
  const members = useMembers();
  const other = members.data?.find((u) => u.id !== me?.id);
  return (
    <li className={cn(panel, "grid gap-3 p-4")}>
      <div>
        <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{dayLabel(q.asked_on)}</p>
        <p dir="auto" className="font-display text-lg font-semibold">
          {q.body}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Answer a={q.mine} name="You" />
        {q.theirs || !q.they_answered ? (
          <Answer a={q.theirs} name={other?.display_name ?? ""} />
        ) : (
          <div className="rounded-[10px] bg-surface p-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{other?.display_name}</p>
            <p className="mt-1 font-semibold text-muted">Hidden</p>
          </div>
        )}
      </div>
    </li>
  );
}

export function DailyQuestionHome({ className }: { className?: string }) {
  const q = useQuestion().data?.today;
  if (!q || q.mine) return null;
  return (
    <section aria-label="Daily question" className={cn("flex items-center gap-3 rounded-card bg-surface-solid/80 p-3 shadow-soft backdrop-blur", className)}>
      <span className="grid size-12 shrink-0 place-items-center rounded-button bg-accent-soft text-accent-strong">
        <MessageCircleQuestion className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-extrabold uppercase tracking-wider text-accent-strong">Daily question</p>
        <p dir="auto" className="line-clamp-2 font-bold">
          {q.body}
        </p>
      </div>
      <Link href="/question/" className="shrink-0 rounded-button bg-accent-strong px-4 py-2 font-bold text-on-accent shadow-soft">
        Answer
      </Link>
    </section>
  );
}
