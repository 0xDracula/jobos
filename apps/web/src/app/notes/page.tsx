"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Loading } from "@/components/common";
import { PageHero } from "@/components/sky/PageHero";
import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { Handwriting } from "@/components/letters/Handwriting";
import { Artwork } from "@/components/media";
import { Button, Empty, IconButton, inputClass } from "@/components/ui";
import { keepsakeApi, keepsakeKeys, useAllNotes, type SongNote } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import { playFrom } from "@/player/playFrom";

export default function NotesPage() {
  const q = useAllNotes();
  const me = useMe().data;
  const members = useMembers();
  const [editing, setEditing] = useState<SongNote | null>(null);
  const [body, setBody] = useState("");
  const [removing, setRemoving] = useState<SongNote | null>(null);
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const refresh = () => void queryClient.invalidateQueries({ queryKey: keepsakeKeys.notes });
  return (
    <>
      <PageHero title="Song notes" />
      {q.isLoading && <Loading />}
      {q.data && !q.data.length && <Empty>No notes</Empty>}
      <ul className="grid grid-cols-1 gap-3">
        {q.data?.map((n) => (
          <li key={n.id} className="flex gap-3 rounded-card bg-surface-solid/60 p-3 shadow-soft">
            <button type="button" onClick={() => void playFrom(n.track_id, n.line_ms, "Song notes")} className="shrink-0" aria-label={`Play ${n.track?.title ?? "song"}`}>
              <Artwork src={n.track?.artwork_thumb_url ?? null} className="size-14 rounded-chip" />
            </button>
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-bold text-muted">
                {n.track ? `${n.track.title} · ${n.track.artists.join(", ")}` : "—"}
              </p>
              {n.line_text && (
                <p dir="auto" className="mt-1 border-s-2 border-accent ps-2 font-extrabold">
                  {n.line_text}
                </p>
              )}
              <Handwriting authorId={n.author_id} className="mt-1 whitespace-pre-wrap text-xl leading-snug">
                {n.body}
              </Handwriting>
              <p className="mt-1 text-xs font-bold text-muted">
                {name(n.author_id)} · {new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </div>
            {n.author_id === me?.id && (
              <div className="flex shrink-0 flex-col">
                <IconButton
                  label="Edit"
                  size="sm"
                  onClick={() => {
                    setEditing(n);
                    setBody(n.body);
                  }}
                >
                  <Pencil />
                </IconButton>
                <IconButton label="Delete" size="sm" onClick={() => setRemoving(n)}>
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Note">
        <div className="grid gap-3">
          <textarea dir="auto" rows={6} aria-label="Note" className={`${inputClass} py-3 font-hand text-xl`} value={body} onChange={(e) => setBody(e.target.value)} />
          <Button
            variant="primary"
            disabled={!body.trim()}
            onClick={async () => {
              if (!editing) return;
              try {
                await keepsakeApi.updateNote(editing.id, body);
                refresh();
                setEditing(null);
              } catch {
                toast("Note not saved");
              }
            }}
          >
            Save note
          </Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this note?"
        action="Delete"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await keepsakeApi.deleteNote(removing.id);
            refresh();
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </>
  );
}
