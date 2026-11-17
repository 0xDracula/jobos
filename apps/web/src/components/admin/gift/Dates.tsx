"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { DateDialog, DECORATION_LABELS } from "@/components/dates/DateDialog";
import { fmtDay, kindIcon } from "@/components/dates/parts";
import { RecapNotesList, RecapPreviewForm } from "@/components/dates/RecapsView";
import { ConfirmDialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { Button, Empty, IconButton } from "@/components/ui";
import { dayKey, reminderLabel } from "@/lib/dateMath";
import { datesApi, KIND_LABELS, refreshDates, useDates, type DateItem } from "@/lib/dates";
import { usePlaylists } from "@/lib/queries";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

import { Line, Panel } from "../parts";

const today = () => {
  const d = new Date();
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

function CalendarAdmin() {
  const q = useDates();
  const playlists = usePlaylists();
  const members = useMembers();
  const [editing, setEditing] = useState<DateItem | { new: string } | null>(null);
  const [deleting, setDeleting] = useState<DateItem | null>(null);
  const playlistName = (id: string) => playlists.data?.find((p) => p.id === id)?.name ?? "Playlist";
  const person = (id: string | null) => (id ? members.data?.find((u) => u.id === id)?.display_name : null);
  return (
    <Panel
      title="Calendar"
      action={
        <Button size="sm" variant="primary" onClick={() => setEditing({ new: today() })}>
          New date
        </Button>
      }
    >
      {q.data && !q.data.length && <Empty>No dates</Empty>}
      {q.data?.map((d) => {
        const hidden = d.surprise && !d.label;
        const occasion = d.kind === "birthday" || d.kind === "anniversary";
        return (
          <Line
            key={d.id}
            label={
              <span className="flex flex-wrap items-center gap-2">
                <PixelIcon name={hidden ? "present" : kindIcon(d.kind)} size={24} />
                <span dir="auto">{hidden ? "Surprise" : d.label}</span>
                {d.placeholder && <PlaceholderMark />}
              </span>
            }
            sub={
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>
                  {[
                    KIND_LABELS[d.kind],
                    d.recurring ? `${fmtDay(d.date, "short")} · Every year` : fmtDay(d.date),
                    d.time,
                    person(d.user_id),
                    d.surprise ? "Surprise" : null,
                    hidden || d.remind_minutes == null ? null : `Reminder ${reminderLabel(d.remind_minutes, !!d.time).toLowerCase()}`,
                    d.decorations.length ? d.decorations.map((x) => DECORATION_LABELS[x] ?? x).join(", ") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {d.playlist_id ? (
                  <span dir="auto">· {playlistName(d.playlist_id)}</span>
                ) : (
                  occasion && (
                    <span className="inline-flex items-center gap-1.5">
                      · Playlist <PlaceholderMark />
                    </span>
                  )
                )}
              </span>
            }
          >
            {d.editable && (
              <div className="flex">
                <IconButton label="Edit" size="sm" onClick={() => setEditing(d)}>
                  <Pencil />
                </IconButton>
                <IconButton label="Delete" size="sm" onClick={() => setDeleting(d)}>
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </Line>
        );
      })}
      <DateDialog editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this date?"
        action="Delete"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await datesApi.deleteDate(deleting.id);
            refreshDates();
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </Panel>
  );
}

export function DatesAdmin() {
  return (
    <div className="grid gap-6">
      <CalendarAdmin />
      <Panel title="Recap notes">
        <div className="px-3 py-2">
          <RecapNotesList />
        </div>
      </Panel>
      <Panel title="Recap preview">
        <div className="px-3 py-2">
          <RecapPreviewForm />
        </div>
      </Panel>
    </div>
  );
}
