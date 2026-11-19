"use client";

import { Headphones, Lock, Pin, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar, lookOf } from "@/avatar";
import { Artwork } from "@/components/media";
import { Button, RowLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  afterFollowChange, ago, followLabel, peopleApi, useFriends,
  type FriendActivity, type JamSummary, type Person,
} from "@/lib/people";
import { useMe } from "@/lib/session";
import { conversationName, type ChatMessage, type Conversation } from "@/lib/social";
import { toast } from "@/lib/toast";
import { joinSession } from "@/player/together";

type Who = Pick<Person, "id"> & { avatar?: unknown };

export function PersonAvatar({ person, size, ring, className }: { person: Who; size: number; ring?: "live" | "jam"; className?: string }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2",
        ring === "live" && "ring-[2.5px] ring-sage ring-offset-2 ring-offset-bg",
        ring === "jam" && "ring-[2.5px] ring-accent ring-offset-2 ring-offset-bg",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Avatar userId={person.id} size={Math.round(size * 0.86)} look={lookOf(person.id, person.avatar)} />
    </span>
  );
}

export function AvatarStack({ people, size = 28 }: { people: Who[]; size?: number }) {
  return (
    <span className="flex items-center">
      {people.slice(0, 3).map((p, i) => (
        <PersonAvatar key={p.id} person={p} size={size} className={cn(i > 0 && "-ms-2.5", "ring-2 ring-bg")} />
      ))}
    </span>
  );
}

export function GroupAvatar({ people, size }: { people: Who[]; size: number }) {
  const one = Math.round(size * 0.7);
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size }}>
      {people[0] && <PersonAvatar person={people[0]} size={one} className="absolute start-0 top-0" />}
      {people[1] && <PersonAvatar person={people[1]} size={one} className="absolute bottom-0 end-0 ring-[2.5px] ring-bg" />}
    </span>
  );
}

