"use client";

import { EighthNotes } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Artwork({
  src,
  alt = "",
  className,
  eager,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) {
    return (
      <div
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
        className={cn("grid place-items-center bg-gradient-to-br from-accent-soft to-lavender/70 text-accent-strong", className)}
      >
        <EighthNotes aria-hidden className="size-[38%] max-w-16 opacity-70" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn("bg-accent-soft/40 object-cover", className)}
    />
  );
}

export function Cover({ cover, collage, alt, className }: { cover: string | null; collage: string[]; alt?: string; className?: string }) {
  if (cover || collage.length < 4) return <Artwork src={cover ?? collage[0]} alt={alt} className={className} />;
  return (
    <div role="img" aria-label={alt} className={cn("grid grid-cols-2 grid-rows-2 overflow-hidden", className)}>
      {collage.slice(0, 4).map((src) => (
        <Artwork key={src} src={src} className="size-full" />
      ))}
    </div>
  );
}

export function LevelMeter({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-3.5 items-end gap-[2px]", playing && "level-playing", className)}>
      {[0, 1, 2].map((i) => (
        <span key={i} className="level-bar h-full w-[3px] rounded-full bg-current" />
      ))}
    </span>
  );
}

export function MediaCard({
  href,
  onClick,
  image,
  title,
  subtitle,
  round,
}: {
  href?: string;
  onClick?: () => void;
  image: ReactNode;
  title: string;
  subtitle?: string;
  round?: boolean;
}) {
  const body = (
    <>
      <div className={cn("aspect-square overflow-hidden shadow-soft transition-transform group-hover:-translate-y-0.5", round ? "rounded-full" : "rounded-card")}>
        {image}
      </div>
      <div className="mt-2 px-0.5">
        <div dir="auto" className="truncate font-bold">
          {title}
        </div>
        {subtitle && (
          <div dir="auto" className="truncate text-sm font-semibold text-muted">
            {subtitle}
          </div>
        )}
      </div>
    </>
  );
  const cls = "group block min-w-0 rounded-card p-1.5 text-start outline-offset-2 transition-colors hover:bg-accent-soft/30";
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(cls, "w-full")}>
      {body}
    </button>
  );
}

export function CardRow({ children }: { children: ReactNode }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-1 overflow-x-auto px-3 pb-2 lg:-mx-2 lg:px-0 [&>*]:w-36 [&>*]:shrink-0 [&>*]:snap-start lg:[&>*]:w-44">
      {children}
    </div>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>;
}
