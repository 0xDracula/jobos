"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { reactionListeners } from "@/lib/sessions";
import { react } from "@/player/together";

export const REACTIONS = ["❤️", "😂", "🔥", "🎶", "🥹", "😭"];

export function ReactionBar({ className }: { className?: string }) {
  return (
    <div role="group" aria-label="Reactions" className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          aria-label={`React ${e}`}
          onClick={() => react(e)}
          className="grid size-11 place-items-center rounded-full border-2 border-panel-line bg-panel text-xl transition-transform hover:-translate-y-0.5 active:scale-90"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

type Floating = { id: number; emoji: string; x: number };

export function ReactionLayer() {
  const [items, setItems] = useState<Floating[]>([]);
  useEffect(() => {
    let n = 0;
    const fn = (r: { emoji: string }) => {
      const id = ++n;
      setItems((list) => [...list.slice(-12), { id, emoji: r.emoji, x: 8 + Math.random() * 18 }]);
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 2600);
    };
    reactionListeners.add(fn);
    return () => {
      reactionListeners.delete(fn);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <AnimatePresence>
        {items.map((i) => (
          <motion.span
            key={i.id}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -320, scale: 1.15 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.4, ease: "easeOut" }}
            style={{ right: `${i.x}%` }}
            className="absolute bottom-40 text-4xl drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]"
          >
            {i.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
