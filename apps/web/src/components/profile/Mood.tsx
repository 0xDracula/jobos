"use client";

import { Music2 } from "lucide-react";
import { useState } from "react";

import { Dialog } from "@/components/dialogs";
import { SongPicker } from "@/components/letters/SongPicker";
import { Button, Field, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { MOODS, moodOf, profileKeys, profilesApi, type Mood, type MoodKey } from "@/lib/profiles";
import { queryClient } from "@/lib/queries";
import { shareSong } from "@/lib/social";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

export function MoodChip({ mood, note, className }: { mood: Mood | null | undefined; note?: boolean; className?: string }) {
  const m = moodOf(mood?.mood);
  if (!m || !mood) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full text-sm" style={{ background: `${m.color}55` }}>
        {m.emoji}
      </span>
      <span className="min-w-0 truncate">
        {m.label}
        {note && mood.note ? <span className="font-semibold opacity-75"> · {mood.note}</span> : null}
      </span>
    </span>
  );
}

const refresh = () => void queryClient.invalidateQueries({ queryKey: profileKeys.profiles });

export function MoodPicker({ current, onDone }: { current: Mood | null | undefined; onDone?: () => void }) {
  const [picked, setPicked] = useState<MoodKey | null>(current?.mood ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const save = async () => {
    if (!picked) return;
    try {
      await profilesApi.setMood(picked, note.trim());
      refresh();
      onDone?.();
    } catch {
      toast("Mood not saved");
    }
  };
  const clear = async () => {
    try {
      await profilesApi.clearMood();
      refresh();
      setPicked(null);
      setNote("");
      onDone?.();
    } catch {
      toast("Mood not cleared");
    }
  };
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-4 gap-2">
        {MOODS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={picked === m.key}
            onClick={() => setPicked(m.key)}
            className={cn(
              "grid justify-items-center gap-1 rounded-[14px] border-2 px-1 py-2 text-xs font-bold transition-colors",
              picked === m.key ? "border-accent-strong bg-accent-soft/70" : "border-transparent bg-surface hover:bg-accent-soft/40",
            )}
          >
            <span aria-hidden className="grid size-9 place-items-center rounded-full text-xl" style={{ background: `${m.color}55` }}>
              {m.emoji}
            </span>
            {m.label}
          </button>
        ))}
      </div>
      <Field label="Note">
        <input dir="auto" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void save()} disabled={!picked}>
          Set mood
        </Button>
        {current && (
          <Button variant="ghost" onClick={() => void clear()}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

export function MoodReply({ mood, name }: { mood: Mood; name: string }) {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);
  const [note, setNote] = useState("");
  const send = () => {
    if (!track) return;
    shareSong(track, { note: note.trim() || undefined, mood: mood.mood });
    toast("Song sent to chat");
    setOpen(false);
    setTrack(null);
    setNote("");
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Music2 className="size-4" /> Reply with a song
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={`A song for ${name}`}>
        <div className="grid gap-3">
          <SongPicker value={track} onChange={setTrack} />
          <Field label="Note">
            <input dir="auto" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </Field>
          <Button variant="primary" onClick={send} disabled={!track}>
            Send
          </Button>
        </div>
      </Dialog>
    </>
  );
}
