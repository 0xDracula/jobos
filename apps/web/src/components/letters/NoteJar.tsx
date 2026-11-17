"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Loading } from "@/components/common";
import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, SectionTitle, Segmented } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import {
  lettersApi,
  lettersKeys,
  refreshLetters,
  useHomeZone,
  useJar,
  useRefetchAt,
  useWindowNote,
  useWrittenNotes,
  type Note,
  type NoteInput,
  type NoteKind,
} from "@/lib/letters";
import { formatDay } from "@/lib/paper";
import { useMe } from "@/lib/session";
import { uiSound } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { Handwriting, useHandFont } from "./Handwriting";
import { JarArt } from "./Jar";
import { useNames } from "./Letters";
import { NotePaper, PAPER_FIELD } from "./Paper";
import { SongPicker, SongRow } from "./SongPicker";

const panel = "rounded-[10px] border-2 border-b-[5px] border-panel-line bg-panel";

const KIND_LABEL: Record<NoteKind, string> = { daily: "Daily note", morning: "Morning note", night: "Night note" };

const firstLine = (body: string) => body.split("\n").find((l) => l.trim()) ?? "";

function NoteOverlay({ note, unfold, onClose }: { note: Note | null; unfold: boolean; onClose: () => void }) {
  const names = useNames();
  return (
    <RadixDialog.Root open={!!note} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[80] bg-[#1e1b3a]/45 backdrop-blur-[3px] data-[state=open]:animate-[fade-in_160ms_ease-out]" />
        <RadixDialog.Content aria-describedby={undefined} className="fixed inset-0 z-[81] grid place-items-center overflow-y-auto p-4 outline-none" onClick={(e) => e.target === e.currentTarget && onClose()}>
          <RadixDialog.Title className="sr-only">{note ? KIND_LABEL[note.kind] : "Note"}</RadixDialog.Title>
          {note && (
            <div className="grid w-full max-w-md grid-cols-1 gap-4">
              <NotePaper
                note={note}
                authorName={names(note.author_id)}
                unfold={unfold}
                label={note.available_on ? formatDay(note.available_on) : KIND_LABEL[note.kind]}
              />
              {note.track && (
                <div className={panel}>
                  <SongRow track={note.track}>
                    <IconButton label={`Play ${note.track.title}`} onClick={() => playTracks([note.track as Track], 0, { type: "queue", name: KIND_LABEL[note.kind] })}>
                      <Play />
                    </IconButton>
                  </SongRow>
                </div>
              )}
              <RadixDialog.Close asChild>
                <Button variant="soft" className="mx-auto bg-surface-solid">
                  <X className="size-5" /> Close
                </Button>
              </RadixDialog.Close>
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function WindowNoteCard({ className }: { className?: string }) {
  const q = useWindowNote();
  const names = useNames();
  useRefetchAt(q.data?.ends_at ?? q.data?.next_at, lettersKeys.windowNote);
  const n = q.data?.note;
  if (!n || !q.data?.window) return null;
  return (
    <div className={className}>
      <NotePaper note={n} authorName={names(n.author_id)} label={q.data.window === "morning" ? "Morning note" : "Night note"} className="max-w-sm" />
    </div>
  );
}

function TheJar() {
  const jar = useJar();
  const tz = useHomeZone();
  const [reading, setReading] = useState<{ note: Note; unfold: boolean } | null>(null);
  const [opening, setOpening] = useState(false);
  useRefetchAt(jar.data?.next_at, lettersKeys.jar);
  const j = jar.data;
  if (jar.isLoading) return <Loading />;
  if (!j) return null;
  const open = async () => {
    if (j.today) return setReading({ note: j.today, unfold: true });
    if (!j.waiting) return;
    setOpening(true);
    uiSound("paper");
    try {
      const n = await lettersApi.openJar();
      setReading({ note: n, unfold: true });
      refreshLetters("jar");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not opened");
      refreshLetters("jar");
    } finally {
      setOpening(false);
    }
  };
  const next = new Date(j.next_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const past = j.opened;
  return (
    <div className="grid grid-cols-1 gap-10">
      <section className="grid justify-items-center gap-3 text-center">
        <button
          type="button"
          onClick={() => void open()}
          disabled={opening || (!j.waiting && !j.today)}
          aria-label={j.today ? "Today's note" : j.waiting ? "Open note" : "Empty jar"}
          className="group rounded-card p-2 transition-transform duration-200 enabled:hover:-translate-y-1 disabled:cursor-default"
        >
          <JarArt left={j.left} waiting={j.waiting} className="h-60 w-48 sm:h-72 sm:w-56" />
        </button>
        <div>
          <p className="font-display text-xl font-semibold">{j.waiting ? "New note" : j.today ? "Opened today" : "Empty"}</p>
          <p className="text-sm font-bold text-muted">
            {plural(j.left, "note")} left{!j.waiting ? ` · Next ${next}` : ""}
          </p>
        </div>
        {(j.waiting || j.today) && (
          <Button variant="primary" onClick={() => void open()} disabled={opening}>
            {j.today ? "Today's note" : "Open note"}
          </Button>
        )}
      </section>
      <section>
        <SectionTitle>Opened</SectionTitle>
        {past.length ? (
          <ul className={cn(panel, "divide-y divide-panel-line")}>
            {past.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => setReading({ note: n, unfold: false })} className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-accent-soft/40">
                  <span className="w-24 shrink-0 text-sm font-bold text-muted">{n.available_on ? formatDay(n.available_on, { day: "numeric", month: "short" }) : ""}</span>
                  <Handwriting authorId={n.author_id} as="span" className="min-w-0 flex-1 truncate pe-1.5 text-[21px] leading-tight">
                    {firstLine(n.body)}
                  </Handwriting>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>None yet</Empty>
        )}
      </section>
      <NoteOverlay note={reading?.note ?? null} unfold={!!reading?.unfold} onClose={() => setReading(null)} />
    </div>
  );
}

const emptyNote: NoteInput = { kind: "daily", body: "", track_id: null };

function NoteForm({ initial, track: initialTrack, onSave, action }: { initial: NoteInput; track: Track | null; onSave: (n: NoteInput) => Promise<void>; action: string }) {
  const me = useMe().data;
  const hand = useHandFont(me?.id);
  const [form, setForm] = useState<NoteInput>(initial);
  const [track, setTrack] = useState<Track | null>(initialTrack);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...form, track_id: track?.id ?? null });
      setForm({ ...initial, body: "" });
      setTrack(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-3">
      <Segmented<NoteKind>
        label="Kind"
        value={form.kind}
        onChange={(kind) => setForm({ ...form, kind })}
        options={[
          ["daily", "Daily"],
          ["morning", "Morning"],
          ["night", "Night"],
        ]}
      />
      <Field label="Note">
        <textarea
          dir="auto"
          rows={5}
          maxLength={2000}
          className={PAPER_FIELD}
          style={{ fontFamily: hand, fontSize: 22, lineHeight: 1.35 }}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
      </Field>
      <Field label="Song">
        <SongPicker value={track} onChange={setTrack} />
      </Field>
      <Button variant="primary" onClick={() => void save()} disabled={busy || !form.body.trim()}>
        {action}
      </Button>
    </div>
  );
}

function WrittenNotes() {
  const q = useWrittenNotes();
  const [editing, setEditing] = useState<Note | null>(null);
  const [removing, setRemoving] = useState<Note | null>(null);
  const [writing, setWriting] = useState(false);
  const notes = q.data ?? [];
  const inJar = notes.filter((n) => n.kind === "daily" && !n.available_on);
  const opened = notes.filter((n) => n.kind === "daily" && n.available_on).sort((a, b) => (b.available_on ?? "").localeCompare(a.available_on ?? ""));
  const sections: [string, Note[]][] = [
    ["In the jar", inJar],
    ["Opened", opened],
    ["Morning", notes.filter((n) => n.kind === "morning")],
    ["Night", notes.filter((n) => n.kind === "night")],
  ];
  const add = async (n: NoteInput) => {
    try {
      await lettersApi.addNote(n);
      refreshLetters("notes", "jar");
      toast("Note added");
      setWriting(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    }
  };
  if (q.isLoading) return <Loading />;
  return (
    <div className="grid grid-cols-1 gap-8">
      <div>
        <Button variant="primary" onClick={() => setWriting(true)}>
          <Plus className="size-5" /> New note
        </Button>
      </div>
      {sections.map(([title, list]) => (
        <section key={title}>
          <SectionTitle action={<span className="tabular text-sm font-bold text-muted">{list.length}</span>}>{title}</SectionTitle>
          {list.length ? (
            <ul className={cn(panel, "divide-y divide-panel-line")}>
              {list.map((n) => (
                <li key={n.id} className="flex min-h-14 items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <Handwriting authorId={n.author_id} className="truncate pe-1.5 text-[21px] leading-tight">
                      {firstLine(n.body)}
                    </Handwriting>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-muted">
                      {n.available_on ? formatDay(n.available_on) : null}
                      {n.track && (
                        <span dir="auto" className="truncate">
                          {n.available_on ? "· " : ""}
                          {n.track.title}
                        </span>
                      )}
                      {n.placeholder && <PlaceholderMark />}
                    </p>
                  </div>
                  <IconButton label="Edit" size="sm" onClick={() => setEditing(n)}>
                    <Pencil />
                  </IconButton>
                  <IconButton label="Delete" size="sm" onClick={() => setRemoving(n)}>
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>None</Empty>
          )}
        </section>
      ))}
      <Dialog open={writing} onOpenChange={setWriting} title="New note">
        <NoteForm initial={emptyNote} track={null} onSave={add} action="Add note" />
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing ? KIND_LABEL[editing.kind] : "Note"}>
        {editing && (
          <NoteForm
            key={editing.id}
            initial={{ kind: editing.kind, body: editing.body, track_id: editing.track_id }}
            track={editing.track ?? null}
            action="Save note"
            onSave={async (n) => {
              try {
                await lettersApi.editNote(editing.id, n);
                refreshLetters("notes", "jar");
                setEditing(null);
              } catch (e) {
                toast(e instanceof Error ? e.message : "Not saved");
              }
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this note?"
        action="Delete"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await lettersApi.removeNote(removing.id);
            refreshLetters("notes", "jar");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </div>
  );
}

export function NoteJarPage() {
  const jar = useJar();
  const [tab, setTab] = useState<"jar" | "written">("jar");
  const meta = jar.data ? plural(jar.data.left, "note") + " left" : undefined;
  return (
    <>
      <PageHero title="Note jar" meta={meta}>
        <Segmented
          label="Notes"
          value={tab}
          onChange={setTab}
          options={[
            ["jar", "Jar"],
            ["written", "Written"],
          ]}
        />
      </PageHero>
      {tab === "jar" ? (
        <div className="grid grid-cols-1 gap-10">
          <WindowNoteCard />
          <TheJar />
        </div>
      ) : (
        <WrittenNotes />
      )}
    </>
  );
}