export function FollowButton({ person, size = "sm", className }: { person: Person; size?: "sm" | "md"; className?: string }) {
  const [busy, setBusy] = useState(false);
  const r = person.relation;
  if (r.self) return null;
  const following = r.following || r.requested;
  const run = async () => {
    setBusy(true);
    try {
      if (following) await peopleApi.unfollow(person.id);
      else {
        const { status } = await peopleApi.follow(person.id);
        if (status === "requested") toast("Request sent");
      }
      afterFollowChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant={following ? "soft" : "primary"} disabled={busy} onClick={() => void run()} className={className}>
      {followLabel(r)}
    </Button>
  );
}

export function PersonRow({ person, note, action }: { person: Person; note?: string; action?: React.ReactNode }) {
  return (
    <li className="-mx-2 rounded-[14px] px-2 transition-colors hover:bg-surface-2/50 flex items-center gap-3 py-2">
      <Link href={`/people/?u=${encodeURIComponent(person.username)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <PersonAvatar person={person} size={48} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span dir="auto" className="truncate text-[15px] font-extrabold">
              {person.display_name}
            </span>
            {person.relation.partner ? <Tag>Partner</Tag> : person.relation.friend && action ? <Tag>Friend</Tag> : null}
            {person.private && !person.relation.self && <Lock aria-label="Private" className="size-3.5 shrink-0 text-muted" />}
          </span>
          <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
            {note ?? person.note ?? `@${person.username}`}
          </span>
        </span>
      </Link>
      {action ?? <FollowButton person={person} />}
    </li>
  );
}

export function Tag({ children, quiet }: { children: React.ReactNode; quiet?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-[6px] px-1.5 text-[11.5px] font-extrabold",
        quiet ? "bg-surface-2 text-ink-2" : "bg-sage/15 text-[var(--online-text,#17784a)] dark:text-[#8fe0b0]",
      )}
    >
      {children}
    </span>
  );
}

export function Eq({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-2.5 items-end gap-[1.5px]", className)}>
      <i className="block h-1.5 w-[2.5px] rounded-[1px] bg-sage" />
      <i className="block h-2.5 w-[2.5px] rounded-[1px] bg-sage" />
      <i className="block h-1 w-[2.5px] rounded-[1px] bg-sage" />
    </span>
  );
}

function friendLine(f: FriendActivity): string {
  if (f.playing) return f.playing.title;
  if (f.last) return ago(f.last.at);
  return "";
}

export function FriendStrip({ className }: { className?: string }) {
  const data = useFriends().data;
  const friends = data?.friends ?? [];
  if (!data) return null;
  if (!friends.length) {
    return <RowLink href="/friends/?tab=people" icon={<UserPlus />} title="Find friends" className={className} />;
  }
  return (
    <ul className={cn("-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 pt-1.5 [scrollbar-width:none] lg:mx-0 lg:px-0", className)}>
      {friends.map((f) => {
        const jam = !!f.jam_id;
        return (
          <li key={f.person.id} className="w-[70px] shrink-0">
            <Link href={jam ? `/jam/?id=${f.jam_id}` : `/people/?u=${encodeURIComponent(f.person.username)}`} className="grid justify-items-center gap-1 text-center">
              <span className="relative mb-1.5">
                <PersonAvatar person={f.person} size={60} ring={jam ? "jam" : f.playing ? "live" : undefined} />
                {jam ? (
                  <span className="absolute -bottom-2 left-1/2 inline-flex h-5 -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[10px] bg-accent px-1.5 text-[11px] font-extrabold text-on-accent ring-2 ring-bg">
                    <Headphones className="size-3" /> Jam
                  </span>
                ) : f.playing ? (
                  <span className="absolute -bottom-0.5 -end-1 grid size-6 place-items-center rounded-full bg-surface-2 ring-2 ring-bg">
                    <Eq />
                  </span>
                ) : null}
              </span>
              <span dir="auto" className="w-full truncate text-[13px] font-extrabold">
                {f.person.display_name}
              </span>
              <span dir="auto" className="w-full truncate text-[11.5px] font-bold text-muted">
                {friendLine(f)}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function JamCard({ jam, people }: { jam: JamSummary; people: Who[] }) {
  const t = jam.track;
  return (
    <div className="grid gap-3 rounded-card border border-line bg-surface p-3.5">
      <Link href={`/jam/?id=${jam.id}`} className="flex items-center gap-3">
        <Artwork src={t?.artwork_thumb_url ?? t?.artwork_url ?? null} className="size-14 shrink-0 rounded-[10px]" />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-base font-extrabold">
            {jam.host.display_name}&apos;s jam
          </span>
          {t && (
            <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
              {t.title} · {t.artists.join(", ")}
            </span>
          )}
        </span>
        <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-xs font-extrabold text-accent-strong">
          <span className="size-[7px] rounded-full bg-accent" /> Live
        </span>
      </Link>
      <div className="flex items-center gap-2.5">
        <AvatarStack people={people} />
        <span className="flex-1 text-[13px] font-bold text-muted">{jam.members.length} listening</span>
        <Link
          href={`/jam/?id=${jam.id}`}
          onClick={() => !jam.joined && joinSession(jam.id)}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-[12px] px-3 text-sm font-extrabold",
            jam.joined ? "border border-line bg-surface-2 text-ink" : "bg-accent text-on-accent",
          )}
        >
          {jam.joined ? "Open" : (
            <>
              <Headphones className="size-4" /> Join
            </>
          )}
        </Link>
      </div>
    </div>
  );
}

export function ActivityList() {
  const q = useFriends();
  const data = q.data;
  if (!data) return <p className="py-6 text-center font-semibold text-muted">{q.isError ? "Activity unavailable" : "Loading"}</p>;
  const byId = new Map(data.friends.map((f) => [f.person.id, f.person]));
  const now = data.friends.filter((f) => f.playing);
  const earlier = data.friends.filter((f) => !f.playing && f.last);
  return (
    <div className="grid gap-6">
      {data.jams.length > 0 && (
        <section className="grid gap-2.5">
          <h2 className="font-display text-xl">Jams</h2>
          {data.jams.map((j) => (
            <JamCard key={j.id} jam={j} people={[j.host, ...j.members.filter((m) => m !== j.host.id).map((m) => byId.get(m) ?? { id: m })]} />
          ))}
        </section>
      )}
      {now.length > 0 && (
        <section>
          <h2 className="mb-1 font-display text-xl">Listening now</h2>
          <ul>
            {now.map((f) => (
              <ActivityRow key={f.person.id} f={f} />
            ))}
          </ul>
        </section>
      )}
      {earlier.length > 0 && (
        <section>
          <h2 className="mb-1 font-display text-xl">Earlier</h2>
          <ul>
            {earlier.map((f) => (
              <ActivityRow key={f.person.id} f={f} />
            ))}
          </ul>
        </section>
      )}
      {!data.jams.length && !now.length && !earlier.length && <p className="py-6 text-center font-semibold text-muted">No activity today</p>}
    </div>
  );
}

function ActivityRow({ f }: { f: FriendActivity }) {
  const t = f.playing ?? (f.last ? { title: f.last.track.title, artists: f.last.track.artists, artwork_thumb_url: f.last.track.artwork_thumb_url } : null);
  return (
    <li>
      <Link href={`/people/?u=${encodeURIComponent(f.person.username)}`} className="-mx-2 rounded-[14px] px-2 transition-colors hover:bg-surface-2/50 flex items-center gap-3 py-2">
        <span className="relative">
          <PersonAvatar person={f.person} size={48} />
          {f.online && <span className="absolute bottom-0 end-0 size-3 rounded-full bg-sage ring-[2.5px] ring-bg" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[15px] font-extrabold">
            <span dir="auto" className="truncate">
              {f.person.display_name}
            </span>
            {f.person.relation.partner && <Tag>Partner</Tag>}
            {!f.playing && f.last && <span className="text-xs font-bold text-muted">{ago(f.last.at)}</span>}
          </span>
          {t && (
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
              {f.playing && <Eq />}
              <span dir="auto" className="truncate">
                {t.title} · {t.artists.join(", ")}
              </span>
            </span>
          )}
        </span>
        {t && <Artwork src={t.artwork_thumb_url ?? null} className="size-11 shrink-0 rounded-[8px]" />}
      </Link>
    </li>
  );
}

function lastLine(m: ChatMessage | undefined, me: string | undefined, c: Conversation): string {
  if (!m) return "";
  const who = c.kind === "group" && m.sender_id !== me ? `${c.members.find((x) => x.id === m.sender_id)?.display_name ?? "Someone"}: ` : "";
  const mine = m.sender_id === me ? "You: " : "";
  const text =
    m.deleted ? "Deleted message"
    : m.kind === "song" || m.kind === "swap" ? `${m.data?.track?.title ?? "Song"}${m.data?.track ? ` · ${m.data.track.artists.join(", ")}` : ""}`
    : m.kind === "lyric" ? "Lyrics"
    : m.kind === "voice" ? "Voice note"
    : m.kind === "photo" ? m.body || "Photo"
    : m.kind === "sticker" ? "Sticker"
    : m.kind === "session" ? m.body
    : m.body;
  return `${mine || who}${text}`;
}

function listTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 2) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationRow({ c }: { c: Conversation }) {
  const me = useMe().data?.id;
  const others = c.members.filter((m) => m.id !== me);
  const name = conversationName(c, me);
  const unread = c.unread > 0;
  return (
    <li>
      <Link href={`/chat/?c=${c.id}`} className="-mx-2 rounded-[14px] px-2 transition-colors hover:bg-surface-2/50 flex items-center gap-3 py-2.5">
        {c.kind === "group" ? (
          <GroupAvatar people={others} size={52} />
        ) : (
          others[0] && <PersonAvatar person={others[0]} size={52} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[15.5px] font-extrabold">
            <span dir="auto" className="truncate">
              {name}
            </span>
            {c.partner && <Pin aria-label="Partner" className="size-3.5 shrink-0 text-muted" />}
          </span>
          <span dir="auto" className={cn("block truncate text-[13.5px]", unread ? "font-bold text-ink" : "font-semibold text-muted")}>
            {lastLine(c.last, me, c) || (c.kind === "group" ? `${c.members.length} people` : "")}
          </span>
        </span>
        <span className="grid shrink-0 justify-items-end gap-1.5 text-xs font-bold text-muted tabular-nums">
          <span>{listTime(c.last?.created_at ?? c.last_message_at ?? c.created_at)}</span>
          {unread && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11.5px] font-extrabold text-on-accent">{c.unread}</span>
          )}
        </span>
      </Link>
    </li>
  );
}
