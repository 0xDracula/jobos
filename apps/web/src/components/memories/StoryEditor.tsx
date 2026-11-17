"use client";

import { useEffect, useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { Button, Field, inputClass } from "@/components/ui";
import { memoriesApi, memoryKeys, type Chapter, type ChapterInput, type Photo } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { DayField, PhotosField, SongField } from "./parts";

export function ChapterEditor({
  chapter,
  onClose,
  onSaved,
  onDeleted,
}: {
  chapter: Chapter | "new" | null;
  onClose: () => void;
  onSaved: (id: string | null) => void;
  onDeleted: (id: string) => void;
}) {
  const me = useMe().data;
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [track, setTrack] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const existing = chapter && chapter !== "new" ? chapter : null;
  const canDelete = !!existing && !!me && (me.id === existing.created_by || me.role === "admin");

  useEffect(() => {
    if (!chapter) return;
    const c = chapter === "new" ? null : chapter;
    setTitle(c?.title ?? "");
    setFrom(c?.date_from ?? null);
    setTo(c?.date_to ?? null);
    setBody(c?.body ?? "");
    setPhotos(c?.photos ?? []);
    setTrack(c?.track ?? null);
  }, [chapter]);

  const save = async () => {
    setBusy(true);
    try {
      const input: ChapterInput = {
        title: title.trim(),
        date_from: from,
        date_to: to,
        body,
        track_id: track?.id ?? null,
        photo_ids: photos.map((p) => p.id),
      };
      const before = new Set((queryClient.getQueryData<Chapter[]>(memoryKeys.chapters) ?? []).map((c) => c.id));
      const r = existing ? await memoriesApi.updateChapter(existing.id, input) : await memoriesApi.createChapter(input);
      queryClient.setQueryData(memoryKeys.chapters, r.chapters);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
      toast(existing ? "Chapter saved" : "Chapter added");
      onSaved(existing ? existing.id : (r.chapters.find((c) => !before.has(c.id))?.id ?? null));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await memoriesApi.deleteChapter(existing.id);
      queryClient.setQueryData<Chapter[]>(memoryKeys.chapters, (list) => list?.filter((c) => c.id !== existing.id));
      void queryClient.invalidateQueries({ queryKey: memoryKeys.chapters });
      void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
      toast("Chapter deleted");
      onDeleted(existing.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not deleted");
    }
  };

  return (
    <>
      <Dialog open={!!chapter} onOpenChange={(o) => !o && onClose()} title={existing ? "Chapter" : "New chapter"} wide>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && !busy) void save();
          }}
        >
          <Field label="Title">
            <input dir="auto" required maxLength={80} className={`${inputClass} font-hand text-2xl`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <DayField label="From" value={from} onChange={setFrom} />
            <DayField label="To" value={to} onChange={setTo} />
          </div>
          <Field label="Text">
            <textarea dir="auto" rows={10} maxLength={20000} className={`${inputClass} py-3 leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <PhotosField value={photos} onChange={setPhotos} />
          <SongField value={track} onChange={setTrack} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={busy || !title.trim()}>
              Save
            </Button>
            {canDelete && (
              <Button variant="ghost" className="ms-auto" onClick={() => setDeleting(true)} disabled={busy}>
                Delete
              </Button>
            )}
          </div>
        </form>
      </Dialog>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="Delete chapter?" action="Delete" onConfirm={() => void remove()} />
    </>
  );
}
