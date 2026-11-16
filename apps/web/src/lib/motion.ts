import type { Transition } from "motion/react";

export const soft: Transition = { type: "spring", stiffness: 170, damping: 26 };
export const gentle: Transition = { type: "spring", stiffness: 90, damping: 20 };
export const bouncy: Transition = { type: "spring", stiffness: 300, damping: 18 };
export const fade: Transition = { type: "tween", duration: 0.18, ease: "easeOut" };
