"use client";

import { cn } from "@/lib/cn";
import { useMembers } from "@/lib/session";

const TONES = ["#c86b5e", "#5d7fb8", "#6f9a7a", "#9a6fb8"];

export function PersonBadge({ userId, className }: { userId: string; className?: string }) {
  const members = useMembers();
  const i = members.data?.findIndex((u) => u.id === userId) ?? -1;
  const name = i >= 0 ? members.data![i].display_name : "";
  return (
    <span
      role="img"
      aria-label={name ? `Added by ${name}` : "Added"}
      title={name}
      className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold uppercase text-white", className)}
      style={{ background: TONES[Math.max(0, i) % TONES.length] }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
