import { create } from "zustand";

export type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }));

let counter = 0;

export function toast(text: string, action?: Toast["action"]): void {
  const id = ++counter;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text, action }] }));
  setTimeout(() => dismiss(id), action ? 5000 : 2600);
}

export function dismiss(id: number): void {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
}
