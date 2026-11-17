"use client";

import { Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import { pause, setSleep } from "@/player/controls";
import { usePlayer } from "@/player/store";

import { stopAmbient } from "../ambient";
import { useRoom } from "../state";

export function SleepOverlay() {
  const sleep = usePlayer((s) => s.sleep);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (prev.sleep && !s.sleep) useRoom.setState({ sleepMode: false });
      }),
    [],
  );
  const left = sleep?.mode === "time" ? Math.max(0, (sleep.endsAt - now) / 1000) : null;
  const stop = () => {
    setSleep(null);
    pause();
    stopAmbient();
    useRoom.setState({ sleepMode: false });
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sleep mode"
      className="fixed inset-0 z-[60] grid place-items-center bg-[#0b0a22] text-[#f5eef8]"
    >
      <div className="grid justify-items-center gap-6 px-6 text-center">
        <Moon className="size-16 fill-[#fff4d6] text-[#fff4d6] opacity-90" />
        {left != null && <p className="tabular font-display text-5xl font-semibold opacity-80">{fmtTime(left)}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" className="text-[#b9aec6] hover:bg-white/10" onClick={() => useRoom.setState({ sleepMode: false })}>
            Room
          </Button>
          <Button variant="ghost" className="text-[#b9aec6] hover:bg-white/10" onClick={() => useRoom.setState({ sheet: "sleep" })}>
            Settings
          </Button>
          <Button variant="ghost" className="text-[#b9aec6] hover:bg-white/10" onClick={stop}>
            Stop
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
