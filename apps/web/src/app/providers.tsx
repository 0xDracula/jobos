"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { deviceId } from "@/lib/device";
import { startInstall } from "@/lib/install";
import { initOffline } from "@/lib/offline";
import { usePrefs } from "@/lib/prefs";
import { prefetchHidden, queryClient } from "@/lib/queries";
import { getEngine } from "@/player/engine";
import { startPrefetch } from "@/player/prefetch";
import { restoreLocal, startResume } from "@/player/resume";
import { startMediaSession } from "@/player/session";
import { startShortcuts } from "@/player/shortcuts";

export function Providers({ children }: { children: ReactNode }) {
  const theme = usePrefs((p) => p.theme);
  const motion = usePrefs((p) => p.motion);

  useEffect(() => {
    void usePrefs.persist.rehydrate();
    initOffline();
    getEngine();
    const stops = [startMediaSession(), startResume(), startPrefetch(), startShortcuts(), startInstall()];
    restoreLocal();
    void prefetchHidden();
    deviceId().catch(() => {});
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker", err));
    }
    return () => stops.forEach((stop) => stop());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (motion === "system") delete root.dataset.motion;
    else root.dataset.motion = motion;
  }, [motion]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={motion === "reduced" ? "always" : motion === "full" ? "never" : "user"}>{children}</MotionConfig>
    </QueryClientProvider>
  );
}
