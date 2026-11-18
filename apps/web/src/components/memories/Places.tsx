"use client";

import { MapPin, Music, Pencil, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Loading } from "@/components/common";
import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, SectionTitle, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/days";
import { plural } from "@/lib/format";
import { CAIRO } from "@/lib/mapStyle";
import { memoriesApi, memoryKeys, useMapInfo, useMemoriesLive, usePlaces, type Photo, type Place, type PlaceInput } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { Byline, DayField, PhotoField, PhotoImage, SongChip, SongField, panelClass, playSong, useReducedMotionPref } from "./parts";
import type { MapHandle } from "./PlacesMap";

const PlacesMap = dynamic(() => import("./PlacesMap"), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center">
      <Spinner className="size-6 text-muted" />
    </div>
  ),
});

type Draft = { id: string | null; name: string; lat: number; lon: number; date: string | null; note: string; photo: Photo | null; track: Track | null };

const draftOf = (p: Place): Draft => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, date: p.date, note: p.note, photo: p.photo, track: p.track });

const blank = (lat: number, lon: number): Draft => ({ id: null, name: "", lat, lon, date: null, note: "", photo: null, track: null });

const latestOf = (list: Place[]) => list.filter((p) => p.date).pop() ?? list[list.length - 1] ?? null;

