"use client";

import { Search, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar } from "@/avatar";
import { cn } from "@/lib/cn";
import { useMode } from "@/lib/pair";
import { useIsAdmin, useMe } from "@/lib/session";

import { sectionActive, UnreadBadge, useSections } from "./nav";
import { PixelIcon } from "./pixel/PixelIcon";

const tile = "grid size-12 place-items-center rounded-[14px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink";

export function Sidebar() {
  const pathname = usePathname();
  const me = useMe().data;
  const admin = useIsAdmin();
  const onSettings = pathname.startsWith("/settings");
  const sections = useSections();
  const solo = useMode() === "solo";
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-[88px] flex-col items-center gap-2 border-e border-line bg-sidebar pb-5 pt-5 lg:flex">
      <Link href="/" aria-label="Jobbos, Today" className="mb-1 grid size-12 place-items-center rounded-[14px]">
        <PixelIcon name="record" size={34} />
      </Link>
      {!solo && <Link
        href="/search/"
        aria-label="Search"
        aria-current={pathname.startsWith("/search") ? "page" : undefined}
        className={cn(tile, "mb-2 border border-line bg-surface", pathname.startsWith("/search") && "text-accent-strong")}
      >
        <Search className="size-[22px]" />
      </Link>}
      <ul className="grid gap-1">
        {sections.map((s) => {
          const active = sectionActive(pathname, s) && (solo || !pathname.startsWith("/search"));
          const Icon = s.icon;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative grid w-[68px] justify-items-center gap-1 rounded-[14px] pb-2 pt-2.5 text-xs font-bold transition-colors",
                  active ? "bg-surface-2 text-ink" : "text-faint hover:bg-surface-2/60 hover:text-ink-2",
                )}
              >
                <span className="relative">
                  <Icon className={cn("size-6", active && "text-accent-strong")} strokeWidth={2} />
                  <UnreadBadge href={s.href} />
                </span>
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto grid justify-items-center gap-3">
        {admin && (
          <Link
            href="/admin/"
            aria-label="Admin"
            aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            className={cn(tile, "size-10", pathname.startsWith("/admin") && "bg-surface-2 text-accent-strong")}
          >
            <Shield className="size-5" />
          </Link>
        )}
        {me && (
          <Link
            href="/settings/"
            aria-label="Settings"
            aria-current={onSettings ? "page" : undefined}
            className={cn("grid size-11 place-items-center overflow-hidden rounded-full bg-surface-2 transition-shadow", onSettings && "ring-2 ring-accent ring-offset-2 ring-offset-sidebar")}
          >
            <Avatar userId={me.id} size={44} />
          </Link>
        )}
      </div>
    </nav>
  );
}
