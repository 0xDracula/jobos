"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { beat, tickBeat } from "../beat";
import { placeHotspots, roomView } from "../hotspots";
import { useRoom } from "../state";
import { Kit } from "./kit";
import { PixelRenderer, type RoomInput } from "./renderer";
import { loadRoomArt } from "./rooms";
import type { RoomId } from "./rooms/types";
import { loadSheets } from "./sprites";

export type PixelRoomProps = Omit<RoomInput, "highlight" | "selected"> & {
  room: RoomId;
  hotspotIds: string[];
  inset: number;
  active: boolean;
  playing: boolean;
  onActivate: (id: string) => void;
  onStar?: (id: string) => void;
  onReady?: () => void;
};

const FRAME_MS = 1000 / 12;

export const roomStats = { frames: 0 };

export default function PixelRoom(p: PixelRoomProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<PixelRenderer | null>(null);
  const props = useRef(p);
  props.current = p;
  const draw = useRef<() => void>(() => {});
  const [sides, setSides] = useState({ room: false, roof: false });
  const syncSides = useRef(() => {});
  syncSides.current = () => {
    const r = renderer.current;
    if (!r) return;
    const next = r.hiddenSides();
    setSides((prev) => (prev.room === next.room && prev.roof === next.roof ? prev : next));
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dead = false;
    let raf = 0;
    let last = 0;
    let lastTick = performance.now();
    const start = performance.now();
    const ro = new ResizeObserver(() => {
      const r = renderer.current;
      if (!r) return;
      r.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1, props.current.inset);
      draw.current();
    });

    const paint = (now: number) => {
      const r = renderer.current;
      if (!r) return;
      const s = useRoom.getState();
      r.setInput({ ...props.current, highlight: s.highlight, selected: s.selected });
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      tickBeat(dt, props.current.reducedMotion);
      r.frame((now - start) / 1000, {
        awake: beat.playing > 0.5 || Date.now() < s.kittenAwakeUntil,
        pets: s.pets,
        pulse: beat.pulse,
        playing: beat.playing,
      });
      roomStats.frames++;
      placeHotspots((id) => r.anchor(id));
      syncSides.current();
    };
    draw.current = () => paint(performance.now());

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!props.current.active) return;
      if (props.current.reducedMotion) return;
      if (now - last < FRAME_MS) return;
      last = now;
      paint(now);
    };

    if (process.env.NODE_ENV === "development") (window as unknown as { __room: unknown }).__room = roomStats;
    void Promise.all([loadSheets(), loadRoomArt(props.current.room)]).then(([sheets, art]) => {
      if (dead) return;
      renderer.current = new PixelRenderer(el, new Kit(sheets), art);
      renderer.current.onChange = () => draw.current();
      roomView.reveal = (id) => {
        renderer.current?.reveal(id);
        draw.current();
      };
      roomView.revealDecoration = (id) => {
        const r = renderer.current;
        const spot = r?.decorationSpot(id);
        if (r && spot) r.revealX(spot.x);
        draw.current();
      };
      ro.observe(el);
      renderer.current.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1, props.current.inset);
      paint(performance.now());
      props.current.onReady?.();
      raf = requestAnimationFrame(loop);
    });
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      roomView.reveal = () => {};
      roomView.revealDecoration = () => {};
    };
  }, []);

  useEffect(() => {
    let dead = false;
    const r = renderer.current;
    if (!r || r.roomId === p.room) return;
    void loadRoomArt(p.room).then((art) => {
      if (dead || !renderer.current) return;
      renderer.current.setArt(art);
      draw.current();
    });
    return () => {
      dead = true;
    };
  }, [p.room]);

  useEffect(() => {
    const r = renderer.current;
    const el = ref.current;
    if (r && el) r.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1, p.inset);
    draw.current();
  }, [p]);
  useEffect(() => useRoom.subscribe(() => draw.current()), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down: { id: number; x: number; y: number; moved: boolean } | null = null;
    const local = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const r = renderer.current;
      if (!r) return;
      if (down && down.id === e.pointerId) {
        const dx = e.clientX - down.x;
        if (!down.moved && Math.abs(dx) > 6) {
          down.moved = true;
          el.setPointerCapture(e.pointerId);
        }
        if (down.moved) {
          r.panBy(dx);
          down.x = e.clientX;
          down.y = e.clientY;
          draw.current();
        }
        return;
      }
      if (e.pointerType !== "mouse") return;
      const { x, y } = local(e);
      const id = r.hit(x, y, props.current.hotspotIds);
      const star = id ? null : r.hitStar(x, y);
      el.style.cursor = id || star ? "pointer" : r.canPan() ? "grab" : "default";
      if (useRoom.getState().highlight !== id) useRoom.setState({ highlight: id });
    };
    const onUp = (e: PointerEvent) => {
      const r = renderer.current;
      if (!r || !down || down.id !== e.pointerId) return;
      const tap = !down.moved;
      down = null;
      if (!tap) return;
      const { x, y } = local(e);
      const id = r.hit(x, y, props.current.hotspotIds);
      if (id) return props.current.onActivate(id);
      const star = r.hitStar(x, y);
      if (star) props.current.onStar?.(star);
    };
    const onLeave = () => {
      if (useRoom.getState().highlight) useRoom.setState({ highlight: null });
    };
    const onWheel = (e: WheelEvent) => {
      const r = renderer.current;
      if (!r || !r.canPan()) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!d) return;
      e.preventDefault();
      r.panBy(-d);
      draw.current();
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", () => (down = null));
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const pan = (side: "room" | "roof") => {
    renderer.current?.show(side);
    draw.current();
  };
  const edge = "pointer-events-auto absolute top-[58%] grid size-11 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-[#1e1b3a]/55 text-[#f5eef8] shadow-soft backdrop-blur-md";
  return (
    <>
      <canvas ref={ref} aria-hidden className="block size-full touch-pan-y [image-rendering:pixelated]" />
      {sides.room && (
        <button type="button" aria-label="Show the room" onClick={() => pan("room")} className={`${edge} left-2`}>
          <ChevronLeft className="size-5" />
        </button>
      )}
      {sides.roof && (
        <button type="button" aria-label="Show the roof" onClick={() => pan("roof")} className={`${edge} right-2`}>
          <ChevronRight className="size-5" />
        </button>
      )}
    </>
  );
}
