import { cn } from "@/lib/cn";

export function PlaceholderMark({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border border-dashed border-muted/60 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-muted", className)}>Placeholder</span>;
}
