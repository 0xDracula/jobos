"use client";

import { ChevronDown, Copy, Crown, Headphones, LogOut, Pause, Play, Plus, SkipBack, SkipForward, Square, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Avatar, lookOf } from "@/avatar";
import { Dialog } from "@/components/dialogs";
import { PersonAvatar } from "@/components/friends/people";
import { SwitchRow } from "@/components/friends/sheets";
import { Artwork } from "@/components/media";
import { AddSongsDialog } from "@/components/together/AddSongs";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { useFriends, type Person } from "@/lib/people";
import { queryClient } from "@/lib/queries";
import { serverNow } from "@/lib/realtime";
import { useMe } from "@/lib/session";
import { conversationName, useConversations } from "@/lib/social";
import { toast } from "@/lib/toast";
import { jamApi, jamKey, jamLink, useJam, useTogether, type TogetherState } from "@/lib/together";
import { useTracks } from "@/lib/tracksById";
import { next, pause, play, previous } from "@/player/controls";
import { joinSession, leaveSession } from "@/player/together";
import { RoomView } from "@/room/ui/RoomView";

export default function JamPage() {
  return (
    <Suspense>
      <JamRoute />
    </Suspense>
  );
}

function JamRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("t");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!token) return;
    jamApi
      .joinLink(token)
      .then(({ id }) => {
        joinSession(id);
        router.replace(`/jam/?id=${id}`);
      })
      .catch(() => setFailed(true));
  }, [token, router]);
  const id = params.get("id");
  if (failed) return <Notice text="This jam has ended" />;
  if (!id) return token ? <Notice text="Joining" /> : <Notice text="No jam" />;
  return <Jam id={id} />;
}

function Notice({ text }: { text: string }) {
  return <p className="grid min-h-[50vh] place-items-center font-display text-xl">{text}</p>;
}

function positionOf(r: TogetherState): number {
  return r.playing ? r.position_at_start_ms + Math.max(0, serverNow() - r.started_at_server_ms) : r.position_at_start_ms;
}

