"use client";

import { Disc3, Heart, Sun, UserRound, Users } from "lucide-react";

import { useMode } from "@/lib/pair";
import { usePresence } from "@/lib/social";

export type Section = { href: string; label: string; icon: typeof Sun; prefixes: string[] };

const MUSIC_PREFIXES = ["/music", "/library", "/discover", "/playlist", "/album", "/artist", "/mix", "/together", "/search", "/previews"];
const FRIENDS: Section = { href: "/friends/", label: "Friends", icon: Users, prefixes: ["/friends", "/chat", "/people", "/jam"] };
const YOURS = ["/you", "/profile", "/stats", "/recaps", "/settings", "/link"];

export const SECTIONS: Section[] = [
  { href: "/", label: "Today", icon: Sun, prefixes: ["/room"] },
  { href: "/music/", label: "Music", icon: Disc3, prefixes: MUSIC_PREFIXES },
  FRIENDS,
  {
    href: "/us/",
    label: "Us",
    icon: Heart,
    prefixes: [
      "/us", "/song", "/letters", "/jar", "/promises", "/notes", "/memories", "/albums", "/places", "/story", "/soundtrack",
      "/reminds", "/glossary", "/calendar", "/question", "/dedications", "/mixtapes", "/scrapbook", "/favorites", "/stars", ...YOURS,
    ],
  },
];

export const SOLO_SECTIONS: Section[] = [
  { href: "/", label: "Today", icon: Sun, prefixes: ["/room"] },
  { href: "/music/", label: "Music", icon: Disc3, prefixes: MUSIC_PREFIXES },
  FRIENDS,
  { href: "/you/", label: "You", icon: UserRound, prefixes: YOURS },
];

export function useSections(): Section[] {
  return useMode() === "partner" ? SECTIONS : SOLO_SECTIONS;
}

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function sectionActive(pathname: string, s: Section): boolean {
  if (s.href === "/" && pathname === "/") return true;
  return s.prefixes.some((p) => under(pathname, p));
}

export function UnreadBadge({ href, className }: { href: string; className?: string }) {
  const unread = usePresence().data?.unread ?? 0;
  if (href !== "/friends/" || unread === 0) return null;
  return (
    <span
      className={
        className ??
        "absolute -end-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-extrabold leading-none text-on-accent ring-2 ring-sidebar"
      }
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}
