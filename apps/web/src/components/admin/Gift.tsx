"use client";

import Link from "next/link";

import { usePlaceholders } from "@/lib/placeholders";

import { DatesAdmin } from "./gift/Dates";
import { LettersAdmin } from "./gift/Letters";
import { MemoriesAdmin } from "./gift/Memories";
import { Line, Panel } from "./parts";

function Placeholders() {
  const q = usePlaceholders();
  const sets = q.data ?? [];
  const left = sets.reduce((n, s) => n + s.left, 0);
  return (
    <Panel title="Placeholders" action={<span className="tabular text-sm font-bold text-muted">{left} left</span>}>
      {sets.map((s) => (
        <Line key={s.name} label={s.label}>
          <Link href={s.admin} className="tabular text-sm font-bold text-accent-strong">
            {s.left}
          </Link>
        </Line>
      ))}
    </Panel>
  );
}

export function GiftAdmin() {
  return (
    <div className="grid gap-6">
      <Placeholders />
      <LettersAdmin />
      <MemoriesAdmin />
      <DatesAdmin />
    </div>
  );
}
