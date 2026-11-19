"use client";

import { ArrowLeft, Headphones, Lock, MessageCircle, Share2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Failed, Loading } from "@/components/common";
import { AvatarStack, FollowButton, PersonAvatar, Tag } from "@/components/friends/people";
import { JamSheet } from "@/components/friends/sheets";
import { Artwork, Cover } from "@/components/media";
import { Button, IconButton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { plural } from "@/lib/format";
import { usePersonProfile, type Profile } from "@/lib/people";
import { useMe } from "@/lib/session";
import { conversationApi } from "@/lib/social";
import { toast } from "@/lib/toast";
import { playTracks } from "@/player/controls";
import { jamAlong } from "@/player/together";

export default function PersonPage() {
  return (
    <Suspense>
      <Person />
    </Suspense>
  );
}

function Person() {
  const params = useSearchParams();
  const me = useMe().data;
  const who = params.get("u") ?? me?.username ?? null;
  const q = usePersonProfile(who);
  const router = useRouter();
  if (q.isPending) return <Loading />;
  if (!q.data) return <Failed what="Profile" />;
  return (
    <div className="mx-auto grid max-w-xl gap-5 pb-8">
      <div className="flex items-center gap-1">
        <IconButton label="Back" onClick={() => router.back()}>
          <ArrowLeft />
        </IconButton>
        <span className="flex-1" />
        <IconButton
          label="Share profile"
          onClick={() => {
            const url = `${location.origin}/people/?u=${encodeURIComponent(q.data.person.username)}`;
            if (navigator.share) void navigator.share({ url }).catch(() => {});
            else void navigator.clipboard.writeText(url).then(() => toast("Link copied"));
          }}
        >
          <Share2 />
        </IconButton>
      </div>
      <Header p={q.data} />
      {q.data.visible ? <Body p={q.data} /> : (
        <div className="grid justify-items-center gap-2 rounded-card border border-line bg-surface p-6 text-center">
          <Lock className="size-6 text-muted" />
          <p className="font-display text-lg">Private account</p>
        </div>
      )}
    </div>
  );
}

function Header({ p }: { p: Profile }) {
  const person = p.person;
  const r = person.relation;
  const router = useRouter();
  const [jam, setJam] = useState(false);
  const message = async () => {
    try {
      const { id } = await conversationApi.open({ user_id: person.id });
      router.push(`/chat/?c=${id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Chat unavailable");
    }
  };
  const base = `/people/follows/?u=${encodeURIComponent(person.username)}`;
  return (
    <section className="grid justify-items-center gap-1 text-center">
      <PersonAvatar person={person} size={104} className="mb-2" />
      <h1 dir="auto" className="font-display text-[28px] leading-tight">
        {person.display_name}
      </h1>
      <p className="font-bold text-muted">@{person.username}</p>
      <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
        {r.partner ? <Tag>Partner</Tag> : r.friend ? <Tag>Friend</Tag> : r.follows_you ? <Tag quiet>Follows you</Tag> : null}
        {person.private && <Tag quiet>Private</Tag>}
      </div>
      <div className="mt-3.5 flex justify-center divide-x divide-line-strong">
        <Link href={`${base}&tab=followers`} className="grid justify-items-center px-5">
          <b className="text-lg font-extrabold tabular-nums">{p.counts.followers}</b>
          <span className="text-[12.5px] font-bold text-muted">Followers</span>
        </Link>
        <Link href={`${base}&tab=following`} className="grid justify-items-center px-5">
          <b className="text-lg font-extrabold tabular-nums">{p.counts.following}</b>
          <span className="text-[12.5px] font-bold text-muted">Following</span>
        </Link>
        <span className="grid justify-items-center px-5">
          <b className="text-lg font-extrabold tabular-nums">{p.counts.playlists}</b>
          <span className="text-[12.5px] font-bold text-muted">Playlists</span>
        </span>
      </div>
      {r.self ? (
        <div className="mt-4 grid w-full grid-cols-2 gap-2">
          <Link href="/profile/" className="inline-flex min-h-11 items-center justify-center rounded-[12px] border border-line bg-surface-2 px-4 font-extrabold">
            Edit profile
          </Link>
          <Link href="/friends/?tab=people" className="inline-flex min-h-11 items-center justify-center rounded-[12px] border border-line bg-surface-2 px-4 font-extrabold">
            Find people
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2">
          <FollowButton person={person} size="md" />
          <Button onClick={() => void message()}>
            <MessageCircle className="size-4" /> Message
          </Button>
          <IconButton label="Invite to a jam" className="border border-line bg-surface-2" disabled={!r.friend} onClick={() => setJam(true)}>
            <Headphones />
          </IconButton>
        </div>
      )}
      {jam && <JamSheet open={jam} onOpenChange={setJam} invite={[person.id]} />}
    </section>
  );
}

function Body({ p }: { p: Profile }) {
  const person = p.person;
  const playing = p.playing;
  const listenAlong = async () => {
    if (!playing) return;
    try {
      await jamAlong(person.id, playing.track_id, playing.position_ms + Math.max(0, Date.now() - Date.parse(playing.at)));
      toast(`Jam started with ${person.display_name}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Jam not started");
    }
  };
  return (
    <div className="grid gap-6">
      {playing && (
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
          <Artwork src={playing.artwork_thumb_url} className="size-[52px] shrink-0 rounded-[9px]" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-extrabold text-[var(--online-text,#17784a)] dark:text-[#8fe0b0]">Listening now</span>
            <span dir="auto" className="block truncate font-extrabold">
              {playing.title}
            </span>
            <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
              {playing.artists.join(", ")}
            </span>
          </span>
          {!person.relation.self && person.relation.friend && (
            <Button size="sm" variant="primary" onClick={() => void listenAlong()}>
              Listen along
            </Button>
          )}
        </div>
      )}
      {!!p.mutual?.length && (
        <p className="flex items-center gap-2.5 text-[13px] font-bold text-muted">
          <AvatarStack people={p.mutual} size={26} />
          <span dir="auto" className="min-w-0 truncate">
            {p.mutual.length <= 3 ? p.mutual.map((m) => m.display_name).join(", ") : `${p.mutual.slice(0, 2).map((m) => m.display_name).join(", ")} and ${p.mutual.length - 2} more`}
          </span>
        </p>
      )}
      {!!p.top?.length && (
        <section>
          <h2 className="mb-1 font-display text-xl">Top songs this month</h2>
          <ol>
            {p.top.map((t, i) => (
              <li key={t.id}>
                <button type="button" onClick={() => playTracks(p.top!, i, { type: "queue", name: `${person.display_name}'s top songs` })} className="flex w-full items-center gap-3 py-1.5 text-start">
                  <span className="w-5 shrink-0 text-center text-[13px] font-extrabold text-muted tabular-nums">{i + 1}</span>
                  <Artwork src={t.artwork_thumb_url ?? t.artwork_url} className="size-[46px] shrink-0 rounded-[8px]" />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-[14.5px] font-extrabold">
                      {t.title}
                    </span>
                    <span dir="auto" className="block truncate text-[13px] font-semibold text-muted">
                      {t.artists.join(", ")}
                    </span>
                  </span>
                  <span className="text-[12.5px] font-semibold text-muted tabular-nums">{plural(t.plays, "play")}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      {!!p.playlists?.length && (
        <section>
          <h2 className="mb-3 font-display text-xl">Playlists</h2>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
            {p.playlists.map((pl) => (
              <li key={pl.id}>
                <Link href={`/playlist/?id=${pl.id}`} className="grid gap-2">
                  <Cover cover={pl.cover_url} collage={pl.collage} alt="" className="aspect-square w-full rounded-[12px]" />
                  <span>
                    <span dir="auto" className="block truncate text-sm font-extrabold">
                      {pl.name}
                    </span>
                    <span className="block text-[12.5px] font-semibold text-muted">{plural(pl.counts.total, "song")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
