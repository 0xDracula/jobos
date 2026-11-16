"use client";

import { NotebookPen, Plus } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { useTrackNotes } from "@/lib/keepsakes";
import { useMembers } from "@/lib/session";
import type { Track } from "@/lib/types";

import { openSongNote } from "../KeepsakeDialogs";

export function SongNotes({ track }: { track: Track }) {
  const notes = useTrackNotes(track.id);
  const members = useMembers();
  const [open, setOpen] = useState(false);
  const songNotes = (notes.data ?? []).filter((n) => n.line_index == null).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!songNotes.length) return null;
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const shown = open ? songNotes : songNotes.slice(0, 1);
  return (
    <div className="rounded-[18px] bg-surface-solid/55 px-3 py-2 shadow-soft">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-2 text-start">
        <NotebookPen aria-hidden className="mt-1 size-4 shrink-0 text-accent-strong" />
        <span className="grid min-w-0 flex-1 gap-1.5">
          {shown.map((n) => (
            <span key={n.id} className="block">
              <span dir="auto" className={cn("block font-hand text-lg leading-snug", !open && "line-clamp-1")}>
                {n.body}
              </span>
              {open && <span className="block text-xs font-bold text-muted">{name(n.author_id)}</span>}
            </span>
          ))}
        </span>
        {!open && songNotes.length > 1 && <span className="tabular text-xs font-bold text-muted">+{songNotes.length - 1}</span>}
      </button>
      {open && (
        <button
          type="button"
          onClick={() => openSongNote(track)}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-sm font-bold text-accent-strong hover:bg-accent-soft/60"
        >
          <Plus className="size-4" /> Note
        </button>
      )}
    </div>
  );
}
