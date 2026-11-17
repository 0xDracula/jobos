"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Dialog } from "@/components/dialogs";
import { Button, Field, Segmented, inputClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { sessionApi, type ListeningSession } from "@/lib/sessions";
import { toast } from "@/lib/toast";
import { usePlayer } from "@/player/store";

type When = "now" | "later";
type Songs = "empty" | "queue";

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return localInput(d);
}

export function SessionForm({
  open, onOpenChange, session, trackIds, defaultTitle = "",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session?: ListeningSession;
  trackIds?: string[];
  defaultTitle?: string;
}) {
  const router = useRouter();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<When>("now");
  const [at, setAt] = useState(inAnHour);
  const [songs, setSongs] = useState<Songs>("empty");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(session?.title ?? defaultTitle);
    setWhen(session?.scheduled_at ? "later" : "now");
    setAt(session?.scheduled_at ? localInput(new Date(session.scheduled_at)) : inAnHour());
    setSongs("empty");
  }, [open, session, defaultTitle]);
  const save = async () => {
    setBusy(true);
    try {
      const scheduled_at = when === "later" ? new Date(at).toISOString() : null;
      if (session) {
        await sessionApi.update(session.id, { title, scheduled_at });
        onOpenChange(false);
        return;
      }
      const ids = trackIds ?? (songs === "queue" ? queue.slice(Math.max(0, index)).map((q) => q.track.id) : []);
      const { id } = await sessionApi.create({ title, scheduled_at, track_ids: ids.slice(0, 500) });
      onOpenChange(false);
      router.push(`/together/?id=${id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={session ? "Session" : "New session"}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Title">
          <input dir="auto" className={inputClass} value={title} maxLength={80} placeholder="Listening together" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Time">
          <Segmented<When> label="Time" value={when} onChange={setWhen} options={[["now", "Now"], ["later", "Date and time"]]} />
        </Field>
        {when === "later" && <input type="datetime-local" aria-label="Date and time" className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} required />}
        {!session && !trackIds && queue.length > 0 && (
          <Field label="Setlist">
            <Segmented<Songs> label="Setlist" value={songs} onChange={setSongs} options={[["empty", "Empty"], ["queue", "My queue"]]} />
          </Field>
        )}
        {!session && trackIds && <p className="text-sm font-bold text-muted">{trackIds.length} songs</p>}
        <Button type="submit" variant="primary" disabled={busy || (when === "later" && !at)}>
          {session ? "Save" : "Create"}
        </Button>
      </form>
    </Dialog>
  );
}
