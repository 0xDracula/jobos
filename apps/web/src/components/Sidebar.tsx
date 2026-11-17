"use client";

import { House, Library, MessageCircleHeart, Search, Settings, Shield, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { Avatar } from "@/avatar";
import { cn } from "@/lib/cn";
import { useProfile } from "@/lib/profiles";
import { usePlaylists } from "@/lib/queries";
import { openSessions, sessionTitle, sessionWhen, useSessions } from "@/lib/sessions";
import { useIsAdmin, useMe, useMembers } from "@/lib/session";
import { usePresence } from "@/lib/social";
import { useTogether } from "@/lib/together";

import { Cover } from "./media";
import { MoodChip } from "./profile/Mood";
import { PixelIcon, type PixelIconName } from "./pixel/PixelIcon";
import { SkyScene, seedOf } from "./sky/PageHero";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/search/", label: "Search", icon: Search },
  { href: "/library/", label: "Library", icon: Library },
  { href: "/chat/", label: "Chat", icon: MessageCircleHeart },
] as const;

const KEEPSAKES: { href: string; label: string; icon: PixelIconName }[] = [
  { href: "/song/", label: "Our song", icon: "record" },
  { href: "/letters/", label: "Letters", icon: "envelope" },
  { href: "/memories/", label: "Memories", icon: "polaroid" },
  { href: "/calendar/", label: "Calendar", icon: "calendar" },
  { href: "/places/", label: "Places", icon: "globe" },
];

const SKY_SEED = seedOf("sidebar");

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

const heading = "px-3 pb-1 text-xs font-extrabold uppercase tracking-wider text-muted";
const card = "flex items-center gap-3 rounded-[12px] border-2 border-b-4 border-panel-line bg-panel p-2.5 transition-transform hover:-translate-y-0.5";

function UnreadDot({ href }: { href: string }) {
  const unread = usePresence().data?.unread ?? 0;
  if (href !== "/chat/" || unread === 0) return null;
  return (
    <span className="absolute -end-1.5 -top-1 grid min-w-[18px] place-items-center rounded-full bg-accent-strong px-1 text-[11px] font-extrabold leading-[18px] text-on-accent">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

function TogetherCard() {
  const sessions = useSessions().data;
  const room = useTogether().data;
  const open = openSessions(sessions);
  const live = room?.active ? open.find((s) => s.id === room.session_id) : undefined;
  const next = live ?? open.find((s) => s.status === "planned");
  return (
    <Link href={next ? `/together/?id=${next.id}` : "/together/"} className={card}>
      <PixelIcon name="headphones" size={30} className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-[11px] font-extrabold uppercase tracking-wider text-muted">{live ? "Live now" : next ? "Next session" : "Listen together"}</span>
        <span dir="auto" className="block truncate font-bold">
          {next ? sessionTitle(next) : "New session"}
        </span>
        {next && !live && <span className="block truncate text-xs font-semibold text-muted">{sessionWhen(next.scheduled_at)}</span>}
      </span>
      {live && <span aria-hidden className="ms-auto size-2 shrink-0 rounded-full bg-sage" />}
    </Link>
  );
}

function PersonCard() {
  const me = useMe().data;
  const members = useMembers().data;
  const presence = usePresence().data;
  const admin = useIsAdmin();
  const other = members?.find((u) => u.id !== me?.id);
  const profile = useProfile(other?.id);
  if (!other) {
    return admin ? (
      <Link href="/admin/#people" className={card}>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
          <UserPlus className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-bold">Invite</span>
          <span className="block text-xs font-semibold text-muted">No one else yet</span>
        </span>
      </Link>
    ) : null;
  }
  const p = presence?.people.find((x) => x.id === other.id);
  const status = p?.listening ? "Listening" : p?.online ? "Online" : "Away";
  return (
    <Link href={`/profile/?id=${other.id}`} className={card}>
      <span className="relative shrink-0 overflow-hidden rounded-full bg-accent-soft">
        <Avatar userId={other.id} size={40} pose={p?.listening ? "listening" : "idle"} />
      </span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate font-bold">
          {other.display_name}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <span aria-hidden className={cn("size-2 rounded-full", p?.online ? "bg-sage" : "bg-muted/50")} />
          {status}
          {p?.quiet ? " · Quiet" : ""}
        </span>
        {profile?.mood && <MoodChip mood={profile.mood} className="mt-0.5 text-xs font-bold" />}
      </span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const playlists = usePlaylists();
  const admin = useIsAdmin();
  const nav = useMemo(
    () => [...NAV, { href: "/settings/", label: "Settings", icon: Settings }, ...(admin ? [{ href: "/admin/", label: "Admin", icon: Shield }] : [])],
    [admin],
  );
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-e border-line bg-sidebar px-4 pt-6 lg:flex">
      <Link href="/" className="mb-3 flex items-center gap-2.5 rounded-button px-2 py-1 font-display text-[26px] font-semibold text-accent-strong">
        <PixelIcon name="record" size={34} />
        Jobbos
      </Link>
      <div className="grid gap-0.5">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-button px-3 font-bold transition-colors",
              isActive(pathname, href) ? "bg-accent-soft/80 text-accent-strong" : "text-ink hover:bg-accent-soft/40",
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              <UnreadDot href={href} />
            </span>
            {label}
          </Link>
        ))}
      </div>

      <div className="no-scrollbar relative z-10 -mx-1 mt-4 min-h-0 flex-1 overflow-y-auto px-1 pb-20">
      <div className="grid gap-2">
        <TogetherCard />
        <PersonCard />
      </div>

      <h2 className={cn(heading, "mt-5")}>Keepsakes</h2>
      <div className="grid gap-0.5">
        {KEEPSAKES.map((k) => (
          <Link
            key={k.href}
            href={k.href}
            aria-current={isActive(pathname, k.href) ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center gap-3 rounded-button px-2.5 text-[15px] font-bold transition-colors",
              isActive(pathname, k.href) ? "bg-accent-soft/80 text-accent-strong" : "text-ink hover:bg-accent-soft/40",
            )}
          >
            <PixelIcon name={k.icon} size={22} />
            {k.label}
          </Link>
        ))}
      </div>

      <h2 className={cn(heading, "mt-5")}>Playlists</h2>
      <div>
        {playlists.data?.map((p) => (
          <Link key={p.id} href={`/playlist/?id=${p.id}`} className="flex items-center gap-3 rounded-button px-2 py-1.5 font-semibold hover:bg-accent-soft/40">
            <Cover cover={p.cover_url} collage={p.collage} className="size-9 shrink-0 rounded-[8px]" />
            <span dir="auto" className="truncate">
              {p.name}
            </span>
          </Link>
        ))}
      </div>
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 overflow-hidden [mask-image:linear-gradient(transparent,black_60%)]">
        <SkyScene seed={SKY_SEED} />
      </div>
    </nav>
  );
}
