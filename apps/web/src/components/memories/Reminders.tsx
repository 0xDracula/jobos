"use client";

import { Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { memoriesApi, memoryKeys, useCollections, useMemoriesLive, type CollectionItem } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { selectCurrent, usePlayer, type PlayContext } from "@/player/store";

import { SongField, panelClass } from "./parts";

const refresh = () => void queryClient.invalidateQueries({ queryKey: memoryKeys.collections });

function Row({ item, tracks, index, context, mine, onEdit }: { item: CollectionItem; tracks: Track[]; index: number; context: PlayContext; mine: boolean; onEdit: () => void }) {
  const current = usePlayer((s) => selectCurrent(s)?.track.id === item.track_id);
  const [removing, setRemoving] = useState(false);
  const t = item.track;
  if (!t) return null;
  return (
    <li className={cn("flex items-start gap-3 rounded-[10px] p-2", current ? "bg-accent-soft/60" : "hover:bg-accent-soft/30")}>
      <button type="button" onClick={() => playTracks(tracks, index, context)} aria-label={`Play ${t.title}`} className="shrink-0">
        <Artwork src={t.artwork_thumb_url} className="size-12 rounded-[8px]" />
      </button>
      <button type="button" onClick={() => playTracks(tracks, index, context)} className="min-w-0 flex-1 text-start">
        <span dir="auto" className={cn("block truncate font-bold", current && "text-accent-strong")}>
          {t.title}
        </span>
        <span dir="auto" className="block truncate text-sm font-semibold text-muted">
          {t.artists.join(", ")}
        </span>
        {item.reason && (
          <span dir="auto" className="mt-0.5 block whitespace-pre-wrap font-hand text-xl leading-snug">
            {item.reason}
          </span>
        )}
        {item.placeholder && <PlaceholderMark className="mt-1" />}
      </button>
      {mine && (
        <span className="flex shrink-0 flex-col">
          <IconButton label="Reason" size="sm" onClick={onEdit}>
            <Pencil />
          </IconButton>
          <IconButton label="Remove" size="sm" onClick={() => setRemoving(true)}>
            <Trash2 />
          </IconButton>
        </span>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this song?"
        action="Remove"
        onConfirm={async () => {
          try {
            await memoriesApi.removeFromCollection(item.id);
            refresh();
          } catch {
            toast("Not removed");
          }
        }}
      />
    </li>
  );
}

function Collection({ title, items, mine, userId }: { title: string; items: CollectionItem[]; mine: boolean; userId: string }) {
  const [editing, setEditing] = useState<CollectionItem | null>(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState<Track | null>(null);
  const tracks = items.map((i) => i.track).filter((t): t is Track => !!t);
  const context: PlayContext = { type: "playlist", id: `collection:${userId}`, name: title };
  const add = async (t: Track | null) => {
    setAdding(t);
    if (!t) return;
    try {
      const r = await memoriesApi.addToCollection(t.id);
      refresh();
      toast(r.added ? "Added" : "Already in the collection");
    } catch {
      toast("Not added");
    } finally {
      setAdding(null);
    }
  };
  return (
    <section className={cn(panelClass, "grid content-start gap-3 p-3 sm:p-4")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        <Button size="sm" variant="primary" disabled={!tracks.length} onClick={() => playTracks(tracks, 0, context)}>
          <Play className="size-4 fill-current" /> Play
        </Button>
      </div>
      {!items.length && <Empty>No songs</Empty>}
      <ol className="grid gap-1">
        {tracks.length > 0 &&
          items.map((item) => (
            <Row
              key={item.id}
              item={item}
              tracks={tracks}
              index={Math.max(0, tracks.findIndex((t) => t.id === item.track_id))}
              context={context}
              mine={mine}
              onEdit={() => {
                setEditing(item);
                setReason(item.reason);
              }}
            />
          ))}
      </ol>
      {mine && <SongField label="Add song" value={adding} onChange={(t) => void add(t)} />}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Reason">
        <div className="grid gap-3">
          <Field label="Reason">
            <textarea dir="auto" rows={4} className={`${inputClass} py-3 font-hand text-xl`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            onClick={async () => {
              if (!editing) return;
              try {
                await memoriesApi.updateCollectionItem(editing.id, reason);
                refresh();
                setEditing(null);
              } catch {
                toast("Not saved");
              }
            }}
          >
            Save reason
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function Reminders() {
  useMemoriesLive();
  const q = useCollections();
  const me = useMe().data;
  const members = useMembers();
  const others = (members.data ?? []).filter((u) => u.id !== me?.id);
  const items = q.data ?? [];
  return (
    <>
      <PageHero title="Reminds me of you" meta={q.data ? `${items.length} ${items.length === 1 ? "song" : "songs"}` : undefined} />
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      {me && (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <Collection title="From you" items={items.filter((i) => i.user_id === me.id)} mine userId={me.id} />
          {others.map((u) => (
            <Collection key={u.id} title={`From ${u.display_name}`} items={items.filter((i) => i.user_id === u.id)} mine={false} userId={u.id} />
          ))}
        </div>
      )}
    </>
  );
}
