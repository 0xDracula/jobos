"use client";

import { useEffect, useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { Button, Chip, Field, Segmented, Switch, inputClass } from "@/components/ui";
import { reminderOptions } from "@/lib/dateMath";
import { DATE_KINDS, datesApi, refreshDates, type DateInput, type DateItem, type DateKind } from "@/lib/dates";
import { usePlaylists } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

export const DECORATION_LABELS: Record<string, string> = {
  balloons: "Balloons",
  string_flags: "String flags",
  hearts: "Hearts",
  lanterns: "Lanterns",
  crescent: "Crescent",
  tree: "Tree",
};

const DEFAULT_DECORATIONS: Partial<Record<DateKind, string[]>> = { birthday: ["balloons", "string_flags"], anniversary: ["hearts", "balloons"] };

const emptyInput = (date: string, kind: DateKind = "plan"): DateInput => ({
  kind,
  label: "",
  date,
  time: null,
  note: "",
  recurring: false,
  surprise: false,
  user_id: null,
  playlist_id: null,
  decorations: [],
  remind_minutes: null,
});

const inputOf = (d: DateItem): DateInput => ({
  kind: d.kind,
  label: d.label,
  date: d.date,
  time: d.time,
  note: d.note,
  recurring: d.recurring,
  surprise: d.surprise,
  user_id: d.user_id,
  playlist_id: d.playlist_id,
  decorations: d.decorations,
  remind_minutes: d.remind_minutes,
});

export function DateDialog({ editing, onClose }: { editing: DateItem | { new: string; kind?: DateKind } | null; onClose: () => void }) {
  const members = useMembers();
  const playlists = usePlaylists();
  const [form, setForm] = useState<DateInput>(emptyInput(""));
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const existing = editing && "id" in editing ? editing : null;

  useEffect(() => {
    if (!editing) return;
    setForm("id" in editing ? inputOf(editing) : emptyInput(editing.new, editing.kind));
  }, [editing]);

  const set = (patch: Partial<DateInput>) => setForm((f) => ({ ...f, ...patch }));
  const occasion = form.kind === "birthday" || form.kind === "anniversary";
  const timed = form.kind === "plan" || form.kind === "countdown" || form.kind === "other";
  const withExtras = occasion || form.kind === "other";

  const setKind = (kind: DateKind) =>
    set({
      kind,
      recurring: kind === "birthday" || kind === "anniversary" ? true : kind === "plan" ? false : form.recurring,
      decorations: form.decorations.length ? form.decorations : (DEFAULT_DECORATIONS[kind] ?? []),
      time: kind === "birthday" || kind === "anniversary" ? null : form.time,
      user_id: kind === "birthday" ? form.user_id : null,
    });

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, time: timed ? form.time || null : null };
      if (existing) await datesApi.updateDate(existing.id, body);
      else await datesApi.createDate(body);
      refreshDates();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Date not saved");
    } finally {
      setBusy(false);
    }
  };

  const toggleDecoration = (id: string) =>
    set({ decorations: form.decorations.includes(id) ? form.decorations.filter((d) => d !== id) : [...form.decorations, id] });

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()} title={existing ? "Date" : "New date"} wide>
      <form
        className="grid grid-cols-1 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.label.trim() && form.date) void save();
        }}
      >
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <Segmented label="Type" value={form.kind} options={DATE_KINDS} onChange={setKind} />
        </div>
        <Field label="Title">
          <input dir="auto" className={inputClass} value={form.label} maxLength={80} onChange={(e) => set({ label: e.target.value })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className={inputClass} value={form.date} onChange={(e) => set({ date: e.target.value })} required />
          </Field>
          {timed && (
            <Field label="Time">
              <input type="time" className={inputClass} value={form.time ?? ""} onChange={(e) => set({ time: e.target.value || null })} />
            </Field>
          )}
        </div>
        {(form.kind === "plan" || form.kind === "other") && (
          <Field label="Note">
            <textarea dir="auto" rows={3} className={`${inputClass} py-3`} value={form.note} maxLength={2000} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        )}
        {form.kind === "birthday" && (
          <Field label="Person">
            <select className={inputClass} value={form.user_id ?? ""} onChange={(e) => set({ user_id: e.target.value || null })}>
              <option value="">None</option>
              {members.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {withExtras && (
          <>
            <Field label="Playlist">
              <select dir="auto" className={inputClass} value={form.playlist_id ?? ""} onChange={(e) => set({ playlist_id: e.target.value || null })}>
                <option value="">None</option>
                {playlists.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Room decorations">
              <div className="flex flex-wrap gap-2">
                {Object.entries(DECORATION_LABELS).map(([id, label]) => (
                  <Chip key={id} selected={form.decorations.includes(id)} onClick={() => toggleDecoration(id)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </Field>
          </>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Reminder">
            <select
              className={inputClass}
              value={form.remind_minutes == null ? "" : String(form.remind_minutes)}
              onChange={(e) => set({ remind_minutes: e.target.value === "" ? null : Number(e.target.value) })}
            >
              {reminderOptions(timed && !!form.time).map(([m, label]) => (
                <option key={label} value={m == null ? "" : String(m)}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid content-end gap-2">
            {(form.kind === "countdown" || form.kind === "other") && (
              <label className="flex min-h-11 items-center justify-between gap-3 font-semibold">
                Every year
                <Switch label="Every year" checked={form.recurring} onCheckedChange={(on) => set({ recurring: on })} />
              </label>
            )}
            <label className="flex min-h-11 items-center justify-between gap-3 font-semibold">
              Surprise
              <Switch label="Surprise" checked={form.surprise} onCheckedChange={(on) => set({ surprise: on })} />
            </label>
          </div>
        </div>
        <div className="mt-1 flex gap-2">
          {existing && (
            <Button variant="ghost" onClick={() => setRemoving(true)} disabled={busy}>
              Delete
            </Button>
          )}
          <Button type="submit" variant="primary" className="flex-1" disabled={busy || !form.label.trim() || !form.date}>
            Save date
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete this date?"
        action="Delete"
        onConfirm={async () => {
          if (!existing) return;
          try {
            await datesApi.deleteDate(existing.id);
            refreshDates();
            onClose();
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </Dialog>
  );
}
