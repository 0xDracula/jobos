"use client";

import { GripVertical, Headphones, ListX, LogOut, Save, X } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/cn";
import { useCreatePlaylist } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { useTogether } from "@/lib/together";
import { toast } from "@/lib/toast";
import { clearQueue, jumpTo, removeFromQueue, reorderUpcoming } from "@/player/controls";
import { usePlayer, type QueueItem } from "@/player/store";
import { leaveSession, startSession } from "@/player/together";

import { NamePromptDialog } from "../dialogs";
import { PersonBadge } from "../PersonBadge";
import { Artwork, LevelMeter } from "../media";
import { Button, IconButton } from "../ui";

function TogetherButton({ disabled }: { disabled: boolean }) {
  const me = useMe().data;
  const room = useTogether().data;
  const inside = !!(me && room?.active && room.members.includes(me.id));
  if (room?.active && !inside) return null;
  return inside ? (
    <Button size="sm" variant="ghost" onClick={leaveSession}>
      <LogOut className="size-4" /> Leave
    </Button>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => startSession()} disabled={disabled}>
      <Headphones className="size-4" /> Together
    </Button>
  );
}

const SHOWN = 150;

export function QueuePanel() {
  const { queue, index, playing } = usePlayer(useShallow((s) => ({ queue: s.queue, index: s.index, playing: s.playing })));
  const [saving, setSaving] = useState(false);
  const create = useCreatePlaylist();
  const current = queue[index];
  const upcoming = useMemo(() => queue.slice(index + 1, index + 1 + SHOWN), [queue, index]);
  const more = Math.max(0, queue.length - index - 1 - SHOWN);

  const move = (item: QueueItem, by: number) => {
    const i = upcoming.indexOf(item);
    const j = i + by;
    if (i < 0 || j < 0 || j >= upcoming.length) return;
    const run = [...upcoming];
    [run[i], run[j]] = [run[j], run[i]];
    reorderUpcoming(run);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <h2 className="font-display text-xl font-semibold">Queue</h2>
        <div className="flex gap-1">
          <TogetherButton disabled={!queue.length} />
          <Button size="sm" variant="ghost" onClick={() => setSaving(true)} disabled={!queue.length}>
            <Save className="size-4" /> Save
          </Button>
          <Button size="sm" variant="ghost" onClick={clearQueue} disabled={!upcoming.length}>
            <ListX className="size-4" /> Clear
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        <h3 className="px-1.5 pb-1 text-xs font-extrabold uppercase tracking-wider text-muted">Now playing</h3>
        {current && <Row item={current} current playing={playing} />}
        <h3 className="px-1.5 pb-1 pt-4 text-xs font-extrabold uppercase tracking-wider text-muted">Next</h3>
        {upcoming.length ? (
          <Reorder.Group axis="y" values={upcoming} onReorder={reorderUpcoming} className="grid grid-cols-1 gap-0.5">
            {upcoming.map((item) => (
              <DraggableRow key={item.uid} item={item} onMove={(by) => move(item, by)} />
            ))}
          </Reorder.Group>
        ) : (
          <p className="px-1.5 py-3 font-semibold text-muted">Queue empty</p>
        )}
        {more > 0 && <p className="py-3 text-center text-sm font-bold text-muted">+{more} songs</p>}
      </div>
      <NamePromptDialog
        open={saving}
        onOpenChange={setSaving}
        title="Save queue as playlist"
        initial={`Queue ${new Date().toLocaleDateString()}`}
        action="Save"
        onSubmit={(name) =>
          create.mutate({ name, trackIds: queue.map((q) => q.track.id) }, { onSuccess: () => toast(`Saved as ${name}`) })
        }
      />
    </div>
  );
}

function AddedBy({ uid }: { uid: string }) {
  const room = useTogether().data;
  const by = room?.active ? room.queue.find((q) => q.key === uid)?.added_by : undefined;
  return by ? <PersonBadge userId={by} /> : null;
}

function Row({
  item,
  current,
  playing,
  handle,
}: {
  item: QueueItem;
  current?: boolean;
  playing?: boolean;
  handle?: React.ReactNode;
}) {
  const t = item.track;
  return (
    <div className={cn("flex items-center gap-2 rounded-button p-1.5 hover:bg-accent-soft/35", current && "bg-accent-soft/45")}>
      {handle}
      <button
        type="button"
        onClick={() => !current && jumpTo(item.uid)}
        aria-label={current ? t.title : `Play ${t.title}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-start"
      >
        <span className="relative size-11 shrink-0">
          <Artwork src={t.artwork_thumb_url} className="size-11 rounded-chip" />
          {current && (
            <span className="absolute inset-0 grid place-items-center rounded-chip bg-[#1e1b3a]/40 text-white">
              <LevelMeter playing={!!playing} />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span dir="auto" className={cn("block truncate font-bold", current && "text-accent-strong")}>
            {t.title}
          </span>
          <span dir="auto" className="block truncate text-sm font-semibold text-muted">
            {t.artists.join(", ")}
          </span>
        </span>
      </button>
      <AddedBy uid={item.uid} />
      {!current && (
        <IconButton label={`Remove ${t.title}`} size="sm" onClick={() => removeFromQueue(item.uid)}>
          <X />
        </IconButton>
      )}
    </div>
  );
}

function DraggableRow({ item, onMove }: { item: QueueItem; onMove: (by: number) => void }) {
  const controls = useDragControls();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="relative rounded-button"
      whileDrag={{ scale: 1.02, boxShadow: "var(--shadow)", zIndex: 1 }}
    >
      <Row
        item={item}
        handle={
          <button
            type="button"
            aria-label={`Move ${item.track.title}`}
            onPointerDown={(e) => controls.start(e)}
            onKeyDown={onKey}
            className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-full text-muted hover:bg-accent-soft/60 active:cursor-grabbing"
          >
            <GripVertical className="size-5" />
          </button>
        }
      />
    </Reorder.Item>
  );
}
