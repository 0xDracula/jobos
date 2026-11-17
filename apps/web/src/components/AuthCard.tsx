"use client";

import type { ReactNode, SyntheticEvent } from "react";

import { PixelIcon } from "./pixel/PixelIcon";
import { inputClass } from "./ui";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-full max-w-sm rounded-sheet border-2 border-b-[5px] border-panel-line bg-panel p-6 shadow-soft">
      <p className="mb-1 flex items-center gap-2 font-display text-lg font-semibold text-accent-strong">
        <PixelIcon name="record" size={30} />
        Jobbos
      </p>
      <h1 className="mb-5 font-display text-[26px] font-semibold leading-tight">{title}</h1>
      {children}
    </section>
  );
}

export function TextInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  dir,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  dir?: "auto";
}) {
  return (
    <label htmlFor={id} className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        dir={dir}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        required
      />
    </label>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-button bg-danger/10 px-3 py-2 text-sm font-bold text-danger">
      {children}
    </p>
  );
}

export const onSubmit = (run: () => void) => (e: SyntheticEvent) => {
  e.preventDefault();
  run();
};

export function tokenFromPath(prefix: string): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === prefix ? (parts[1] ?? "") : "";
}
