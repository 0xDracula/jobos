"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

import { Dialog } from "../dialogs";
import { Button, IconButton } from "../ui";

export function Panel({ title, action, children, className, id }: { title: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mb-8 scroll-mt-6", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {action}
      </div>
      <div className="grid grid-cols-1 gap-1 rounded-card bg-surface-solid/60 p-2 shadow-soft">{children}</div>
    </section>
  );
}

export function Line({ label, children, sub }: { label: ReactNode; children?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0">
        <div className="font-bold">{label}</div>
        {sub && <div className="text-sm font-semibold text-muted">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-card bg-surface p-3">
      <div className="text-xs font-extrabold text-muted">{label}</div>
      <div
        className={cn(
          "tabular font-display text-2xl font-semibold",
          tone === "good" && "text-[color:var(--ok,#3f8f5a)]",
          tone === "warn" && "text-accent-strong",
          tone === "bad" && "text-danger",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Bar({ parts, total }: { parts: { value: number; className: string; label: string }[]; total: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts.map((p) => (
        <span key={p.label} className={p.className} style={{ width: `${total ? (p.value / total) * 100 : 0}%` }} />
      ))}
    </div>
  );
}

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function LinkDialog({ link, title, onClose }: { link: string | null; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast("Copy failed");
    }
  };
  return (
    <Dialog
      open={!!link}
      onOpenChange={(o) => {
        if (!o) {
          setCopied(false);
          onClose();
        }
      }}
      title={title}
    >
      <div className="grid gap-3">
        <div className="flex items-center gap-2 rounded-button border border-line bg-surface p-2">
          <code className="min-w-0 flex-1 select-all break-all text-sm">{link}</code>
          <IconButton label="Copy link" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
          </IconButton>
        </div>
        <p className="text-sm font-semibold text-muted">Shown once</p>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
