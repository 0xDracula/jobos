"use client";

import { ChevronRight, Settings } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/avatar";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { MoodChip } from "@/components/profile/Mood";
import { PageHero } from "@/components/sky/PageHero";
import { LinkRow } from "@/components/today/SoloToday";
import { useProfile } from "@/lib/profiles";
import { useMe } from "@/lib/session";

const ROWS = [
  { href: "/stats/", icon: "stats", label: "Stats" },
  { href: "/recaps/", icon: "recap", label: "Recaps" },
] as const;

export default function YouPage() {
  const me = useMe().data;
  const mood = useProfile(me?.id)?.mood;
  return (
    <>
      <PageHero
        title="You"
        actions={
          <Link href="/settings/" aria-label="Settings" className="grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2">
            <Settings className="size-[22px]" />
          </Link>
        }
      />
      <div className="grid max-w-xl gap-3">
        {me && (
          <Link href="/profile/" className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong">
            <span className="overflow-hidden rounded-full bg-surface-2">
              <Avatar userId={me.id} size={56} />
            </span>
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate font-display text-lg">
                {me.display_name}
              </span>
              {mood ? <MoodChip mood={mood} /> : <span className="block text-[13px] font-semibold text-muted">Profile and mood</span>}
            </span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
        )}
        <ul className="grid grid-cols-2 gap-2.5">
          {ROWS.map((r) => (
            <li key={r.href}>
              <Link
                href={r.href}
                className="grid min-h-[100px] content-start justify-items-center gap-2 rounded-card border border-line bg-surface px-1 pb-2.5 pt-3.5 text-center text-[12.5px] font-bold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                <PixelIcon name={r.icon} size={36} />
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <LinkRow />
        </div>
      </div>
    </>
  );
}
