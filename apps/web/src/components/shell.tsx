"use client";

import { Command, House, Library, Search, Settings, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { soft } from "@/lib/motion";
import { usePlaylists } from "@/lib/queries";
import { dismiss, useToasts } from "@/lib/toast";
import { usePalette } from "@/player/shortcuts";
import { usePlayer } from "@/player/store";

import { CommandPalette } from "./CommandPalette";
import { GlobalDialogs } from "./dialogs";
import { Cover } from "./media";
import { PlayerDock } from "./player/Player";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/search/", label: "Search", icon: Search },
  { href: "/library/", label: "Library", icon: Library },
  { href: "/settings/", label: "Settings", icon: Settings },
] as const;

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href.replace(/\/$/, "")));

function Sidebar() {
  const pathname = usePathname();
  const playlists = usePlaylists();
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-1 border-e border-line px-4 pb-28 pt-7 lg:flex">
      <Link href="/" className="mb-5 flex items-center gap-2 px-3 font-display text-[26px] font-semibold text-accent-strong">
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-accent-soft text-lg">♫</span>
        Jobbos
      </Link>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(pathname, href) ? "page" : undefined}
          className={cn(
            "flex min-h-11 items-center gap-3 rounded-button px-3 font-bold transition-colors",
            isActive(pathname, href) ? "bg-accent-soft/80 text-accent-strong" : "text-ink hover:bg-accent-soft/40",
          )}
        >
          <Icon className="size-5" />
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
                <Icon className={cn("size-6", active && "fill-accent-soft")} />
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

export function AppShell({ children }: { children: ReactNode }) {
  const home = usePathname() === "/";
  return (
    <>
      <div id="app-content">
        <Sidebar />
        {home ? (
          <main className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64">{children}</main>
        ) : (
          <main className="lg:ps-64">
            <div className="mx-auto max-w-5xl px-4 pb-[calc(10.5rem+env(safe-area-inset-bottom))] pt-[max(env(safe-area-inset-top),24px)] lg:px-10 lg:pb-36 lg:pt-10">
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
      <div id="live-region" aria-live="polite" className="sr-only" />
    </>
  );
}
