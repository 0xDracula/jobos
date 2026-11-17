"use client";

import { Command, House, Library, MessageCircleHeart, Search, Settings, Shield, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { soft } from "@/lib/motion";
import { usePlaylists } from "@/lib/queries";
import { startRealtime } from "@/lib/realtime";
import { isPublicPath, useIsAdmin, useMe, useMembers } from "@/lib/session";
import { startSocial, usePresence } from "@/lib/social";
import { startGift } from "@/lib/gift";
import { startTogetherState } from "@/lib/together";
import { startRadioWatch } from "@/player/radio";
import { startTogetherSync } from "@/player/together";
import { dismiss, useToasts } from "@/lib/toast";
import { usePalette } from "@/player/shortcuts";
import { usePlayer } from "@/player/store";

import { CommandPalette } from "./CommandPalette";
import { GlobalDialogs } from "./dialogs";
import { KeepsakeDialogs } from "./KeepsakeDialogs";
import { LettersLayer } from "./letters/LettersLayer";
import { TogetherBanner } from "./Together";
import { Cover } from "./media";
import { PixelIcon } from "./pixel/PixelIcon";
import { PlayerDock } from "./player/Player";
import { SkyBackdrop, SkyToggle } from "./sky/PageHero";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/search/", label: "Search", icon: Search },
  { href: "/library/", label: "Library", icon: Library },
  { href: "/chat/", label: "Chat", icon: MessageCircleHeart },
] as const;

function UnreadDot({ href }: { href: string }) {
  const unread = usePresence().data?.unread ?? 0;
  if (href !== "/chat/" || unread === 0) return null;
  return (
    <span className="absolute -end-1.5 -top-1 grid min-w-[18px] place-items-center rounded-full bg-accent-strong px-1 text-[11px] font-extrabold leading-[18px] text-on-accent">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

function Sidebar() {
  const pathname = usePathname();
  const playlists = usePlaylists();
  const admin = useIsAdmin();
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-1 border-e border-line bg-sidebar px-4 pb-28 pt-6 lg:flex">
      <div className="mb-4 flex items-center gap-1">
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-button px-2 py-1 font-display text-[26px] font-semibold text-accent-strong">
          <PixelIcon name="record" size={34} />
          Jobbos
        </Link>
      </div>
      {[...NAV, { href: "/settings/", label: "Settings", icon: Settings }, ...(admin ? [{ href: "/admin/", label: "Admin", icon: Shield }] : [])].map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-button px-3 font-bold transition-colors",
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
      <button
        type="button"
        onClick={() => usePalette.setState({ open: true })}
        className="flex min-h-11 items-center gap-3 rounded-button px-3 font-bold text-ink hover:bg-accent-soft/40"
      >
        <Command className="size-5" />
        Commands
        <kbd className="ms-auto rounded-md border border-line px-1.5 text-xs text-muted">Ctrl K</kbd>
      </button>
      <h2 className="mt-6 px-3 pb-1 text-xs font-extrabold uppercase tracking-wider text-muted">Playlists</h2>
      <div className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {playlists.data?.map((p) => (
          <Link
            key={p.id}
            href={`/playlist/?id=${p.id}`}
            className="flex items-center gap-3 rounded-button px-2 py-1.5 font-semibold hover:bg-accent-soft/40"
          >
            <Cover cover={p.cover_url} collage={p.collage} className="size-9 shrink-0 rounded-[8px]" />
            <span dir="auto" className="truncate">
              {p.name}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-bold", active ? "text-accent-strong" : "text-muted")}
              >
                <span className="relative">
                  <Icon className={cn("size-6", active && "fill-accent-soft")} />
                  <UnreadDot href={href} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Toasts() {
  const items = useToasts((s) => s.items);
  const loaded = usePlayer((s) => s.index >= 0);
  return (
    <div
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4",
        loaded ? "bottom-[calc(10rem+env(safe-area-inset-bottom))] lg:bottom-28" : "bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-8",
      )}
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={soft}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-bg shadow-soft"
          >
            <span dir="auto">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="font-extrabold text-accent-soft underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="mb-4 flex items-center gap-2 rounded-button bg-butter/80 px-4 py-2 text-sm font-bold text-[#5b4a1f]">
      <WifiOff className="size-4" /> Offline
    </div>
  );
}

function toSignIn() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login/?next=${encodeURIComponent(here)}`);
}

function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe();
  useEffect(() => {
    window.addEventListener("jobbos:signed-out", toSignIn);
    return () => window.removeEventListener("jobbos:signed-out", toSignIn);
  }, []);
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  const members = useMembers();
  const nameRef = useRef(new Map<string, string>());
  nameRef.current = new Map((members.data ?? []).map((u) => [u.id, u.display_name]));
  useEffect(() => {
    if (!me.data) return;
    startRealtime();
    startSocial(
      () => me.data!.id,
      (id) => nameRef.current.get(id) ?? "Someone",
    );
    startTogetherState();
    startTogetherSync(me.data.id);
    startRadioWatch();
    startGift();
  }, [me.data]);
  useEffect(() => {
    if (signedOut) toSignIn();
  }, [signedOut]);
  if (me.isPending || signedOut) return <div className="fixed inset-0 bg-bg" aria-busy="true" />;
  return children;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isPublicPath(pathname)) {
    return (
      <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
        <SkyBackdrop />
        <div className="fixed end-[max(12px,env(safe-area-inset-right))] top-[max(12px,env(safe-area-inset-top))] z-10">
          <SkyToggle />
        </div>
        {children}
        <Toasts />
      </main>
    );
  }
  return <AuthGate>{appFrame(pathname === "/", children)}</AuthGate>;
}

function appFrame(home: boolean, children: ReactNode) {
  return (
    <>
      <div id="app-content">
        <Sidebar />
        {home ? (
          <main className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64">{children}</main>
        ) : (
          <main className="overflow-x-clip lg:ps-64">
            <div className="mx-auto max-w-6xl px-4 pb-[calc(10.5rem+env(safe-area-inset-bottom))] pt-[max(env(safe-area-inset-top),24px)] lg:px-10 lg:pb-36 lg:pt-10">
              <OfflineBanner />
              {children}
            </div>
          </main>
        )}
        <TabBar />
      </div>
      <PlayerDock />
      <Toasts />
      <CommandPalette />
      <GlobalDialogs />
      <KeepsakeDialogs />
      <LettersLayer />
      <TogetherBanner />
      <div id="live-region" aria-live="polite" className="sr-only" />
    </>
  );
}
