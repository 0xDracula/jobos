"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ImagePlus, Images, Play, Trash2, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useDebounced } from "@/components/common";
import { Dialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Button, Chip, Empty, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/days";
import { memoriesApi, usePhotoAlbum, usePhotoAlbums, waitForPhoto, type Photo } from "@/lib/memories";
import { usePrefs } from "@/lib/prefs";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { usePlayer } from "@/player/store";

export function useReducedMotionPref(): boolean {
  const pref = usePrefs((p) => p.motion);
  const os = useReducedMotion();
  return pref === "reduced" || (pref === "system" && !!os);
}

export function useNameOf(): (id: string | null | undefined) => string {
  const members = useMembers();
  return (id) => members.data?.find((u) => u.id === id)?.display_name ?? "";
}

export function playSong(track: Track | null | undefined, name: string) {
  if (!track) return;
  const s = usePlayer.getState();
  const current = s.index >= 0 ? s.queue[s.index]?.track.id : null;
  if (current === track.id) {
    if (!s.playing) usePlayer.setState({ playing: true });
    return;
  }
  playTracks([track], 0, { type: "queue", name });
}

export function PhotoImage({
  photo,
  size = "thumb",
  className,
  alt = "",
  eager,
  fit = "cover",
}: {
  photo: Photo | null | undefined;
  size?: "thumb" | "display";
  className?: string;
  alt?: string;
  eager?: boolean;
  fit?: "cover" | "contain";
}) {
  const [failed, setFailed] = useState(false);
  const src = photo ? (size === "thumb" ? (photo.thumb_url ?? photo.url) : (photo.url ?? photo.thumb_url)) : null;
  const bg = photo?.color ?? undefined;
  if (!photo || photo.status === "failed" || failed || (photo.status === "ready" && !src)) {
    return (
      <div role={alt ? "img" : undefined} aria-label={alt || undefined} className={cn("grid place-items-center bg-gradient-to-br from-accent-soft to-lavender/70", className)}>
        <Images aria-hidden className="size-[30%] max-w-12 text-accent-strong opacity-60" />
      </div>
    );
  }
  if (photo.status === "processing") {
    return (
      <div aria-label="Processing" role="img" className={cn("grid place-items-center bg-accent-soft/60", className)} style={{ background: bg }}>
        <Spinner className="size-6 text-muted" />
      </div>
    );
  }
  return (
    <img
      src={src!}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ backgroundColor: bg }}
      className={cn(fit === "cover" ? "object-cover" : "object-contain", photo.placeholder && "[image-rendering:pixelated]", className)}
    />
  );
}

export function SongChip({ track, name, className }: { track: Track | null | undefined; name: string; className?: string }) {
  const playing = usePlayer((s) => s.playing && s.index >= 0 && s.queue[s.index]?.track.id === track?.id);
  if (!track) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        playSong(track, name);
      }}
      aria-label={`Play ${track.title}`}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border-2 border-panel-line bg-panel py-1 pe-3 ps-1 text-start shadow-soft transition-transform hover:-translate-y-0.5",
        className,
      )}
    >
      <span className="relative size-8 shrink-0 overflow-hidden rounded-full">
        <Artwork src={track.artwork_thumb_url} className="size-full" />
        <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
          <Play className={cn("size-3.5 fill-current", playing && "opacity-0")} />
        </span>
      </span>
      <span className="min-w-0">
        <span dir="auto" className="block truncate text-sm font-extrabold leading-tight">
          {track.title}
        </span>
        <span dir="auto" className="block truncate text-xs font-semibold leading-tight text-muted">
          {track.artists.join(", ")}
        </span>
      </span>
    </button>
  );
}

export function Byline({ userId, date, className }: { userId?: string | null; date?: string | null; className?: string }) {
  const nameOf = useNameOf();
  const parts = [nameOf(userId), fmtDay(date)].filter(Boolean);
  if (!parts.length) return null;
  return <p className={cn("text-xs font-bold text-muted", className)}>{parts.join(" · ")}</p>;
}

export function SongField({ value, onChange, label = "Song" }: { value: Track | null; onChange: (t: Track | null) => void; label?: string }) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);
  const results = useQuery({ queryKey: ["library-search", q], queryFn: async () => (await api.searchLibrary(q)).tracks, enabled: q.length > 1 });
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted">{label}</span>
      {value ? (
        <div className="flex items-center gap-3 rounded-[12px] border-2 border-panel-line bg-panel p-2">
          <Artwork src={value.artwork_thumb_url} className="size-11 shrink-0 rounded-[8px]" />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate font-bold">
              {value.title}
            </span>
            <span dir="auto" className="block truncate text-sm font-semibold text-muted">
              {value.artists.join(", ")}
            </span>
          </span>
          <IconButton label="Remove song" size="sm" onClick={() => onChange(null)}>
            <X />
          </IconButton>
        </div>
      ) : (
        <>
          <input aria-label={`${label} search`} placeholder="Find a song" dir="auto" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.isFetching && <Spinner className="size-5 text-muted" />}
          {!!results.data?.length && (
            <ul className="grid max-h-60 gap-1 overflow-y-auto">
              {results.data.slice(0, 12).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(t);
                      setSearch("");
                    }}
                    className="flex min-h-11 w-full items-center gap-3 rounded-button p-1.5 text-start hover:bg-accent-soft/50"
                  >
                    <Artwork src={t.artwork_thumb_url} className="size-10 shrink-0 rounded-[8px]" />
                    <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">
                      {t.title} · {t.artists.join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const PHOTO_TYPES = "image/jpeg,image/png,image/webp";

export async function uploadPhotos(files: File[], albumId: string | null = null): Promise<Photo[]> {
  const out: Photo[] = [];
  for (const file of files) {
    try {
      out.push(await memoriesApi.uploadPhoto(file, { albumId }));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Photo not uploaded");
    }
  }
  return out;
}

export function UploadButton({
  onFiles,
  multiple,
  children,
  variant = "soft",
  size = "md",
  disabled,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  children: ReactNode;
  variant?: "primary" | "soft" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button variant={variant} size={size} disabled={disabled} onClick={() => input.current?.click()}>
        {children}
      </Button>
    </>
  );
}

export function AlbumPhotoPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: Photo) => void }) {
  const albums = usePhotoAlbums();
  const [albumId, setAlbumId] = useState<string | null>(null);
  const list = albums.data ?? [];
  const current = albumId ?? list[0]?.id ?? null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Photo from albums" wide>
      <div className="grid gap-3">
        {albums.data && !list.length && <Empty>No albums</Empty>}
        <div className="flex flex-wrap gap-2">
          {list.map((a) => (
            <Chip key={a.id} selected={a.id === current} onClick={() => setAlbumId(a.id)}>
              <span dir="auto">{a.name}</span>
            </Chip>
          ))}
        </div>
        {open && current && <AlbumPhotoGrid albumId={current} onPick={onPick} />}
      </div>
    </Dialog>
  );
}