function Jam({ id }: { id: string }) {
  const router = useRouter();
  const me = useMe().data;
  const detail = useJam(id);
  const live = useTogether().data;
  const [view, setView] = useState<"player" | "room">("player");
  const [inviting, setInviting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const room = live?.active && live.session_id === id ? live : detail.data?.room;
  const people = useMemo(() => new Map((detail.data?.people ?? []).map((p) => [p.id, p])), [detail.data]);
  const queueIds = useMemo(() => room?.queue.map((q) => q.track_id) ?? [], [room]);
  const tracks = useTracks(queueIds);
  if (detail.isPending) return <Notice text="Loading" />;
  if (!detail.data || !room) return <Notice text="This jam has ended" />;
  if (!room.active) return <Notice text="This jam has ended" />;
  const jam = detail.data.jam;
  const host = people.get(jam.created_by);
  const inside = !!me && room.members.includes(me.id);
  const isHost = me?.id === jam.created_by;
  const current = room.queue[room.index];
  const track = current ? tracks.get(current.track_id) : undefined;
  const upNext = room.queue.slice(room.index + 1);
  const pos = positionOf(room);
  const person = (uid: string): Pick<Person, "id" | "display_name"> & { avatar?: unknown } =>
    people.get(uid) ?? (uid === me?.id ? { id: uid, display_name: "You" } : { id: uid, display_name: "Someone" });
  const nameOf = (uid: string) => (uid === me?.id ? "You" : person(uid).display_name);
  const canControl = isHost || room.anyone_skip !== false;
  const canAdd = isHost || room.anyone_add !== false;

  const setting = async (patch: { friends_join?: boolean; anyone_add?: boolean; anyone_skip?: boolean }) => {
    try {
      await jamApi.update(id, patch);
      void queryClient.invalidateQueries({ queryKey: jamKey(id) });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not saved");
    }
  };
  const end = async () => {
    try {
      await jamApi.end(id);
      router.push("/friends/?tab=activity");
    } catch {
      toast("Jam not ended");
    }
  };

  return (
    <div className="mx-auto grid max-w-xl gap-5 pb-28">
      <header className="flex items-center gap-1">
        <IconButton label="Close" onClick={() => router.back()}>
          <ChevronDown />
        </IconButton>
        <div className="min-w-0 flex-1 text-center">
          <h1 dir="auto" className="truncate text-[15px] font-extrabold">
            {isHost ? "Your jam" : `${host?.display_name ?? "A"}'s jam`}
          </h1>
          <p className="text-[12.5px] font-bold text-muted">{room.members.length} listening</p>
        </div>
        <Menu>
          <MenuTrigger aria-label="Jam settings" className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
            <span className="text-xl leading-none">···</span>
          </MenuTrigger>
          <MenuContent align="end">
            {detail.data.link_token && (
              <MenuItem
                icon={<Copy />}
                onSelect={() => void navigator.clipboard.writeText(jamLink(detail.data!.link_token!)).then(() => toast("Link copied"), () => toast("Link not copied"))}
              >
                Copy link
              </MenuItem>
            )}
            <MenuItem icon={<UserPlus />} onSelect={() => setInviting(true)}>
              Invite
            </MenuItem>
            {inside && !isHost && (
              <MenuItem icon={<LogOut />} onSelect={() => leaveSession()}>
                Leave
              </MenuItem>
            )}
            {isHost && (
              <MenuItem icon={<Square />} onSelect={() => void end()}>
                End jam
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </header>

      <div className="flex justify-center">
        <Segmented<"player" | "room">
          label="View"
          value={view}
          onChange={setView}
          options={[
            ["player", "Player"],
            ["room", "Room"],
          ]}
        />
      </div>

      {view === "room" ? (
        <section aria-label="Room" className="relative h-[300px] overflow-hidden rounded-[22px] bg-surface-2">
          <RoomView band />
          <div aria-hidden className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(0deg,var(--bg)_0%,transparent_16%)]" />
          <ul className="absolute inset-x-3 bottom-4 z-[3] flex flex-wrap items-end justify-center gap-x-4 gap-y-2">
            {room.members.map((m) => (
              <li key={m} className="grid justify-items-center gap-1">
                <span className="inline-flex h-5 items-center gap-1 rounded-[6px] border border-line-strong bg-over px-1.5 text-[11px] font-extrabold text-over-ink">
                  {m === jam.created_by && <Crown className="size-3 text-accent-strong" />}
                  {nameOf(m)}
                </span>
                <Avatar userId={m} size={64} pose="listening" look={lookOf(m, person(m).avatar)} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
          {room.members.map((m) => (
            <li key={m} className="grid w-[58px] shrink-0 justify-items-center gap-1.5 text-xs font-extrabold text-ink-2">
              <span className="relative">
                <PersonAvatar person={person(m)} size={48} />
                {m === jam.created_by && (
                  <span className="absolute -end-1 -top-1 grid size-5 place-items-center rounded-full bg-accent text-on-accent ring-2 ring-bg">
                    <Crown className="size-3" />
                  </span>
                )}
              </span>
              <span dir="auto" className="w-full truncate text-center">
                {nameOf(m)}
              </span>
            </li>
          ))}
          <li className="grid w-[58px] shrink-0 justify-items-center gap-1.5 text-xs font-extrabold text-muted">
            <button type="button" aria-label="Invite" onClick={() => setInviting(true)} className="grid size-12 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong">
              <Plus className="size-5" />
            </button>
            Invite
          </li>
        </ul>
      )}

      <section className="flex items-center gap-4">
        <Artwork src={track?.artwork_url ?? track?.artwork_thumb_url ?? null} className="size-[132px] shrink-0 rounded-[14px] shadow-soft" />
        <div className="min-w-0 flex-1">
          <h2 dir="auto" className="font-display text-[21px] leading-tight">
            {track?.title ?? ""}
          </h2>
          <p dir="auto" className="mt-0.5 truncate text-sm font-bold text-muted">
            {track?.artists.join(", ") ?? ""}
          </p>
          {current && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink-2">
              <PersonAvatar person={person(current.added_by)} size={20} />
              Added by {nameOf(current.added_by)}
            </p>
          )}
        </div>
      </section>

      <div>
        <div className="h-1 rounded-full bg-line-strong">
          <i className="block h-full rounded-full bg-ink" style={{ width: `${track?.duration_ms ? Math.min(100, (pos / track.duration_ms) * 100) : 0}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs font-bold text-muted tabular-nums">
          <span>{fmtTime(pos / 1000)}</span>
          <span>{track?.duration_ms ? fmtTime(track.duration_ms / 1000) : ""}</span>
        </div>
      </div>

      {inside ? (
        <div className="flex items-center justify-center gap-6">
          <IconButton label="Previous" disabled={!canControl} onClick={previous}>
            <SkipBack className="fill-current" />
          </IconButton>
          <button
            type="button"
            aria-label={room.playing ? "Pause" : "Play"}
            disabled={!canControl}
            onClick={() => (room.playing ? pause() : play())}
            className="grid size-[60px] place-items-center rounded-full bg-ink text-bg disabled:opacity-40"
          >
            {room.playing ? <Pause className="size-6 fill-current" /> : <Play className="ms-0.5 size-6 fill-current" />}
          </button>
          <IconButton label="Next" disabled={!canControl} onClick={next}>
            <SkipForward className="fill-current" />
          </IconButton>
        </div>
      ) : (
        <Button variant="primary" onClick={() => joinSession(id)}>
          <Headphones className="size-5" /> Join
        </Button>
      )}

      <section>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="font-display text-xl">Up next</h2>
          <span className="text-[13px] font-bold text-muted tabular-nums">{upNext.length} songs</span>
        </div>
        <ul>
          {upNext.map((q) => {
            const t = tracks.get(q.track_id);
            return (
              <li key={q.key} className="flex items-center gap-3 py-1.5">
                <Artwork src={t?.artwork_thumb_url ?? t?.artwork_url ?? null} className="size-11 shrink-0 rounded-[8px]" />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[14.5px] font-extrabold">
                    {t?.title ?? ""}
                  </span>
                  <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
                    {t?.artists.join(", ") ?? ""}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-xs font-extrabold text-muted">
                  <PersonAvatar person={person(q.added_by)} size={22} />
                  {nameOf(q.added_by)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {isHost && (
        <section className="grid divide-y divide-line rounded-card border border-line bg-surface px-4">
          <SwitchRow label="Open to friends" checked={jam.friends_join !== false} onChange={(v) => void setting({ friends_join: v })} />
          <SwitchRow label="Anyone can add songs" checked={jam.anyone_add !== false} onChange={(v) => void setting({ anyone_add: v })} />
          <SwitchRow label="Anyone can skip" checked={jam.anyone_skip !== false} onChange={(v) => void setting({ anyone_skip: v })} />
        </section>
      )}

      {inside && (
        <div className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom)+4.75rem)] z-30 mx-auto flex max-w-xl gap-2 px-4 lg:bottom-28 lg:left-[88px]">
          <Button variant="primary" className="flex-1 shadow-soft" disabled={!canAdd} onClick={() => setAdding(true)}>
            <Plus className="size-5" /> Add songs
          </Button>
          <Button className="shadow-soft" onClick={() => setInviting(true)}>
            <UserPlus className="size-5" /> Invite
          </Button>
        </div>
      )}
      {adding && <AddSongsDialog sessionId={id} live open={adding} onOpenChange={setAdding} />}
      {inviting && <InviteSheet id={id} open={inviting} onOpenChange={setInviting} exclude={[...room.members, ...(jam.audience ?? [])]} />}
    </div>
  );
}

function InviteSheet({ id, open, onOpenChange, exclude }: { id: string; open: boolean; onOpenChange: (v: boolean) => void; exclude: string[] }) {
  const me = useMe().data?.id;
  const friends = (useFriends().data?.friends ?? []).map((f) => f.person).filter((p) => !exclude.includes(p.id));
  const groups = (useConversations().data ?? []).filter((c) => c.kind === "group");
  const [picked, setPicked] = useState<string[]>([]);
  const send = async (body: { user_ids?: string[]; conversation_id?: string }) => {
    try {
      await jamApi.invite(id, body);
      toast("Invited");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: jamKey(id) });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not invited");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite">
      <div className="grid gap-4 pt-1">
        {friends.length ? (
          <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
            {friends.map((p) => {
              const on = picked.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked((l) => (on ? l.filter((x) => x !== p.id) : [...l, p.id]))}
                    className="grid w-full justify-items-center gap-1.5 text-center"
                  >
                    <PersonAvatar person={p} size={52} className={cn(on && "ring-[2.5px] ring-accent ring-offset-2 ring-offset-[var(--surface-solid)]")} />
                    <span dir="auto" className="w-full truncate text-xs font-extrabold text-ink-2">
                      {p.display_name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-2 text-center font-semibold text-muted">Every friend is in</p>
        )}
        <Button variant="primary" disabled={!picked.length} onClick={() => void send({ user_ids: picked })}>
          {picked.length ? `Invite ${picked.length}` : "Invite"}
        </Button>
        {groups.length > 0 && (
          <div className="grid gap-2">
            <p className="text-[13.5px] font-extrabold text-muted">Groups</p>
            {groups.map((g) => (
              <button key={g.id} type="button" onClick={() => void send({ conversation_id: g.id })} className="flex items-center gap-3 rounded-[14px] bg-surface-2 p-3 text-start">
                <span dir="auto" className="min-w-0 flex-1 truncate font-extrabold">
                  {conversationName(g, me)}
                </span>
                <span className="text-[13px] font-semibold text-muted">{g.members.length} people</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
