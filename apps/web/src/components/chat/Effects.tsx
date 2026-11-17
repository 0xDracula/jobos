"use client";

import { useEffect, useState } from "react";

import { effectListeners, type EffectName } from "@/lib/effects";

const SHAPES: Record<string, string[]> = {
  heart: ["xx.xx", "xxxxx", "xxxxx", ".xxx.", "..x.."],
  star: ["..x..", "..x..", "xxxxx", ".xxx.", ".x.x."],
  sparkle: ["..x..", "..x..", "xxxxx", "..x..", "..x.."],
};

function Shape({ rows, color, size }: { rows: string[]; color: string; size: number }) {
  const w = rows[0].length;
  return (
    <svg width={size} height={(size * rows.length) / w} viewBox={`0 0 ${w} ${rows.length}`} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "x" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)))}
    </svg>
  );
}

type Particle = { id: number; style: React.CSSProperties; node: React.ReactNode };

const COLORS: Record<EffectName, string[]> = {
  hearts: ["#e0475a", "#f7a6c4", "#f06a8a", "#ffd1dc"],
  confetti: ["#e0475a", "#ffd23f", "#4985cc", "#5aa37e", "#f7a6c4", "#ff9a3a"],
  sparkles: ["#ffe08a", "#ffffff", "#ffd23f", "#f7a6c4"],
  stars: ["#ffe08a", "#ffffff", "#c6cbe0"],
};

let next = 1;

function burst(kind: EffectName): Particle[] {
  const r = Math.random;
  const pick = (list: string[]) => list[Math.floor(r() * list.length)];
  const count = kind === "confetti" ? 44 : kind === "sparkles" ? 22 : 18;
  return Array.from({ length: count }, () => {
    const id = next++;
    const color = pick(COLORS[kind]);
    const delay = r() * (kind === "sparkles" ? 1 : 0.7);
    if (kind === "confetti") {
      return {
        id,
        node: <span className="block h-[12px] w-[6px]" style={{ background: color }} />,
        style: {
          left: `${r() * 100}%`, top: 0, animation: `fx-fall ${2 + r() * 1.2}s ${delay}s cubic-bezier(.3,.6,.6,1) forwards`,
          "--dx": `${(r() - 0.5) * 30}vw`, "--r": `${(r() - 0.5) * 1080}deg`,
        } as React.CSSProperties,
      };
    }
    if (kind === "hearts") {
      const s = 0.7 + r() * 0.9;
      return {
        id,
        node: <Shape rows={SHAPES.heart} color={color} size={28} />,
        style: {
          left: `${5 + r() * 90}%`, bottom: 0, animation: `fx-rise ${2.2 + r() * 1.2}s ${delay}s ease-out forwards`,
          "--dx": `${(r() - 0.5) * 18}vw`, "--s": s,
        } as React.CSSProperties,
      };
    }
    const s = 0.6 + r() * 1.1;
    return {
      id,
      node: <Shape rows={kind === "stars" ? SHAPES.star : SHAPES.sparkle} color={color} size={kind === "stars" ? 22 : 18} />,
      style: kind === "stars"
        ? { left: `${r() * 100}%`, top: 0, animation: `fx-fall ${3 + r() * 1.5}s ${delay}s linear forwards`, "--dx": `${(r() - 0.5) * 10}vw`, "--r": "0deg" } as React.CSSProperties
        : { left: `${5 + r() * 90}%`, top: `${10 + r() * 75}%`, animation: `fx-twinkle ${1 + r() * 0.8}s ${delay}s ease-in-out forwards`, "--s": s } as React.CSSProperties,
    };
  });
}

export function EffectLayer() {
  const [particles, setParticles] = useState<Particle[]>([]);
  useEffect(() => {
    const fn = (kind: EffectName) => {
      const list = burst(kind);
      setParticles((p) => [...p, ...list]);
      const ids = new Set(list.map((p) => p.id));
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.has(x.id))), 5200);
    };
    effectListeners.add(fn);
    return () => {
      effectListeners.delete(fn);
    };
  }, []);
  if (!particles.length) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {particles.map((p) => (
        <span key={p.id} className="absolute opacity-0" style={p.style}>
          {p.node}
        </span>
      ))}
    </div>
  );
}
