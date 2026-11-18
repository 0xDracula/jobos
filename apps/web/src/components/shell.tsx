"use client";

import { WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { soft } from "@/lib/motion";
import { startRealtime } from "@/lib/realtime";
import { isPublicPath, useMe, useMembers } from "@/lib/session";
import { startSocial } from "@/lib/social";
import { startProfiles } from "@/lib/profiles";
import { startGift } from "@/lib/gift";
import { startTogetherState } from "@/lib/together";
import { startSessionEvents } from "@/lib/sessions";
import { startRadioWatch } from "@/player/radio";
import { startTogetherSync } from "@/player/together";
import { dismiss, useToasts } from "@/lib/toast";
import { usePlayer } from "@/player/store";

import { CommandPalette } from "./CommandPalette";
import { SECTIONS, sectionActive, UnreadBadge } from "./nav";
import { Sidebar } from "./Sidebar";
import { GlobalDialogs } from "./dialogs";
import { KeepsakeDialogs } from "./KeepsakeDialogs";
import { EffectLayer } from "./chat/Effects";
import { LettersLayer } from "./letters/LettersLayer";
import { TogetherBanner } from "./Together";
import { PlayerDock } from "./player/Player";
import { SkyBackdrop, SkyToggle } from "./sky/PageHero";

function TabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {SECTIONS.map((sec) => {
          const active = sectionActive(pathname, sec);
          const Icon = sec.icon;
          return (
            <li key={sec.href}>
              <Link
                href={sec.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-bold", active ? "text-ink" : "text-faint")}
              >
                <span className="relative">
                  <Icon className={cn("size-6", active && "text-accent-strong")} />
                  <UnreadBadge href={sec.href} />
                </span>
                {sec.label}
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
    startSessionEvents();
    startTogetherSync(me.data.id);
    startRadioWatch();
    startGift();
    startProfiles();
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
  return <AuthGate>{appFrame(pathname, children)}</AuthGate>;
}

function appFrame(pathname: string, children: ReactNode) {
  const room = pathname === "/room" || pathname === "/room/";
  return (
    <>
      <div id="app-content">
        <Sidebar />
        {room ? (
          <main className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-[88px]">{children}</main>
        ) : pathname === "/" ? (
          <main className="overflow-x-clip lg:ps-[88px]">
            <div className="pb-[calc(10.5rem+env(safe-area-inset-bottom))] lg:pb-32">
              <OfflineBanner />
              {children}
            </div>
          </main>
        ) : (
          <main className="overflow-x-clip lg:ps-[88px]">
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
      <EffectLayer />
      <div id="live-region" aria-live="polite" className="sr-only" />
    </>
  );
}
