"use client";

import { ArrowUpDown, Ellipsis, GripVertical, Pencil, Trash } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type KeyboardEvent } from "react";

import { Failed, FilterInput, filterTracks, Loading, PlayBar, totalDuration } from "@/components/common";
import { ConfirmDialog, EditPlaylistDialog, providerLabel } from "@/components/dialogs";
import { Artwork, Cover } from "@/components/media";
import { TrackList } from "@/components/tracks";
import { Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui";
import { useDeletePlaylist, usePlaylist, useRemoveFromPlaylist, useReorderPlaylist } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Playlist, Track } from "@/lib/types";

export default function PlaylistPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PlaylistView />
    </Suspense>
  );
}

function PlaylistView() {
  const id = useSearchParams().get("id");
  const q = usePlaylist(id);
  if (!id) return <Failed what="Playlist" />;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed what="Playlist" />;
  return <PlaylistBody key={id} playlist={q.data} />;
}

function PlaylistBody({ playlist: p }: { playlist: Playlist }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useRemoveFromPlaylist(p.id);
  const del = useDeletePlaylist();
  const shown = useMemo(() => filterTracks(p.tracks, filter), [p.tracks, filter]);
  const context = { type: "playlist" as const, id: p.id, name: p.name };
  const meta = [`${p.counts.total} songs`, totalDuration(p.tracks), p.source_provider && providerLabel(p.source_provider), p.sync_enabled && "Synced"]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover cover={p.cover_url} collage={p.collage} alt={p.name} className="size-44 shrink-0 rounded-card shadow-soft lg:size-56" />
        <div className="min-w-0">
          <div className="text-xs font-extrabold text-muted">Playlist</div>
          <h1 dir="auto" className="font-display text-[30px] font-semibold leading-tight lg:text-[40px]">
            {p.name}
          </h1>
          {p.description && (
            <p dir="auto" className="mt-1 line-clamp-3 font-semibold text-muted">
              {p.description}
            </p>
          )}
          <p className="mt-1 text-sm font-bold text-muted">{meta}</p>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <PlayBar tracks={p.tracks} context={context} />
        <Menu modal={false}>
          <MenuTrigger aria-label="Playlist options" className="grid size-11 place-items-center rounded-full hover:bg-accent-soft/50">
            <Ellipsis className="size-6" />
          </MenuTrigger>
          <MenuContent align="start">
            <MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
              Details
            </MenuItem>
            <MenuItem icon={<ArrowUpDown />} disabled={p.tracks.length < 2} onSelect={() => setOrdering(true)}>
              Reorder
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash />} className="text-danger [&_svg]:text-danger" onSelect={() => setDeleting(true)}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
        {!ordering && (
          <div className="ms-auto">
            <FilterInput value={filter} onChange={setFilter} />
          </div>
        )}
      </div>

      {ordering ? (
        <ReorderList tracks={p.tracks} playlistId={p.id} onDone={() => setOrdering(false)} />
      ) : shown.length ? (
        <TrackList tracks={shown} context={context} showAlbum onRemove={(t) => remove.mutate(t.id)} />
      ) : (
        <p className="py-8 text-center font-semibold text-muted">{p.tracks.length ? "No matches" : "No songs"}</p>
      )}

      <EditPlaylistDialog key={`${p.name}|${p.description}|${p.sync_enabled}`} playlist={p} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${p.name}?`}
        action="Delete"
        onConfirm={() =>
          del.mutate(p.id, {
            onSuccess: () => {
              toast(`Deleted ${p.name}`);
              router.push("/library/");
            },
          })
        }
      />
    </>
  );
}

function ReorderList({ tracks, playlistId, onDone }: { tracks: Track[]; playlistId: string; onDone: () => void }) {
  const [order, setOrder] = useState(tracks);
  const reorder = useReorderPlaylist(playlistId);
  const move = (t: Track, by: number) => {
    const i = order.indexOf(t);
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            reorder.mutate(order);
            onDone();
          }}
        >
          Save order
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="grid grid-cols-1 gap-0.5">
        {order.map((t) => (
          <ReorderRow key={t.id} track={t} onMove={(by) => move(t, by)} />
        ))}
      </Reorder.Group>
    </div>
  );
}

function ReorderRow({ track, onMove }: { track: Track; onMove: (by: number) => void }) {
  const controls = useDragControls();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow)", zIndex: 1 }}
      className="relative flex items-center gap-3 rounded-button p-1.5 [background:var(--bg)]"
    >
      <button
        type="button"
        aria-label={`Move ${track.title}`}
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={onKey}
        className="grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-full text-muted hover:bg-accent-soft/60"
      >
        <GripVertical className="size-5" />
      </button>
      <Artwork src={track.artwork_thumb_url} className="size-10 shrink-0 rounded-chip" />
      <span className="min-w-0">
        <span dir="auto" className="block truncate font-bold">
          {track.title}
        </span>
        <span dir="auto" className="block truncate text-sm font-semibold text-muted">
          {track.artists.join(", ")}
        </span>
      </span>
    </Reorder.Item>
  );
}
