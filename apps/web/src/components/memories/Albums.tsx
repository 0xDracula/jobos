"use client";

import { ChevronLeft, ChevronRight, ImagePlus, Pencil, Play, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { Plank } from "@/components/Shelf";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/days";
import { memoriesApi, memoryKeys, refreshPhotos, usePhotoAlbum, usePhotoAlbums, useMemoriesLive, type PhotoAlbum, type PhotoAlbumView } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { PhotoImage, SongChip, SongField, UploadButton, uploadPhotos } from "./parts";
import { Slideshow } from "./Slideshow";

const plural = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

function AlbumBook({ a }: { a: PhotoAlbum }) {
  return (
    <Link href={`/albums/?id=${a.id}`} className="group grid w-[150px] shrink-0 snap-start gap-1.5 sm:w-[176px]">
      <span className="relative block aspect-[5/6] rounded-[6px] bg-[#c9b8f0] p-2.5 ps-4 shadow-[0_8px_18px_rgba(10,8,30,0.35)] transition-transform duration-200 ease-out group-hover:-translate-y-1">
        <span aria-hidden className="absolute inset-y-0 start-0 w-2.5 rounded-s-[6px] bg-[#9a6fb8]" />
        <span className="block h-full overflow-hidden rounded-[3px] border-[3px] border-[#fff8ec] bg-[#fff8ec]">
          <PhotoImage photo={a.cover} className="size-full" />
        </span>
      </span>
      <span dir="auto" className="truncate text-sm font-extrabold">
        {a.name}
      </span>
      <span className="-mt-1.5 flex items-center gap-2 truncate text-[13px] font-semibold text-muted">
        {plural(a.photo_count)}
        {a.placeholder && <PlaceholderMark className="px-1.5 text-[9px]" />}
      </span>
    </Link>
  );
}

function AlbumEditor({ album, open, onClose }: { album: PhotoAlbumView | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const me = useMe().data;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(album?.name ?? "");
    setDescription(album?.description ?? "");
    setTrack(album?.track ?? null);
  }, [open, album]);
  const save = async () => {
    setBusy(true);
    try {
      const input = { name, description, track_id: track?.id ?? null, cover_photo_id: album?.cover_photo_id ?? null };
      const saved = album ? await memoriesApi.updateAlbum(album.id, input) : await memoriesApi.createAlbum(input);
      queryClient.setQueryData(memoryKeys.album(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.albums });
      onClose();
      if (!album) router.push(`/albums/?id=${saved.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  const canDelete = album && me && (me.id === album.created_by || me.role === "admin");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={album ? "Album" : "New album"} wide>
      <div className="grid gap-4">
        <Field label="Name">
          <input dir="auto" className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea dir="auto" rows={3} className={`${inputClass} py-3`} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <SongField label="Soundtrack" value={track} onChange={setTrack} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy && <Spinner className="size-4" />} Save album
          </Button>
          {canDelete && (
            <Button variant="ghost" onClick={() => setRemoving(true)}>
              Delete album
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete this album and its photos?"
        action="Delete"
        onConfirm={async () => {
          if (!album) return;
          try {
            await memoriesApi.deleteAlbum(album.id);
            onClose();
            void queryClient.invalidateQueries({ queryKey: memoryKeys.albums });
            router.replace("/albums/");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </Dialog>
  );
}

export function AlbumList() {
  useMemoriesLive();
  const q = usePhotoAlbums();
  const [creating, setCreating] = useState(false);
  const list = q.data ?? [];
  return (
    <>
      <PageHero title="Photo albums" meta={q.data ? `${list.length} ${list.length === 1 ? "album" : "albums"}` : undefined}>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-5" /> New album
        </Button>
      </PageHero>
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      {q.data && !list.length && <Empty>No albums</Empty>}
      {list.length > 0 && (
        <Plank>
          {list.map((a) => (
            <AlbumBook key={a.id} a={a} />
          ))}
        </Plank>
      )}
      <AlbumEditor album={null} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function PhotoViewer({ album, index, onIndex, onClose }: { album: PhotoAlbumView; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const me = useMe().data;
  const photo = index != null ? album.photos[index] : null;
  const [caption, setCaption] = useState("");
  const [removing, setRemoving] = useState(false);
  useEffect(() => setCaption(photo?.caption ?? ""), [photo]);
  if (!photo || index == null) return null;
  const n = album.photos.length;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: memoryKeys.album(album.id) });
    void queryClient.invalidateQueries({ queryKey: memoryKeys.albums });
  };
  const saveCaption = async () => {
    try {
      await memoriesApi.updatePhoto(photo.id, { caption, taken_on: photo.taken_on });
      refresh();
      toast("Caption saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    }
  };
  const setCover = async () => {
    try {
      await memoriesApi.updateAlbum(album.id, { name: album.name, description: album.description, track_id: album.track_id, cover_photo_id: photo.id });
      refresh();
      toast("Cover set");
    } catch {
      toast("Not saved");
    }
  };
  const canDelete = me && (me.id === photo.uploaded_by || me.role === "admin");
  const isCover = (album.cover_photo_id ?? album.cover?.id) === photo.id;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${index + 1} / ${n}`} wide>
      <div className="grid gap-3">
        <div className="relative overflow-hidden rounded-[10px] bg-[#1e1b3a]">
          <PhotoImage photo={photo} size="display" fit="contain" eager className="max-h-[58dvh] w-full" />
          <span className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35">
            <IconButton label="Previous photo" onClick={() => onIndex((index - 1 + n) % n)} className="text-white hover:bg-white/15">
              <ChevronLeft />
            </IconButton>
          </span>
          <span className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/35">
            <IconButton label="Next photo" onClick={() => onIndex((index + 1) % n)} className="text-white hover:bg-white/15">
              <ChevronRight />
            </IconButton>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-muted">
          {photo.taken_on && <span>{fmtDay(photo.taken_on)}</span>}
          {photo.placeholder && <PlaceholderMark />}
          {isCover && <span className="text-accent-strong">Cover</span>}
        </div>
        <div className="flex gap-2">
          <input dir="auto" aria-label="Caption" placeholder="Caption" className={`${inputClass} font-hand text-xl`} value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} />
          <Button onClick={() => void saveCaption()} disabled={caption === photo.caption}>
            Save
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCover && (
            <Button size="sm" onClick={() => void setCover()}>
              <Star className="size-4" /> Set as cover
            </Button>
          )}
          {photo.original_url && (
            <a href={photo.original_url} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-button px-3 text-sm font-semibold hover:bg-accent-soft/50">
              Original
            </a>
          )}
          {canDelete && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              <Trash2 className="size-4" /> Delete photo
            </Button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete this photo?"
        action="Delete"
        onConfirm={async () => {
          try {
            await memoriesApi.deletePhoto(photo.id);
            onClose();
            refresh();
            refreshPhotos();
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </Dialog>
  );
}

export function AlbumView({ id, autoplay }: { id: string; autoplay?: boolean }) {
  useMemoriesLive();
  const q = usePhotoAlbum(id);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [playing, setPlaying] = useState(!!autoplay);
  const [uploading, setUploading] = useState(0);
  const album = q.data;
  if (q.isLoading) return <Spinner className="size-6 text-muted" />;
  if (!album) return <Empty>Album not found</Empty>;
  const ready = album.photos.filter((p) => p.status === "ready").length;
  const add = async (files: File[]) => {
    setUploading(files.length);
    try {
      await uploadPhotos(files, album.id);
    } finally {
      setUploading(0);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.album(album.id) });
      void queryClient.invalidateQueries({ queryKey: memoryKeys.albums });
    }
  };
  return (
    <>
      <PageHero title={album.name} meta={plural(album.photos.length)}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setPlaying(true)} disabled={!ready}>
            <Play className="size-5 fill-current" /> Slideshow
          </Button>
          <UploadButton multiple onFiles={(f) => void add(f)} disabled={uploading > 0}>
            {uploading ? <Spinner className="size-5" /> : <ImagePlus className="size-5" />} Add photos
          </UploadButton>
          <Button onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
        </div>
      </PageHero>
      <div className="mb-6 grid gap-3">
        <Link href="/albums/" className="inline-flex min-h-11 w-fit items-center gap-1 rounded-button pe-3 text-sm font-bold text-accent-strong hover:bg-accent-soft/40">
          <ChevronLeft className="size-4" /> Photo albums
        </Link>
        {album.placeholder && <PlaceholderMark className="w-fit" />}
        {album.description && (
          <p dir="auto" className="max-w-2xl whitespace-pre-wrap font-semibold text-muted">
            {album.description}
          </p>
        )}
        {album.track && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-extrabold uppercase tracking-wide text-muted">Soundtrack</span>
            <SongChip track={album.track} name={album.name} />
          </div>
        )}
      </div>
      {!album.photos.length && <Empty>No photos</Empty>}
      <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6">
        {album.photos.map((p, i) => (
          <li key={p.id} className="relative">
            <button
              type="button"
              onClick={() => p.status === "ready" && setViewing(i)}
              aria-label={p.caption || `Photo ${i + 1}`}
              className={cn("block aspect-square w-full overflow-hidden rounded-[6px] bg-accent-soft/40 transition-transform hover:-translate-y-0.5", p.status !== "ready" && "cursor-default")}
            >
              <PhotoImage photo={p} className="size-full" />
            </button>
            {p.placeholder && <PlaceholderMark className="pointer-events-none absolute bottom-1 start-1 bg-panel/85 px-1.5 text-[9px]" />}
          </li>
        ))}
      </ul>
      <PhotoViewer album={album} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <AlbumEditor album={album} open={editing} onClose={() => setEditing(false)} />
      {playing && <Slideshow album={album} onClose={() => setPlaying(false)} />}
    </>
  );
}
