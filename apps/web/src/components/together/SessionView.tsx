"use client";

import { Check, GripVertical, Headphones, LogOut, NotebookPen, Pencil, Play, Plus, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/avatar";
import { Loading } from "@/components/common";
import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { Artwork, LevelMeter } from "@/components/media";
import { PersonBadge } from "@/components/PersonBadge";
import { NextButton, PlayButton, PrevButton } from "@/components/player/Transport";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, IconButton, SectionTitle, inputClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs, plural } from "@/lib/format";
import { sessionApi, sessionTitle, sessionWhen, useListeningSession, type ListeningSession, type SessionItem } from "@/lib/sessions";
import { useMe, useMembers } from "@/lib/session";
import { usePresence } from "@/lib/social";
import { toast } from "@/lib/toast";
import { useTogether } from "@/lib/together";
import { jumpTo } from "@/player/controls";
import { usePlayer } from "@/player/store";
import { joinSession, leaveSession } from "@/player/together";

import { AddSongsDialog } from "./AddSongs";
import { ReactionBar } from "./Reactions";
import { SessionForm } from "./SessionForm";

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError ? err.message : fallback);

function Row({
  item, sessionId, editable, current, played, playing, canJump, onDragEnd,
}: {
  item: SessionItem;
  sessionId: string;
  editable: boolean;
  current: boolean;
  played: boolean;
  playing: boolean;
  canJump: boolean;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(item.note);
  const t = item.track;
  const body = (
    <>
      <Artwork src={t?.artwork_thumb_url ?? null} className="size-12 shrink-0 rounded-[8px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span dir="auto" className={cn("truncate font-bold", current && "text-accent-strong")}>
            {t?.title ?? "—"}
          </span>
          {current && <LevelMeter playing={playing} className="shrink-0 text-accent-strong" />}
        </span>
        <span dir="auto" className="block truncate text-sm font-semibold text-muted">
          {t?.artists.join(", ")}
          {t?.duration_ms ? ` · ${fmtMs(t.duration_ms)}` : ""}
        </span>
        {item.note && (
          <span dir="auto" className="block truncate font-hand text-lg leading-tight text-ink/85">
            {item.note}
          </span>
        )}
      </span>
    </>
  );
  return (
    <Reorder.Item
      value={item.key}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-2 rounded-[12px] border border-line bg-panel p-2 [touch-action:pan-y]",
        current && "border-accent-strong/60",
        played && !current && "opacity-55",
      )}
    >
      {editable && (
        <button type="button" aria-label="Reorder" className="grid h-11 w-7 shrink-0 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing" onPointerDown={(e) => controls.start(e)}>
          <GripVertical className="size-5" />
        </button>
      )}
      {canJump && !current ? (
        <button type="button" onClick={() => jumpTo(item.key)} className="flex min-w-0 flex-1 items-center gap-3 text-start" aria-label={`Play ${t?.title ?? "song"}`}>
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}
      {played && !current && <Check aria-label="Played" className="size-4 shrink-0 text-muted" />}
      {item.added_by && <PersonBadge userId={item.added_by} size={28} />}
      {editable && (
        <>
          <IconButton label="Note" size="sm" onClick={() => setNoting(true)}>
            <NotebookPen />
          </IconButton>
          <IconButton
            label="Remove"
            size="sm"
            disabled={current}
            onClick={() => void sessionApi.removeItem(sessionId, item.key).catch((e) => fail(e, "Not removed"))}
          >
            <X />
          </IconButton>
        </>
      )}
      <Dialog open={noting} onOpenChange={setNoting} title="Note">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sessionApi
              .note(sessionId, item.key, note)
              .then(() => setNoting(false))
              .catch((err) => fail(err, "Not saved"));
          }}
        >
          <textarea dir="auto" rows={3} maxLength={280} aria-label="Note" className={`${inputClass} py-3 font-hand text-xl`} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="primary">
            Save note
          </Button>
        </form>
      </Dialog>
    </Reorder.Item>
  );
}

