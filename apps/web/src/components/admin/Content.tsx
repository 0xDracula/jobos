"use client";

import { useQuery } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi, adminKeys, type AdminNote, type NoteInput } from "@/lib/admin";
import { api } from "@/lib/api";
import type { Holiday } from "@/lib/gift";
import { ourSongKey, setOurSong, useOurSong } from "@/lib/keepsakes";
import { queryClient, usePlaylists } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { ConfirmDialog, Dialog } from "../dialogs";
import { Button, Chip, Empty, Field, IconButton, inputClass } from "../ui";

import { ChatAdmin } from "./ChatAdmin";
import { ContentOverview } from "./ContentOverview";
import { QuestionsAdmin } from "./Questions";
import { Line, Panel, when } from "./parts";

const SPOTS: Record<string, string> = {
  moon: "Moon",
  drawer: "Drawer",
  shooting_star: "Shooting star",
  pet_bed: "Pet bed",
  frame: "Frame",
};

export const DECORATIONS: Record<string, string> = {
  lanterns: "Lanterns",
  crescent: "Crescent",
  string_flags: "String flags",
  hearts: "Hearts",
  balloons: "Balloons",
  tree: "Tree",
};

const emptyNote: NoteInput = { spot: "moon", title: "", body: "", for_user_id: null, unlock_at: null, after_note_id: null };

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function NoteDialog({ note, notes, onClose }: { note: AdminNote | "new" | null; notes: AdminNote[]; onClose: () => void }) {
  const members = useMembers();
  const [form, setForm] = useState<NoteInput>(emptyNote);
  useEffect(() => {
    if (note === "new") setForm(emptyNote);
    else if (note) setForm({ spot: note.spot, title: note.title, body: note.body, for_user_id: note.for_user_id, unlock_at: note.unlock_at, after_note_id: note.after_note_id });
  }, [note]);
  const save = async () => {
    try {
      if (note === "new") await adminApi.createNote(form);
      else if (note) await adminApi.updateNote(note.id, form);
      void queryClient.invalidateQueries({ queryKey: adminKeys.notes });
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Note not saved");
    }
  };
  const others = notes.filter((n) => note === "new" || n.id !== note?.id);
  return (
    <Dialog open={!!note} onOpenChange={(o) => !o && onClose()} title={note === "new" ? "New hidden note" : "Hidden note"} wide>
      <div className="grid gap-3">
        <Field label="Spot">
          <select className={inputClass} value={form.spot} onChange={(e) => setForm({ ...form, spot: e.target.value })}>
            {Object.entries(SPOTS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input dir="auto" className={inputClass} value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Note">
          <textarea dir="auto" rows={8} className={`${inputClass} py-3 font-hand text-lg`} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="For">
            <select className={inputClass} value={form.for_user_id ?? ""} onChange={(e) => setForm({ ...form, for_user_id: e.target.value || null })}>
              <option value="">Both</option>
              {members.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unlocks">
            <input
              type="datetime-local"
              className={inputClass}
              value={toLocalInput(form.unlock_at)}
              onChange={(e) => setForm({ ...form, unlock_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          </Field>
        </div>
        <Field label="After note">
          <select className={inputClass} value={form.after_note_id ?? ""} onChange={(e) => setForm({ ...form, after_note_id: e.target.value || null })} dir="auto">
            <option value="">None</option>
            {others.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || n.body.slice(0, 40)}
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded-card bg-[#fff8ec] p-4 text-[#3b2f2a] shadow-soft">
          <p className="text-xs font-extrabold opacity-60">Preview</p>
          {form.title && (
            <p dir="auto" className="mt-1 font-display text-lg font-semibold">
              {form.title}
            </p>
          )}
          <p dir="auto" className="mt-1 whitespace-pre-wrap font-hand text-xl leading-snug">
            {form.body || "…"}
          </p>
        </div>
        <Button variant="primary" onClick={() => void save()} disabled={!form.body.trim()}>
          Save note
        </Button>
      </div>
    </Dialog>
  );
}

function HiddenNotes() {
  const q = useQuery({ queryKey: adminKeys.notes, queryFn: async () => (await adminApi.notes()).notes });
  const members = useMembers();
  const [editing, setEditing] = useState<AdminNote | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminNote | null>(null);
  const forName = (id: string | null) => (id ? (members.data?.find((u) => u.id === id)?.display_name ?? "One") : "Both");
  return (
    <Panel
      id="hidden-notes"
      title="Hidden notes"
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
          New note
        </Button>
      }
    >
      {q.data && !q.data.length && <Empty>No notes</Empty>}
      {q.data?.map((n) => (
        <Line
          key={n.id}
          label={<span dir="auto">{n.title || n.body.slice(0, 60)}</span>}
          sub={`${SPOTS[n.spot] ?? n.spot} · ${forName(n.for_user_id)}${n.unlock_at ? ` · unlocks ${when(n.unlock_at)}` : ""}${n.after_note_id ? " · after another note" : ""} · found ${n.found_by}`}
        >
          <div className="flex">
            <IconButton label="Edit" size="sm" onClick={() => setEditing(n)}>
              <Pencil />
            </IconButton>
            <IconButton label="Delete" size="sm" onClick={() => setDeleting(n)}>
              <Trash2 />
            </IconButton>
          </div>
        </Line>
      ))}
      <NoteDialog note={editing} notes={q.data ?? []} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this note?"
        action="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await adminApi.deleteNote(deleting.id);
            void queryClient.invalidateQueries({ queryKey: adminKeys.notes });
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </Panel>
  );
}

const emptyHoliday: Holiday = { id: "", name: "", start: "", end: "", decorations: [], playlist_id: null };

function Holidays() {
  const q = useQuery({ queryKey: adminKeys.holidays, queryFn: async () => (await adminApi.holidays()).holidays });
  const playlists = usePlaylists();
  const [editing, setEditing] = useState<Holiday | null>(null);
  const list = q.data ?? [];
  const save = async (next: Holiday[]) => {
    try {
      const r = await adminApi.setHolidays(next);
      queryClient.setQueryData(adminKeys.holidays, r.holidays);
      setEditing(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Holidays not saved");
    }
  };
  const submit = () => {
    if (!editing) return;
    const exists = list.some((h) => h.id === editing.id && editing.id);
    void save(exists ? list.map((h) => (h.id === editing.id ? editing : h)) : [...list, editing]);
  };
  const toggleDecoration = (id: string) =>
    editing &&
    setEditing({ ...editing, decorations: editing.decorations.includes(id) ? editing.decorations.filter((d) => d !== id) : [...editing.decorations, id] });
  return (
    <Panel
      id="holidays"
      title="Holidays"
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing({ ...emptyHoliday })}>
          New holiday
        </Button>
      }
    >
      {q.data && !list.length && <Empty>No holidays</Empty>}
      {list.map((h) => (
        <Line key={h.id} label={<span dir="auto">{h.name}</span>} sub={`${h.start} – ${h.end} · ${h.decorations.map((d) => DECORATIONS[d] ?? d).join(", ") || "No decorations"}`}>
          <div className="flex">
            <IconButton label="Edit" size="sm" onClick={() => setEditing(h)}>
              <Pencil />
            </IconButton>
            <IconButton label="Delete" size="sm" onClick={() => void save(list.filter((x) => x.id !== h.id))}>
              <Trash2 />
            </IconButton>
          </div>
        </Line>
      ))}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Holiday" : "New holiday"}>
        {editing && (
          <div className="grid gap-3">
            <Field label="Name">
              <input dir="auto" className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First day (MM-DD)">
                <input className={inputClass} placeholder="12-24" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} />
              </Field>
              <Field label="Last day (MM-DD)">
                <input className={inputClass} placeholder="12-26" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} />
              </Field>
            </div>
            <Field label="Decorations">
              <div className="flex flex-wrap gap-2">
                {Object.entries(DECORATIONS).map(([id, l]) => (
                  <Chip key={id} selected={editing.decorations.includes(id)} onClick={() => toggleDecoration(id)}>
                    {l}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Playlist">
              <select
                dir="auto"
                className={inputClass}
                value={editing.playlist_id ?? ""}
                onChange={(e) => setEditing({ ...editing, playlist_id: e.target.value || null })}
              >
                <option value="">None</option>
                {playlists.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" onClick={submit} disabled={!editing.name.trim() || !editing.start || !editing.end}>
              Save holiday
            </Button>
          </div>
        )}
      </Dialog>
    </Panel>
  );
}

function RoomSettingsAdmin() {
  const q = useQuery({ queryKey: adminKeys.room, queryFn: adminApi.room });
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [stages, setStages] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [lamp, setLamp] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setThresholds(Object.fromEntries(q.data.unlockables.filter((u) => u.metric !== "milestone").map((u) => [u.id, String(u.threshold)])));
    setStages(q.data.plant_stages.slice(1).map(String));
    setStart(q.data.milestone_start);
    setLamp(String(q.data.lamp_minutes));
  }, [q.data]);
  const save = async () => {
    try {
      const r = await adminApi.setRoom({
        thresholds: Object.fromEntries(Object.entries(thresholds).map(([k, v]) => [k, Math.max(1, Math.round(Number(v) || 1))])),
        plant_stages: [0, ...stages.map((v) => Number(v) || 0)],
        milestone_start: start,
        lamp_minutes: Math.round(Number(lamp) || 60),
      });
      queryClient.setQueryData(adminKeys.room, r);
      void queryClient.invalidateQueries({ queryKey: ["room", "config"] });
      toast("Room settings saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    }
  };
  const unit: Record<string, string> = { hours: "hours", likes: "liked songs", days: "days" };
  return (
    <>
      <Panel title="Unlocks">
        {q.data?.unlockables
          .filter((u) => u.metric !== "milestone")
          .map((u) => (
            <Line key={u.id} label={u.label}>
              <label className="flex items-center gap-2 text-sm font-semibold text-muted">
                <input
                  type="number"
                  min={1}
                  aria-label={`${u.label} threshold`}
                  className={`${inputClass} w-28`}
                  value={thresholds[u.id] ?? ""}
                  onChange={(e) => setThresholds({ ...thresholds, [u.id]: e.target.value })}
                />
                {unit[u.metric]}
              </label>
            </Line>
          ))}
        {q.data?.unlockables
          .filter((u) => u.metric === "milestone")
          .map((u) => (
            <Line key={u.id} label={u.label}>
              <span className="font-bold text-muted">{q.data?.milestones.find((m) => m.id === u.milestone)?.label ?? u.milestone}</span>
            </Line>
          ))}
      </Panel>
      <Panel title="Plant growth">
        {stages.map((v, i) => (
          <Line key={i} label={`Stage ${i + 1}`}>
            <label className="flex items-center gap-2 text-sm font-semibold text-muted">
              <input
                type="number"
                min={0}
                step={0.5}
                aria-label={`Stage ${i + 1} listening hours`}
                className={`${inputClass} w-28`}
                value={v}
                onChange={(e) => setStages(stages.map((s, j) => (j === i ? e.target.value : s)))}
              />
              hours
            </label>
          </Line>
        ))}
      </Panel>
      <Panel title="Milestones">
        <Line label="Start date">
          <input type="date" className={`${inputClass} w-44`} value={start} onChange={(e) => setStart(e.target.value)} />
        </Line>
        {q.data?.milestones.map((m) => (
          <Line key={m.id} label={m.label}>
            <span className="tabular font-bold text-muted">
              {new Date(`${m.date}T12:00:00`).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}
              {m.reached ? " · reached" : ""}
            </span>
          </Line>
        ))}
      </Panel>
      <Panel title="Lamp">
        <Line label="Lamp duration (minutes)">
          <input type="number" min={5} max={1440} className={`${inputClass} w-28`} value={lamp} onChange={(e) => setLamp(e.target.value)} />
        </Line>
      </Panel>
      <Button variant="primary" onClick={() => void save()} disabled={!q.data}>
        Save room settings
      </Button>
    </>
  );
}

export function Content() {
  return (
    <>
      <ContentOverview />
      <OurSongAdmin />
      <QuestionsAdmin />
      <HiddenNotes />
      <Holidays />
      <ChatAdmin />
    </>
  );
}

export function RoomAdmin() {
  return <RoomSettingsAdmin />;
}

function OurSongAdmin() {
  const q = useOurSong();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Track | null>(null);
  const [story, setStory] = useState("");
  useEffect(() => {
    if (!q.data) return;
    setPicked(q.data.track);
    setStory(q.data.story);
  }, [q.data]);
  const results = useQuery({
    queryKey: ["library-search", search.trim()],
    queryFn: async () => (await api.searchLibrary(search.trim())).tracks,
    enabled: search.trim().length > 1,
  });
  const save = async () => {
    try {
      const r = await setOurSong(picked?.id ?? null, story);
      queryClient.setQueryData(ourSongKey, r);
      toast("Our song saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    }
  };
  return (
    <Panel title="Our song">
      <div className="grid gap-3 p-1">
        {picked ? (
          <Line label={<span dir="auto">{picked.title}</span>} sub={<span dir="auto">{picked.artists.join(", ")}</span>}>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </Line>
        ) : (
          <>
            <input aria-label="Song" placeholder="Song" dir="auto" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />
            {results.data?.slice(0, 8).map((t) => (
              <Line key={t.id} label={<span dir="auto">{t.title}</span>} sub={<span dir="auto">{t.artists.join(", ")}</span>}>
                <Button size="sm" onClick={() => setPicked(t)}>
                  Choose
                </Button>
              </Line>
            ))}
          </>
        )}
        <Field label="Story">
          <textarea dir="auto" rows={8} className={`${inputClass} py-3 font-hand text-lg`} value={story} onChange={(e) => setStory(e.target.value)} />
        </Field>
        <Button variant="primary" onClick={() => void save()}>
          Save our song
        </Button>
      </div>
    </Panel>
  );
}
