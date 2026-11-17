"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Chip, Empty, Field, IconButton, Segmented, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/days";
import { memoriesApi, memoryKeys, useGlossary, useMemoriesLive, type GlossaryEntry, type GlossaryKind, type Photo } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { Byline, DayField, PhotoField, PhotoImage, SongChip, SongField, panelClass } from "./parts";

const KIND_LABELS: Record<GlossaryKind, string> = { joke: "Inside joke", nickname: "Nickname" };

function EntryEditor({ entry, open, onClose }: { entry: GlossaryEntry | null; open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<GlossaryKind>("joke");
  const [term, setTerm] = useState("");
  const [body, setBody] = useState("");
  const [startedOn, setStartedOn] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(entry?.kind ?? "joke");
    setTerm(entry?.term ?? "");
    setBody(entry?.body ?? "");
    setStartedOn(entry?.started_on ?? null);
    setPhoto(entry?.photo ?? null);
    setTrack(entry?.track ?? null);
  }, [open, entry]);
  const save = async () => {
    setBusy(true);
    try {
      const input = { kind, term, body, started_on: startedOn, photo_id: photo?.id ?? null, track_id: track?.id ?? null };
      const r = entry ? await memoriesApi.updateGlossaryEntry(entry.id, input) : await memoriesApi.createGlossaryEntry(input);
      queryClient.setQueryData(memoryKeys.glossary, r.entries);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={entry ? "Entry" : "New entry"} wide>
      <div className="grid gap-4">
        <Segmented<GlossaryKind>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            ["joke", "Inside joke"],
            ["nickname", "Nickname"],
          ]}
        />
        <Field label="Term">
          <input dir="auto" className={`${inputClass} text-lg`} value={term} maxLength={80} onChange={(e) => setTerm(e.target.value)} />
        </Field>
        <Field label="Meaning">
          <textarea dir="auto" rows={4} className={`${inputClass} py-3`} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <DayField label="Start date" value={startedOn} onChange={setStartedOn} />
        <PhotoField value={photo} onChange={setPhoto} />
        <SongField value={track} onChange={setTrack} />
        <Button variant="primary" onClick={() => void save()} disabled={busy || !term.trim() || photo?.status === "processing"}>
          {busy && <Spinner className="size-4" />} Save entry
        </Button>
      </div>
    </Dialog>
  );
}

function Entry({ e, onEdit }: { e: GlossaryEntry; onEdit: () => void }) {
  const me = useMe().data;
  const [removing, setRemoving] = useState(false);
  const [zoom, setZoom] = useState(false);
  const canDelete = me && (me.id === e.created_by || me.role === "admin");
  return (
    <li className={cn(panelClass, "flex gap-3 p-3 sm:p-4")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 dir="auto" className="font-display text-2xl font-semibold leading-tight">
            {e.term}
          </h3>
          <span className="text-xs font-extrabold uppercase tracking-wide text-accent-strong">{KIND_LABELS[e.kind]}</span>
          {(e.placeholder || e.photo?.placeholder) && <PlaceholderMark />}
        </div>
        {e.started_on && <p className="mt-0.5 text-sm font-bold text-muted">Since {fmtDay(e.started_on)}</p>}
        {e.body && (
          <p dir="auto" className="mt-2 whitespace-pre-wrap leading-relaxed">
            {e.body}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SongChip track={e.track} name={e.term} />
          <Byline userId={e.created_by} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        {e.photo && (
          <button type="button" onClick={() => setZoom(true)} aria-label="Photo" className="size-20 overflow-hidden rounded-[8px] border-2 border-panel-line sm:size-24">
            <PhotoImage photo={e.photo} className="size-full" />
          </button>
        )}
        <span className="flex">
          <IconButton label="Edit entry" size="sm" onClick={onEdit}>
            <Pencil />
          </IconButton>
          {canDelete && (
            <IconButton label="Delete entry" size="sm" onClick={() => setRemoving(true)}>
              <Trash2 />
            </IconButton>
          )}
        </span>
      </div>
      <Dialog open={zoom} onOpenChange={setZoom} title={e.term} wide>
        <PhotoImage photo={e.photo} size="display" fit="contain" className="max-h-[70dvh] w-full rounded-[10px]" />
      </Dialog>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete this entry?"
        action="Delete"
        onConfirm={async () => {
          try {
            await memoriesApi.deleteGlossaryEntry(e.id);
            void queryClient.invalidateQueries({ queryKey: memoryKeys.glossary });
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </li>
  );
}

const initial = (term: string) => term.trim().charAt(0).toLocaleUpperCase() || "#";

export function Glossary() {
  useMemoriesLive();
  const q = useGlossary();
  const [filter, setFilter] = useState<GlossaryKind | "all">("all");
  const [editing, setEditing] = useState<GlossaryEntry | "new" | null>(null);
  const all = q.data ?? [];
  const list = all.filter((e) => filter === "all" || e.kind === filter);
  const groups: [string, GlossaryEntry[]][] = [];
  for (const e of list) {
    const k = initial(e.term);
    const last = groups[groups.length - 1];
    if (last && last[0] === k) last[1].push(e);
    else groups.push([k, [e]]);
  }
  return (
    <>
      <PageHero title="Inside jokes and nicknames" meta={q.data ? `${all.length} ${all.length === 1 ? "entry" : "entries"}` : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus className="size-5" /> Add entry
          </Button>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          <Chip selected={filter === "nickname"} onClick={() => setFilter("nickname")}>
            Nicknames
          </Chip>
          <Chip selected={filter === "joke"} onClick={() => setFilter("joke")}>
            Inside jokes
          </Chip>
        </div>
      </PageHero>
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      {q.data && !list.length && <Empty>No entries</Empty>}
      <div className="grid gap-8">
        {groups.map(([letter, entries]) => (
          <section key={letter} aria-label={letter}>
            <h2 dir="auto" className="mb-2 font-display text-3xl font-semibold text-accent-strong">
              {letter}
            </h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {entries.map((e) => (
                <Entry key={e.id} e={e} onEdit={() => setEditing(e)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <EntryEditor entry={editing === "new" ? null : editing} open={!!editing} onClose={() => setEditing(null)} />
    </>
  );
}
