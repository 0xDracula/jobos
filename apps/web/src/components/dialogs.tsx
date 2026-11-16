"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { create } from "zustand";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import {
  keys,
  useAddToPlaylist,
  useCreatePlaylist,
  useEditPlaylist,
  usePlaylists,
  useSetPlaylistCover,
} from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { PlaylistSummary, Track } from "@/lib/types";

import { Cover } from "./media";
import { Button, Field, IconButton, inputClass, Spinner, Switch } from "./ui";

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[80] bg-[#1e1b3a]/30 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_160ms_ease-out]" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-[81] flex max-h-[88dvh] flex-col overflow-hidden shadow-soft outline-none [background:var(--surface-solid)]",
            "inset-x-0 bottom-0 rounded-t-sheet pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[sheet-in_200ms_ease-out]",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sheet sm:pb-0",
            wide ? "sm:max-w-2xl" : "sm:max-w-md",
          )}
        >
          <div className="flex items-center gap-2 px-5 pb-2 pt-4">
            <RadixDialog.Title className="min-w-0 flex-1 truncate font-display text-xl font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X />
              </IconButton>
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const useDialogs = create<{ addTo: Track[] | null; versions: Track | null }>(() => ({ addTo: null, versions: null }));

export const openAddToPlaylist = (tracks: Track[]) => useDialogs.setState({ addTo: tracks });
export const openVersions = (track: Track) => useDialogs.setState({ versions: track });

export function GlobalDialogs() {
  const { addTo, versions } = useDialogs();
  return (
    <>
      <AddToPlaylistDialog tracks={addTo} onClose={() => useDialogs.setState({ addTo: null })} />
      <VersionsDialog track={versions} onClose={() => useDialogs.setState({ versions: null })} />
    </>
  );
}

function AddToPlaylistDialog({ tracks, onClose }: { tracks: Track[] | null; onClose: () => void }) {
  const playlists = usePlaylists();
  const add = useAddToPlaylist();
  const create = useCreatePlaylist();
  const [name, setName] = useState("");
  const ids = tracks?.map((t) => t.id) ?? [];
  const choose = (p: PlaylistSummary) => {
    add.mutate({ id: p.id, name: p.name, trackIds: ids });
    onClose();
  };
  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n, trackIds: ids },
      {
        onSuccess: () => {
          toast(`Added to ${n}`);
          setName("");
          onClose();
        },
      },
    );
  };
  return (
    <Dialog open={!!tracks} onOpenChange={(o) => !o && onClose()} title="Add to playlist">
      <form onSubmit={submit} className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist"
          aria-label="New playlist name"
          className={inputClass}
          maxLength={200}
        />
        <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending} className="shrink-0">
          <Plus className="size-5" /> Create
        </Button>
      </form>
      <ul className="grid grid-cols-1 gap-1">
        {playlists.data?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => choose(p)}
              className="flex w-full items-center gap-3 rounded-button p-2 text-start hover:bg-accent-soft/50"
            >
              <Cover cover={p.cover_url} collage={p.collage} className="size-12 shrink-0 rounded-chip" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-bold">
                  {p.name}
                </span>
                <span className="text-sm font-semibold text-muted">{p.counts.total} songs</span>
              </span>
            </button>
          </li>
        ))}
        {playlists.isLoading && <Spinner className="mx-auto my-4 size-6 text-muted" />}
      </ul>
    </Dialog>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  ytmusic: "YT Music",
  spotify: "Spotify",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  upload: "Upload",
  other: "Link",
};

export const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

function VersionsDialog({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const qc = useQueryClient();
  const sources = useQuery({
    queryKey: keys.sources(track?.id ?? ""),
    queryFn: async () => (await api.sources(track!.id)).sources,
    enabled: !!track,
  });
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const choose = async (body: Parameters<typeof api.chooseSource>[1]) => {
    if (!track) return;
    setBusy(true);
    try {
      await api.chooseSource(track.id, body);
      toast("Version changed");
      setLink("");
      void qc.invalidateQueries({ queryKey: keys.sources(track.id) });
      void qc.invalidateQueries({ queryKey: keys.track(track.id) });
      void qc.invalidateQueries({ queryKey: ["playlist"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Change failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!track} onOpenChange={(o) => !o && onClose()} title="Versions" wide>
      {track && (
        <p dir="auto" className="mb-3 truncate font-semibold text-muted">
          {track.title} · {track.artists.join(", ")}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void choose({ url: link.trim() });
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Link to a recording"
          aria-label="Link to a recording"
          inputMode="url"
          className={inputClass}
        />
        <Button type="submit" disabled={!link.trim() || busy} className="shrink-0">
          Use
        </Button>
      </form>
      {sources.isLoading && <Spinner className="mx-auto my-4 size-6 text-muted" />}
      <ul className="grid grid-cols-1 gap-1">
        {sources.data?.map((v) => (
          <li key={v.id} className="flex items-center gap-3 rounded-button p-2 hover:bg-accent-soft/30">
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate font-bold">
                {v.title ?? v.external_id}
              </span>
              <span className="block truncate text-sm font-semibold text-muted" dir="auto">
                {[providerLabel(v.provider), v.uploader, v.duration_ms ? fmtMs(v.duration_ms) : null, v.score != null ? `score ${v.score.toFixed(2)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {v.status === "selected" ? (
              <span className="inline-flex items-center gap-1 text-sm font-bold text-accent-strong">
                <Check className="size-4" /> In use
              </span>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void choose({
                    provider: v.provider,
                    external_id: v.external_id,
                    title: v.title ?? v.external_id,
                    artists: v.uploader ? [{ name: v.uploader }] : [],
                    duration_ms: v.duration_ms,
                  })
                }
              >
                Use
              </Button>
            )}
          </li>
        ))}
        {sources.data?.length === 0 && <li className="py-4 text-center font-semibold text-muted">No versions</li>}
      </ul>
    </Dialog>
  );
}

export function EditPlaylistDialog({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: PlaylistSummary;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const edit = useEditPlaylist(playlist.id);
  const cover = useSetPlaylistCover(playlist.id);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [sync, setSync] = useState(playlist.sync_enabled);
  const save = (e: { preventDefault(): void }) => {
    e.preventDefault();
    edit.mutate(
      { name: name.trim(), description: description.trim(), ...(playlist.source_url ? { sync_enabled: sync } : {}) },
      { onSuccess: () => onOpenChange(false) },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Playlist details">
      <form onSubmit={save} className="grid grid-cols-1 gap-4">
        <div className="flex items-center gap-4">
          <Cover cover={playlist.cover_url} collage={playlist.collage} className="size-24 shrink-0 rounded-card" />
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button bg-accent-soft/70 px-4 font-semibold hover:bg-accent-soft">
            {cover.isPending ? <Spinner className="size-5" /> : <ImageUp className="size-5" />}
            Cover image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) cover.mutate(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={200} required dir="auto" />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={cn(inputClass, "min-h-24 py-3")}
            maxLength={2000}
            dir="auto"
          />
        </Field>
        {playlist.source_url && (
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Sync with source</span>
            <Switch label="Sync with source" checked={sync} onCheckedChange={setSync} />
          </div>
        )}
        <Button type="submit" variant="primary" disabled={!name.trim() || edit.isPending}>
          Save
        </Button>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  action,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {action}
        </Button>
      </div>
    </Dialog>
  );
}

export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  initial,
  action,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial: string;
  action: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit(name.trim());
          onOpenChange(false);
        }}
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={200} autoFocus dir="auto" />
        </Field>
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          {action}
        </Button>
      </form>
    </Dialog>
  );
}
