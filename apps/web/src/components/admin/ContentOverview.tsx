"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { request } from "@/lib/api";

import { Line, Panel } from "./parts";

type Count = { kind: string; total: number; placeholders: number; drafts: number; scheduled: number };

const KINDS: Record<string, { label: string; href: string; scheduled?: string }> = {
  welcome: { label: "Welcome letter", href: "/admin/#gift" },
  letters: { label: "Letters", href: "/letters/?tab=written", scheduled: "locked" },
  "notes:daily": { label: "Daily notes", href: "/jar/", scheduled: "in the jar" },
  "notes:morning": { label: "Morning notes", href: "/jar/", scheduled: "in the jar" },
  "notes:night": { label: "Night notes", href: "/jar/", scheduled: "in the jar" },
  hidden_notes: { label: "Hidden notes", href: "#hidden-notes", scheduled: "locked" },
  song_notes: { label: "Song notes", href: "/notes/" },
  dedications: { label: "Dedications", href: "/dedications/" },
  mixtapes: { label: "Mixtapes", href: "/mixtapes/" },
  songs_of_the_day: { label: "Songs of the day", href: "/song-of-the-day/", scheduled: "ahead" },
  promises: { label: "Promises", href: "/promises/" },
  questions: { label: "Daily questions", href: "#daily-questions", scheduled: "waiting" },
  memories: { label: "Memories", href: "/memories/" },
  story_chapters: { label: "Story chapters", href: "/story/" },
  places: { label: "Places", href: "/places/" },
  glossary: { label: "Inside jokes and nicknames", href: "/glossary/" },
  recap_notes: { label: "Recap notes", href: "/recaps/" },
};

function Open({ href }: { href: string }) {
  const cls = "text-sm font-bold text-accent-strong";
  if (!href.startsWith("#")) {
    return (
      <Link href={href} className={cls}>
        Open
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" })}>
      Open
    </button>
  );
}

export function ContentOverview() {
  const q = useQuery({ queryKey: ["admin", "content"], queryFn: async () => (await request<{ counts: Count[] }>("/api/admin/content")).counts });
  return (
    <Panel title="Content">
      {q.data?.map((c) => {
        const k = KINDS[c.kind];
        if (!k) return null;
        const sub = [
          `${c.total}`,
          c.drafts ? `${c.drafts} ${c.drafts === 1 ? "draft" : "drafts"}` : "",
          c.scheduled && k.scheduled ? `${c.scheduled} ${k.scheduled}` : "",
          c.placeholders ? `${c.placeholders} ${c.placeholders === 1 ? "placeholder" : "placeholders"}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Line key={c.kind} label={k.label} sub={sub}>
            <Open href={k.href} />
          </Line>
        );
      })}
      <Line label="Holidays" sub="Dates, decorations and playlists">
        <Open href="#holidays" />
      </Line>
      <Line label="Milestones" sub="Start date and unlocks">
        <Open href="/admin/#room" />
      </Line>
    </Panel>
  );
}
