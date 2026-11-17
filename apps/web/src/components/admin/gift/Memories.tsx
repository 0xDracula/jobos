"use client";

import Link from "next/link";

import { fmtBytes } from "@/lib/format";
import { useMemoriesSummary } from "@/lib/memories";

import { Line, Panel } from "../parts";

const ROWS: [key: string, label: string, href: string][] = [
  ["memories", "Memories", "/memories/"],
  ["albums", "Photo albums", "/albums/"],
  ["photos", "Photos", "/albums/"],
  ["places", "Places", "/places/"],
  ["chapters", "Story chapters", "/story/"],
  ["collections", "Reminds me of you", "/reminds/"],
  ["glossary", "Inside jokes and nicknames", "/glossary/"],
];

export function MemoriesAdmin() {
  const q = useMemoriesSummary();
  const counts = q.data?.counts ?? {};
  const map = q.data?.map;
  return (
    <Panel title="Memories">
      {ROWS.map(([key, label, href]) => {
        const c = counts[key];
        return (
          <Line key={key} label={label} sub={c ? `${c.placeholders} placeholders` : undefined}>
            <Link href={href} className="tabular text-sm font-bold text-accent-strong">
              {c ? c.total : "—"}
            </Link>
          </Line>
        );
      })}
      <Line label="Map data" sub={map?.tiles ? `Build ${map.build ?? "—"}` : "make map"}>
        <span className="tabular text-sm font-bold text-muted">{map ? (map.tiles ? fmtBytes(map.bytes) : "Missing") : "—"}</span>
      </Line>
    </Panel>
  );
}