export function Places() {
  useMemoriesLive();
  const linked = useSearchParams().get("id");
  const q = usePlaces();
  const info = useMapInfo();
  const me = useMe().data;
  const reduced = useReducedMotionPref();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [picking, setPicking] = useState<{ draft: Draft; back: boolean } | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<Place | null>(null);
  const mapPanel = useRef<HTMLDivElement>(null);
  const places = useMemo(() => q.data ?? [], [q.data]);
  const selected = places.find((p) => p.id === selectedId) ?? null;
  const mapOn = info.data ? info.data.tiles : null;
  const opening = places.find((p) => p.id === linked) ?? null;

  const handledLink = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!q.data || handledLink.current === linked) return;
    const first = handledLink.current === undefined;
    handledLink.current = linked;
    const target = linked ? q.data.find((p) => p.id === linked) : null;
    if (target) {
      setSelectedId(target.id);
      if (!first) handle?.flyTo(target.lat, target.lon);
    } else if (first) {
      setSelectedId(latestOf(q.data)?.id ?? null);
    }
  }, [q.data, linked, handle]);

  const showMap = () => mapPanel.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });

  const choose = (p: Place, fly: boolean) => {
    setSelectedId(p.id);
    playSong(p.track, p.name);
    if (fly) {
      handle?.flyTo(p.lat, p.lon);
      showMap();
    }
  };

  const startAdd = () => {
    if (mapOn) {
      setPicking({ draft: blank(0, 0), back: false });
      showMap();
    } else {
      setEditing(blank(CAIRO[1], CAIRO[0]));
    }
  };

  const setPinHere = () => {
    if (!picking || !handle) return;
    const c = handle.center();
    setEditing({ ...picking.draft, lat: c.lat, lon: c.lon });
    setPicking(null);
  };

  const cancelPick = () => {
    if (picking?.back) setEditing(picking.draft);
    setPicking(null);
  };

  const movePin = (draft: Draft) => {
    setEditing(null);
    setPicking({ draft, back: true });
    handle?.flyTo(draft.lat, draft.lon);
    showMap();
  };

  const save = async (d: Draft) => {
    const input: PlaceInput = {
      name: d.name.trim(),
      lat: d.lat,
      lon: d.lon,
      date: d.date,
      note: d.note,
      photo_id: d.photo?.id ?? null,
      track_id: d.track?.id ?? null,
    };
    try {
      const res = d.id ? await memoriesApi.updatePlace(d.id, input) : await memoriesApi.createPlace(input);
      queryClient.setQueryData(memoryKeys.places, res.places);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
      const id =
        d.id ??
        res.places
          .filter((p) => p.created_by === me?.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ??
        null;
      setEditing(null);
      toast("Place saved");
      const place = res.places.find((p) => p.id === id);
      if (place) {
        setSelectedId(place.id);
        handle?.flyTo(place.lat, place.lon);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Place not saved");
    }
  };

  const remove = async (p: Place) => {
    try {
      await memoriesApi.deletePlace(p.id);
      const rest = places.filter((x) => x.id !== p.id);
      queryClient.setQueryData(memoryKeys.places, rest);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.places });
      void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
      if (selectedId === p.id) setSelectedId(latestOf(rest)?.id ?? null);
    } catch {
      toast("Not deleted");
    }
  };

  const canDelete = (p: Place) => !!me && (me.id === p.created_by || me.role === "admin");

  return (
    <>
      <PageHero title="Places" meta={q.data ? plural(places.length, "place") : undefined}>
        <Button variant="primary" onClick={startAdd} disabled={!!picking || !q.data}>
          <Plus className="size-5" /> Add place
        </Button>
      </PageHero>
      {q.isLoading && <Loading />}
      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start">
            {mapOn === false ? (
              <Empty>Map unavailable</Empty>
            ) : (
              <div ref={mapPanel} className={cn(panelClass, "relative isolate h-[55vh] min-h-[320px] scroll-mt-6 overflow-hidden lg:h-[62vh]")}>
                {mapOn && (
                  <PlacesMap
                    places={places}
                    selectedId={selectedId}
                    initial={opening}
                    onSelect={(p) => choose(p, false)}
                    onReady={setHandle}
                    className="rounded-[10px]"
                  />
                )}
                {mapOn === null && (
                  <div className="grid size-full place-items-center">
                    <Spinner className="size-6 text-muted" />
                  </div>
                )}
                {picking && <PickOverlay onSet={setPinHere} onCancel={cancelPick} ready={!!handle} />}
              </div>
            )}
            <aside className="grid gap-3">
              {selected ? (
                <PlaceCard
                  place={selected}
                  canDelete={canDelete(selected)}
                  onEdit={() => setEditing(draftOf(selected))}
                  onDelete={() => setRemoving(selected)}
                />
              ) : (
                !places.length && <Empty>No places</Empty>
              )}
            </aside>
          </div>
          {places.length > 0 && (
            <section className="mt-10">
              <SectionTitle>All places</SectionTitle>
              <ul className={cn(panelClass, "grid gap-1 p-2")}>
                {places.map((p) => (
                  <li key={p.id}>
                    <PlaceRow place={p} selected={p.id === selectedId} onChoose={() => choose(p, true)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <PlaceEditor
        draft={editing}
        mapOn={!!mapOn}
        onPatch={(patch) => setEditing((d) => (d ? { ...d, ...patch } : d))}
        onMove={movePin}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this place?"
        action="Delete"
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </>
  );
}

function PickOverlay({ onSet, onCancel, ready }: { onSet: () => void; onCancel: () => void; ready: boolean }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 translate-y-[-83.4%] drop-shadow-[0_3px_4px_rgba(10,8,30,0.35)]">
        <PixelIcon name="pin" size={48} />
      </div>
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2e2c48]/60" />
      <div className={cn(panelClass, "absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center justify-center gap-2 p-2 shadow-soft")}>
        <Button variant="primary" onClick={onSet} disabled={!ready}>
          <MapPin className="size-5" /> Set pin here
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}

function PlaceCard({ place, canDelete, onEdit, onDelete }: { place: Place; canDelete: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className={cn(panelClass, "grid gap-3 p-3")}>
      {place.photo && (
        <div className="overflow-hidden rounded-[8px]">
          <PhotoImage photo={place.photo} size="display" alt={place.photo.caption || place.name} className="aspect-[4/3] w-full" />
        </div>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="font-display text-2xl font-semibold leading-tight">
            {place.name}
          </h2>
          {place.date && <p className="mt-0.5 text-sm font-bold text-muted">{fmtDay(place.date)}</p>}
        </div>
        {place.placeholder && <PlaceholderMark className="mt-1 shrink-0" />}
      </div>
      {place.note && (
        <p dir="auto" className="whitespace-pre-wrap font-hand text-xl leading-snug">
          {place.note}
        </p>
      )}
      {place.track && <SongChip track={place.track} name={place.name} className="justify-self-start" />}
      <div className="flex items-center gap-1">
        <Byline userId={place.created_by} className="min-w-0 flex-1" />
        <IconButton label="Edit" onClick={onEdit}>
          <Pencil />
        </IconButton>
        {canDelete && (
          <IconButton label="Delete" onClick={onDelete}>
            <Trash2 />
          </IconButton>
        )}
      </div>
    </article>
  );
}

function PlaceRow({ place, selected, onChoose }: { place: Place; selected: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-current={selected || undefined}
      className={cn("flex min-h-14 w-full items-center gap-3 rounded-[8px] p-2 text-start transition-colors hover:bg-accent-soft/40", selected && "bg-accent-soft/60")}
    >
      <PhotoImage photo={place.photo} className="size-12 shrink-0 rounded-[6px]" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span dir="auto" className="min-w-0 truncate font-bold">
            {place.name}
          </span>
          {place.placeholder && <PlaceholderMark className="shrink-0" />}
        </span>
        {place.date && <span className="block text-sm font-semibold text-muted">{fmtDay(place.date)}</span>}
        {place.track && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <Music aria-hidden className="size-3.5 shrink-0" />
            <span dir="auto" className="truncate">
              {place.track.title} · {place.track.artists.join(", ")}
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

function PlaceEditor({
  draft,
  mapOn,
  onPatch,
  onMove,
  onClose,
  onSave,
}: {
  draft: Draft | null;
  mapOn: boolean;
  onPatch: (patch: Partial<Draft>) => void;
  onMove: (draft: Draft) => void;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && !saving && onClose()} title={draft?.id ? "Place" : "New place"} wide>
      {draft && (
        <div className="grid gap-4">
          <Field label="Name">
            <input dir="auto" className={inputClass} value={draft.name} maxLength={80} onChange={(e) => onPatch({ name: e.target.value })} />
          </Field>
          {mapOn ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-semibold text-muted">Pin</span>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-panel p-2 ps-3">
                <span className="tabular text-sm font-bold">
                  {draft.lat.toFixed(5)}, {draft.lon.toFixed(5)}
                </span>
                <Button size="sm" onClick={() => onMove(draft)}>
                  <MapPin className="size-4" /> Move pin
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input type="number" step="any" min={-90} max={90} className={inputClass} value={draft.lat} onChange={(e) => onPatch({ lat: num(e.target.value) })} />
              </Field>
              <Field label="Longitude">
                <input type="number" step="any" min={-180} max={180} className={inputClass} value={draft.lon} onChange={(e) => onPatch({ lon: num(e.target.value) })} />
              </Field>
            </div>
          )}
          <DayField label="Date" value={draft.date} onChange={(v) => onPatch({ date: v })} />
          <Field label="Note">
            <textarea dir="auto" rows={4} maxLength={2000} className={`${inputClass} py-3 font-hand text-xl`} value={draft.note} onChange={(e) => onPatch({ note: e.target.value })} />
          </Field>
          <PhotoField value={draft.photo} onChange={(p) => onPatch({ photo: p })} />
          <SongField value={draft.track} onChange={(t) => onPatch({ track: t })} />
          <Button
            variant="primary"
            disabled={saving || !draft.name.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(draft);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Spinner className="size-4" />} Save place
          </Button>
        </div>
      )}
    </Dialog>
  );
}