function Setlist({ s, live, inside, currentKey, playing }: { s: ListeningSession; live: boolean; inside: boolean; currentKey: string | null; playing: boolean }) {
  const items = useMemo(() => s.items ?? [], [s.items]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const editable = s.status !== "ended";
  const [order, setOrder] = useState(() => items.map((i) => i.key));
  const latest = useRef(order);
  const signature = items.map((i) => i.key).join(",");
  useEffect(() => {
    const keys = signature ? signature.split(",") : [];
    setOrder(keys);
    latest.current = keys;
  }, [signature]);
  const reorder = (keys: string[]) => {
    latest.current = keys;
    setOrder(keys);
  };
  const save = () => {
    if (latest.current.join(",") === signature) return;
    void sessionApi.order(s.id, latest.current).catch((e) => fail(e, "Order not saved"));
  };
  if (!items.length) return <Empty>No songs</Empty>;
  return (
    <Reorder.Group axis="y" values={order} onReorder={reorder} as="ol" className="grid gap-1.5">
      {order.map((key) => {
        const item = byKey.get(key);
        if (!item) return null;
        return (
          <Row
            key={key}
            item={item}
            sessionId={s.id}
            editable={editable}
            current={live && key === currentKey}
            played={!!item.played_at}
            playing={playing}
            canJump={inside}
            onDragEnd={save}
          />
        );
      })}
    </Reorder.Group>
  );
}

function People({ s, here }: { s: ListeningSession; here: string[] }) {
  const members = useMembers().data ?? [];
  const presence = usePresence().data;
  return (
    <div className="flex items-center gap-3">
      {members.map((u) => {
        const inRoom = here.includes(u.id);
        const online = presence?.people.find((p) => p.id === u.id)?.online;
        return (
          <span key={u.id} className="flex items-center gap-2">
            <span className={cn("overflow-hidden rounded-full border-2 bg-accent-soft", inRoom ? "border-sage" : "border-transparent")}>
              <Avatar userId={u.id} size={40} pose={inRoom && s.status === "live" ? "listening" : "idle"} />
            </span>
            <span className="text-sm font-bold">
              <span dir="auto" className="block leading-tight">
                {u.display_name}
              </span>
              <span className="block text-xs text-muted">{inRoom ? "Here" : online ? "Online" : "Away"}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function SessionView({ id }: { id: string }) {
  const router = useRouter();
  const q = useListeningSession(id);
  const room = useTogether().data;
  const me = useMe().data;
  const playing = usePlayer((p) => p.playing);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const s = q.data;
  if (q.isLoading) return <Loading />;
  if (!s) return <Empty>Session not found</Empty>;
  const live = s.status === "live" && !!room?.active && room.session_id === s.id;
  const here = live ? (room?.members ?? []) : [];
  const inside = live && !!me && here.includes(me.id);
  const currentKey = live ? (room?.queue[room.index]?.key ?? null) : null;
  const current = s.items?.find((i) => i.key === currentKey) ?? null;
  const act = (fn: () => Promise<unknown>, failText: string) => void fn().catch((e) => fail(e, failText));
  const meta =
    s.status === "planned"
      ? `${sessionWhen(s.scheduled_at)} · ${plural(s.item_count, "song")}`
      : s.status === "live"
        ? `Live · ${plural(s.item_count, "song")}`
        : `${s.ended_at ? new Date(s.ended_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : ""} · ${plural(s.played_count, "song")} played · ${Math.round(s.together_ms / 60_000)} min together`;
  return (
    <>
      <PageHero title={sessionTitle(s)} meta={meta}>
        <div className="grid gap-4">
          <People s={s} here={here} />
          <div className="flex flex-wrap gap-2">
            {s.status === "planned" && (
              <>
                <Button variant="primary" onClick={() => act(() => sessionApi.start(s.id), "Session not started")}>
                  <Play className="size-5" /> Start
                </Button>
                <Button onClick={() => act(() => sessionApi.invite(s.id).then(() => toast("Invite sent")), "Invite not sent")}>
                  <Send className="size-5" /> Invite
                </Button>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil className="size-5" /> Edit
                </Button>
                <Button variant="ghost" onClick={() => setConfirm("delete")}>
                  <Trash2 className="size-5" /> Delete
                </Button>
              </>
            )}
            {live && !inside && (
              <Button variant="primary" onClick={joinSession}>
                <Headphones className="size-5" /> Join
              </Button>
            )}
            {live && inside && (
              <>
                <Button onClick={leaveSession}>
                  <LogOut className="size-5" /> Leave
                </Button>
                <Button variant="ghost" onClick={() => setConfirm("end")}>
                  <Square className="size-5" /> End
                </Button>
              </>
            )}
            {s.status === "ended" && (
              <>
                <Button variant="primary" onClick={() => act(() => sessionApi.copy(s.id).then(({ id: nid }) => router.push(`/together/?id=${nid}`)), "Not copied")}>
                  <RotateCcw className="size-5" /> Plan again
                </Button>
                <Button variant="ghost" onClick={() => setConfirm("delete")}>
                  <Trash2 className="size-5" /> Delete
                </Button>
              </>
            )}
          </div>
        </div>
      </PageHero>

      <div className="grid grid-cols-1 gap-8">
        {live && current && (
          <section className="grid gap-4 rounded-[14px] border border-panel-line bg-panel p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <Artwork src={current.track?.artwork_thumb_url ?? null} className="size-28 justify-self-center rounded-[12px] shadow-soft sm:justify-self-start" />
            <div className="grid min-w-0 gap-3">
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-muted">Now playing</p>
                <p dir="auto" className="truncate font-display text-2xl font-semibold">
                  {current.track?.title}
                </p>
                <p dir="auto" className="truncate font-bold text-muted">
                  {current.track?.artists.join(", ")}
                </p>
              </div>
              {inside && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1">
                    <PrevButton />
                    <PlayButton size="md" />
                    <NextButton />
                  </div>
                  <ReactionBar />
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <SectionTitle
            action={
              s.status !== "ended" ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-4" /> Add songs
                </Button>
              ) : undefined
            }
          >
            Setlist
          </SectionTitle>
          <Setlist s={s} live={live} inside={inside} currentKey={currentKey} playing={playing} />
        </section>
      </div>

      <AddSongsDialog sessionId={s.id} live={live} open={adding} onOpenChange={setAdding} />
      <SessionForm open={editing} onOpenChange={setEditing} session={s} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "end" ? "End this session?" : "Delete this session?"}
        action={confirm === "end" ? "End" : "Delete"}
        onConfirm={async () => {
          try {
            if (confirm === "end") await sessionApi.end(s.id);
            else {
              await sessionApi.remove(s.id);
              router.push("/together/");
            }
          } catch (e) {
            fail(e, "Not done");
          }
        }}
      />
    </>
  );
}
