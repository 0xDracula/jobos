"use client";

import { motion, useReducedMotionConfig } from "motion/react";

import { jarPapers } from "@/lib/paper";

const PAPERS = ["#fde68a", "#f7c6d0", "#d9cdf6", "#cfe5c5", "#fbd5b5", "#cfe3f3"];

const PILE: [number, number, number][] = [
  [30, 118, -8],
  [56, 121, 6],
  [78, 116, -4],
  [40, 104, 10],
  [66, 105, -12],
  [52, 92, 4],
  [32, 90, -14],
  [76, 92, 12],
  [55, 79, -6],
];

function Paper({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r})`}>
      <rect x={-11} y={-7} width={22} height={14} rx={2} fill={color} stroke="#3b2f2a" strokeOpacity={0.25} strokeWidth={0.8} />
      <line x1={-3.5} y1={-7} x2={-3.5} y2={7} stroke="#3b2f2a" strokeOpacity={0.15} strokeWidth={0.8} />
      <line x1={3.5} y1={-7} x2={3.5} y2={7} stroke="#3b2f2a" strokeOpacity={0.15} strokeWidth={0.8} />
    </g>
  );
}

export function JarArt({ left, waiting, className }: { left: number; waiting: boolean; className?: string }) {
  const reduced = useReducedMotionConfig();
  const n = jarPapers(left);
  const pile = PILE.slice(0, waiting ? Math.max(n - 1, 0) : n);
  return (
    <svg viewBox="0 0 120 150" className={className} aria-hidden>
      <defs>
        <radialGradient id="jar-glow">
          <stop offset="0%" stopColor="#ffe6a7" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#ffe6a7" stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={60} cy={144} rx={42} ry={4.5} fill="#1e1b3a" opacity={0.14} />
      {waiting && <circle cx={60} cy={62} r={40} fill="url(#jar-glow)" />}
      <path d="M26 30 h68 v8 q16 6 16 26 v58 q0 22 -22 22 h-56 q-22 0 -22 -22 v-58 q0 -20 16 -26 z" fill="#dfeef9" fillOpacity={0.55} stroke="#8fa6c9" strokeWidth={2.5} />
      {pile.map(([x, y, r], i) => (
        <Paper key={i} x={x} y={y} r={r} color={PAPERS[i % PAPERS.length]} />
      ))}
      {waiting && (
        <motion.g
          animate={reduced ? undefined : { y: [0, -4, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Paper x={60} y={60} r={-6} color="#fff4cf" />
        </motion.g>
      )}
      <path d="M22 70 q0 -14 8 -20" fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={3} strokeLinecap="round" />
      <path d="M22 80 v34" fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
      <rect x={22} y={14} width={76} height={18} rx={5} fill="#d0705f" stroke="#9b4f43" strokeWidth={1.5} />
      <rect x={22} y={14} width={76} height={6} rx={3} fill="#e08c79" />
      <path d="M24 30 q36 8 72 0" fill="none" stroke="#c8a46a" strokeWidth={2} />
      <path d="M94 31 q6 6 2 12 M94 31 q-2 7 4 11" fill="none" stroke="#c8a46a" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}
