"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Loading } from "@/components/common";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, inputClass } from "@/components/ui";
import { datesApi, datesKeys, useRecapNotes, useRecaps, type NoteSlot, type RecapEntry, type RecapNote, type RecapPeriod } from "@/lib/dates";
import { queryClient } from "@/lib/queries";
import { useIsAdmin, useMe, useMembers } from "@/lib/session";
import { useResolvedTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";

import { DatePanel, Figure, fmtDay, fmtMonth, fmtMonthName } from "./parts";
import { recapHref, RecapPrompt } from "./RecapPrompt";
import { SLIDE_THEMES, Skyline } from "./RecapSlides";
import { RecapStory } from "./RecapStory";

function RecapTile({ r }: { r: RecapEntry }) {
  const theme = useResolvedTheme();
  const t = SLIDE_THEMES[theme];
  const year = r.period === "year";
  return (
    <Link href={recapHref(r)} className="group grid gap-1.5">
      <span
        className="relative flex aspect-[9/16] flex-col justify-between overflow-hidden rounded-[10px] p-3 shadow-[0_8px_18px_rgba(10,8,30,0.25)] transition-transform duration-200 group-hover:-translate-y-1"
        style={{ background: t.sky, color: t.text }}
      >
        <Skyline seed={Number(r.starts_on.replaceAll("-", ""))} theme={t} />
        <span className="relative flex items-start justify-between gap-1">
          <PixelIcon name={year ? "rings" : "recap"} size={36} />
          {!r.opened && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-extrabold text-on-accent">New</span>}
        </span>
        <span className="relative mb-[22%] font-display text-[22px] font-semibold leading-tight">{year ? "Our year" : fmtMonthName(r.starts_on)}</span>
      </span>
      <span className="truncate text-sm font-extrabold">{year ? `${r.starts_on.slice(0, 4)}–${r.ends_on.slice(0, 4)}` : fmtMonth(r.starts_on)}</span>
    </Link>
  );
}

function slotName(s: NoteSlot) {
  return s.period === "month" ? `${fmtMonth(s.starts_on)} recap` : `Year recap ${s.starts_on.slice(0, 4)}–${s.ends_on.slice(0, 4)}`;
}

function NoteEditor({ slot, note }: { slot: NoteSlot; note: RecapNote | undefined }) {
  const [body, setBody] = useState(note?.body ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setBody(note?.body ?? ""), [note?.body]);
  const dirty = body.trim() !== (note?.body ?? "");
  const save = async () => {
    setBusy(true);
    try {
      await datesApi.setNote(slot.period, slot.starts_on, body);
      await queryClient.invalidateQueries({ queryKey: datesKeys.notes });
      toast(body.trim() ? "Note saved" : "Note removed");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Note not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="grid grid-cols-1 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="block font-extrabold">{slotName(slot)}</span>
          <span className="block text-sm font-semibold text-muted">Released {fmtDay(slot.released_on)}</span>
        </span>
        {note?.placeholder && <PlaceholderMark />}
      </div>
      <textarea
        dir="auto"
        rows={3}
        aria-label={slotName(slot)}
        maxLength={2000}
        className={`${inputClass} py-3 font-hand text-xl leading-snug`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          Save note
        </Button>
      </div>
    </li>
  );
}

export function RecapNotesList() {
  const q = useRecapNotes();
  const find = (s: NoteSlot) => q.data?.notes.find((n) => n.period === s.period && n.starts_on === s.starts_on);
  if (q.isLoading) return <Loading />;
  return (
    <ul className="grid grid-cols-1 gap-6">
      {q.data?.slots.map((s) => (
        <NoteEditor key={`${s.period}:${s.starts_on}`} slot={s} note={find(s)} />
      ))}
    </ul>
  );
}

function RecapNotesEditor() {
  const me = useMe().data;
  const members = useMembers();
  const other = members.data?.find((u) => u.id !== me?.id);
  return (
    <DatePanel title={other ? `Notes for ${other.display_name}` : "Recap notes"}>
      <RecapNotesList />
    </DatePanel>
  );
}

export function RecapPreviewForm() {
  const members = useMembers();
  const [person, setPerson] = useState("");
  const href = (p: RecapPeriod) => `/recaps/?preview=${p}${person ? `&for=${person}` : ""}`;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
      <Field label="For">
        <select className={inputClass} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">You</option>
          {members.data
            ?.filter((u) => u.role !== "admin")
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}
              </option>
            ))}
        </select>
      </Field>
      <Link href={href("month")} className="inline-flex min-h-11 items-center justify-center rounded-button bg-accent-soft/70 px-4 font-semibold hover:bg-accent-soft">
        This month
      </Link>
      <Link href={href("year")} className="inline-flex min-h-11 items-center justify-center rounded-button bg-accent-soft/70 px-4 font-semibold hover:bg-accent-soft">
        This year
      </Link>
    </div>
  );
}

function OpenRecap() {
  const params = useSearchParams();
  const router = useRouter();
  const period = params.get("period") as RecapPeriod | null;
  const start = params.get("start");
  const preview = params.get("preview") as RecapPeriod | null;
  const forUser = params.get("for") ?? undefined;
  const key = preview ? datesKeys.recap(preview, "current", forUser, true) : datesKeys.recap(period ?? "month", start ?? "", forUser);
  const q = useQuery({
    queryKey: key,
    queryFn: () => (preview ? datesApi.preview(preview, forUser) : datesApi.recap(period!, start!, forUser)),
    enabled: !!preview || (!!period && !!start),
    retry: false,
  });
  if (!preview && !(period && start)) return null;
  if (q.isError) {
    return (
      <div className="mb-6">
        <Empty>Recap not available</Empty>
      </div>
    );
  }
  if (!q.data) return null;
  return <RecapStory recap={q.data} onClose={() => router.replace("/recaps/", { scroll: false })} />;
}

export function RecapsView() {
  const q = useRecaps();
  const admin = useIsAdmin();
  const months = q.data?.months ?? [];
  const years = q.data?.years ?? [];
  return (
    <>
      <PageHero title="Recaps" meta={q.data ? `Next recap ${fmtDay(q.data.next_month)}` : undefined} />
      <OpenRecap />
      <div className="grid grid-cols-1 gap-8">
        <RecapPrompt />
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">Monthly recaps</h2>
          {q.isLoading && <Loading />}
          {q.data && !months.length ? (
            <Empty>No recaps yet</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {months.map((r) => (
                <RecapTile key={r.starts_on} r={r} />
              ))}
            </div>
          )}
        </section>
        {(years.length > 0 || q.data?.next_year) && (
          <section>
            <h2 className="mb-3 font-display text-xl font-semibold">Year recaps</h2>
            {years.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {years.map((r) => (
                  <RecapTile key={r.starts_on} r={r} />
                ))}
              </div>
            ) : (
              q.data?.next_year && <Figure label="Next year recap" value={fmtDay(q.data.next_year)} className="max-w-xs" />
            )}
          </section>
        )}
        <div className="max-w-3xl">
          <RecapNotesEditor />
        </div>
        {admin && (
          <DatePanel title="Preview" className="max-w-3xl">
            <RecapPreviewForm />
          </DatePanel>
        )}
      </div>
    </>
  );
}
