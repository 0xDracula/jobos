"use client";

import { Avatar } from "@/avatar";
import { cn } from "@/lib/cn";
import { useMembers } from "@/lib/session";

export function PersonBadge({ userId, size = 26, className }: { userId: string; size?: number; className?: string }) {
  const members = useMembers();
  const name = members.data?.find((u) => u.id === userId)?.display_name ?? "";
  return (
    <span title={name ? `Added by ${name}` : undefined} className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent-soft", className)} style={{ width: size, height: size }}>
      <Avatar userId={userId} size={size} />
    </span>
  );
}