function AlbumPhotoGrid({ albumId, onPick }: { albumId: string | null; onPick: (p: Photo) => void }) {
  const album = usePhotoAlbum(albumId);
  if (album.isLoading) return <Spinner className="size-6 text-muted" />;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {album.data?.photos
        .filter((p) => p.status === "ready")
        .map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="block aspect-square w-full overflow-hidden rounded-[8px] hover:opacity-90" aria-label={p.caption || "Photo"}>
              <PhotoImage photo={p} className="size-full" />
            </button>
          </li>
        ))}
    </ul>
  );
}

export function PhotoField({ value, onChange, label = "Photo" }: { value: Photo | null; onChange: (p: Photo | null) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const upload = async (files: File[]) => {
    setBusy(true);
    try {
      const [p] = await uploadPhotos(files.slice(0, 1));
      if (!p) return;
      onChange(p);
      onChange(await waitForPhoto(p.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Photo not processed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">
        {value && (
          <span className="relative size-20 shrink-0 overflow-hidden rounded-[8px] border-2 border-panel-line">
            <PhotoImage photo={value} className="size-full" />
          </span>
        )}
        <UploadButton onFiles={(f) => void upload(f)} size="sm" disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />} Upload
        </UploadButton>
        <Button size="sm" onClick={() => setPicking(true)} disabled={busy}>
          <Images className="size-4" /> From albums
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={busy}>
            Remove
          </Button>
        )}
      </div>
      <AlbumPhotoPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          onChange(p);
          setPicking(false);
        }}
      />
    </div>
  );
}

export function PhotosField({ value, onChange, max = 12 }: { value: Photo[]; onChange: (p: Photo[]) => void; max?: number }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const upload = async (files: File[]) => {
    setBusy(true);
    try {
      const added = await uploadPhotos(files.slice(0, Math.max(0, max - value.length)));
      onChange([...latest.current, ...added]);
      const ready = await Promise.all(added.map((p) => waitForPhoto(p.id).catch(() => p)));
      onChange(latest.current.map((p) => ready.find((r) => r.id === p.id) ?? p));
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold text-muted">Photos</span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((p, i) => (
            <li key={p.id} className="grid w-24 gap-1">
              <span className="relative block aspect-square overflow-hidden rounded-[8px] border-2 border-panel-line">
                <PhotoImage photo={p} className="size-full" />
              </span>
              <span className="flex justify-between">
                <IconButton label="Move earlier" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ArrowUp className="-rotate-90" />
                </IconButton>
                <IconButton label="Remove photo" size="sm" onClick={() => onChange(value.filter((x) => x.id !== p.id))}>
                  <Trash2 />
                </IconButton>
                <IconButton label="Move later" size="sm" onClick={() => move(i, 1)} disabled={i === value.length - 1}>
                  <ArrowDown className="-rotate-90" />
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <UploadButton onFiles={(f) => void upload(f)} multiple size="sm" disabled={busy || value.length >= max}>
          {busy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />} Upload
        </UploadButton>
        <Button size="sm" onClick={() => setPicking(true)} disabled={busy || value.length >= max}>
          <Images className="size-4" /> From albums
        </Button>
      </div>
      <AlbumPhotoPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          if (!value.some((x) => x.id === p.id)) onChange([...value, p]);
          setPicking(false);
        }}
      />
    </div>
  );
}

export function DayField({ label, value, onChange, required }: { label: string; value: string | null; onChange: (v: string | null) => void; required?: boolean }) {
  return (
    <Field label={label}>
      <input type="date" className={inputClass} value={value ?? ""} required={required} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}

export const panelClass = "rounded-[12px] border-2 border-b-[5px] border-panel-line bg-panel";

export const paperTokens = {
  "--text": "#3b2f3f",
  "--text-muted": "#7a6a7e",
  "--accent": "#e88fa3",
  "--accent-strong": "#a8445e",
  "--accent-soft": "#f7c6d0",
  "--on-accent": "#ffffff",
  "--panel": "#ffffff",
  "--panel-line": "rgba(59, 47, 63, 0.1)",
  "--surface-solid": "#ffffff",
  "--line": "rgba(59, 47, 63, 0.12)",
  color: "#3b2f3f",
} as CSSProperties;
