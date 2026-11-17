"use client";

import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { datesApi, datesKeys, type Recap } from "@/lib/dates";
import { soft } from "@/lib/motion";
import { queryClient } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { useResolvedTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";

import { fmtDay, fmtMonth } from "./parts";
import { SLIDE_THEMES, SlideCard } from "./RecapSlides";

const SWIPE = 60;

const storyButton =
  "grid size-11 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-30";

async function saveSlide(node: HTMLElement, name: string, background: string) {
  const { domToPng } = await import("modern-screenshot");
  await document.fonts.ready;
  const width = node.offsetWidth;
  const url = await domToPng(node, {
    width,
    height: Math.round((width * 16) / 9),
    scale: 1080 / width,
    backgroundColor: background,
    style: { borderRadius: "0" },
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export const recapTitle = (r: Pick<Recap, "period" | "starts_on" | "ends_on">) =>
  r.period === "month" ? fmtMonth(r.starts_on) : `${fmtDay(r.starts_on)} – ${fmtDay(r.ends_on)}`;

export function RecapStory({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  const members = useMembers().data ?? [];
  const theme = useResolvedTheme();
  const [picked, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const slideNode = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const count = recap.slides.length;
  const index = Math.min(picked, count - 1);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= count) return;
      setDir(to > index ? 1 : -1);
      setIndex(to);
    },
    [count, index],
  );

  useEffect(() => {
    dialogRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    if (recap.preview) return;
    datesApi
      .opened(recap.period, recap.starts_on)
      .then(() => queryClient.invalidateQueries({ queryKey: datesKeys.recaps }))
      .catch(() => {});
  }, [recap.preview, recap.period, recap.starts_on]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onClose]);

  const save = async () => {
    if (!slideNode.current) return;
    setSaving(true);
    try {
      await saveSlide(slideNode.current, `jobbos-recap-${recap.starts_on}-${index + 1}.png`, theme === "night" ? "#15163b" : "#cfe3f3");
    } catch {
      toast("Image not saved");
    } finally {
      setSaving(false);
    }
  };

  const slide = recap.slides[index];
  const label = `${recap.period === "month" ? "Monthly recap" : "Year recap"}, ${recapTitle(recap)}`;

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-[85] outline-none flex flex-col items-center justify-center bg-[#0b0a1e]/85 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-[max(env(safe-area-inset-top),12px)] backdrop-blur-sm">
      <div className="flex w-[min(100%,calc((100dvh-150px)*9/16),440px)] flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1" aria-hidden>
            {recap.slides.map((_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <span className={cn("block h-full rounded-full bg-white transition-[width] duration-300", i <= index ? "w-full" : "w-0")} />
              </span>
            ))}
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className={storyButton}>
            <X className="size-5" />
          </button>
        </div>
        {recap.preview && (
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-white/80">
            <span className="inline-flex items-center rounded-full border border-dashed border-white/50 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide">Preview</span>
            {recap.hidden.includes("listening") && "Listening history not visible"}
          </div>
        )}
        <div ref={stageRef} className="relative aspect-[9/16] w-full">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={index}
              custom={dir}
              className="absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing"
              variants={{
                enter: (d: number) => ({ x: `${d * 35}%`, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: `${d * -35}%`, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={soft}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.5}
              onTapStart={() => {
                dragged.current = false;
              }}
              onDragStart={() => {
                dragged.current = true;
              }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -SWIPE || info.velocity.x < -500) go(index + 1);
                else if (info.offset.x > SWIPE || info.velocity.x > 500) go(index - 1);
              }}
              onTap={(_, info) => {
                if (dragged.current) return;
                const box = stageRef.current?.getBoundingClientRect();
                if (!box) return;
                if (info.point.x - window.scrollX < box.left + box.width * 0.3) go(index - 1);
                else go(index + 1);
              }}
            >
              <SlideCard
                slide={slide}
                index={index}
                recap={recap}
                members={members}
                theme={theme}
                slideRef={(el) => {
                  slideNode.current = el;
                }}
              />
            </motion.div>
          </AnimatePresence>
          <div className="absolute -left-14 top-1/2 hidden -translate-y-1/2 lg:block">
            <button type="button" aria-label="Previous slide" title="Previous slide" onClick={() => go(index - 1)} disabled={index === 0} className={storyButton}>
              <ChevronLeft className="size-5" />
            </button>
          </div>
          <div className="absolute -right-14 top-1/2 hidden -translate-y-1/2 lg:block">
            <button type="button" aria-label="Next slide" title="Next slide" onClick={() => go(index + 1)} disabled={index === count - 1} className={storyButton}>
              <ChevronRight className="size-5" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-white">
          <span className="tabular text-sm font-bold text-white/75" aria-live="polite">
            {index + 1} / {count}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-bold hover:bg-white/25 disabled:opacity-60"
            style={{ color: SLIDE_THEMES.night.text }}
          >
            {saving ? <Spinner className="size-4" /> : <Download className="size-4" />}
            Save image
          </button>
        </div>
      </div>
    </div>
  );
}
