"use client";

import { Disc3, Heart, MessageCircle, Sun } from "lucide-react";

import { usePresence } from "@/lib/social";

export type Section = { href: string; label: string; icon: typeof Sun; prefixes: string[] };

export const SECTIONS: Section[] = [
  { href: "/", label: "Today", icon: Sun, prefixes: ["/room"] },
  {
    href: "/music/",
    label: "Music",
    icon: Disc3,
    prefixes: ["/music", "/library", "/discover", "/search", "/playlist", "/album", "/artist", "/mix", "/together"],
  },
  { href: "/chat/", label: "Chat", icon: MessageCircle, prefixes: ["/chat"] },
  {
    href: "/us/",
    label: "Us",
    icon: Heart,
    prefixes: [
      "/us", "/song", "/letters", "/jar", "/promises", "/notes", "/memories", "/albums", "/places", "/story", "/soundtrack",
      "/reminds", "/glossary", "/calendar", "/recaps", "/stats", "/question", "/dedications", "/mixtapes", "/scrapbook",
      "/favorites", "/stars", "/profile",
    ],
  },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function sectionActive(pathname: string, s: Section): boolean {
  if (s.href === "/" && pathname === "/") return true;
  return s.prefixes.some((p) => under(pathname, p));
}

export function UnreadBadge({ href, className }: { href: string; className?: string }) {
  const unread = usePresence().data?.unread ?? 0;
  if (href !== "/chat/" || unread === 0) return null;
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
