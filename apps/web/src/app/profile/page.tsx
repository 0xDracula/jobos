"use client";

import { Pencil, Play } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Loading } from "@/components/common";
import { Avatar } from "@/avatar";
import { Dialog } from "@/components/dialogs";
import { SongPicker, SongRow } from "@/components/letters/SongPicker";
import { MoodChip, MoodPicker, MoodReply } from "@/components/profile/Mood";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, inputClass } from "@/components/ui";
import { FAVORITE_CATEGORIES, useFavoriteLists, useStars } from "@/lib/gift";
import { profileKeys, profilesApi, useProfile, type Profile } from "@/lib/profiles";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { usePresence } from "@/lib/social";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

function lastSeen(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const panel = "rounded-card bg-surface-solid/60 p-4 shadow-soft";

function EditProfile({ profile, open, onOpenChange }: { profile: Profile | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [nickname, setNickname] = useState("");
  const [track, setTrack] = useState<Track | null>(null);
  const [obsession, setObsession] = useState("");
  useEffect(() => {
    if (!open) return;
    setNickname(profile?.nickname ?? "");
    setTrack(profile?.favorite_track ?? null);
    setObsession(profile?.obsession ?? "");
  }, [open, profile]);
  const save = async () => {
    try {
      await profilesApi.setProfile({ nickname: nickname.trim(), favorite_track_id: track?.id ?? null, obsession: obsession.trim() });
      void queryClient.invalidateQueries({ queryKey: profileKeys.profiles });
      onOpenChange(false);
    } catch {
      toast("Profile not saved");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Profile">
      <div className="grid gap-4">
        <Field label="Nickname">
          <input dir="auto" value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Favorite song">
          <SongPicker value={track} onChange={setTrack} label="Favorite song" />
        </Field>
        <Field label="Current obsession">
          <input dir="auto" value={obsession} maxLength={200} onChange={(e) => setObsession(e.target.value)} className={inputClass} />
        </Field>
        <Button variant="primary" onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function Profile() {
  const id = useSearchParams().get("id");
  const me = useMe().data;
  const members = useMembers();
  const presence = usePresence().data;
  const stars = useStars().data;
  const favorites = useFavoriteLists().data;
  const userId = id ?? me?.id ?? "";
  const user = members.data?.find((u) => u.id === userId);
  const person = presence?.people.find((p) => p.id === userId);
  const profile = useProfile(userId);
  const [editing, setEditing] = useState(false);
  const [moodOpen, setMoodOpen] = useState(false);
  const own = userId === me?.id;
  const shared = useMemo(() => {
    const mine = (stars ?? []).filter((s) => s.user_id === userId);
    const count = (kind: string) => mine.filter((s) => s.kind === kind).length;
    return [
      ["Songs sent", count("card")],
      ["Dedications", count("dedication")],
      ["Mixtape songs", count("mixtape")],
      ["Song swaps", count("swap")],
      ["Song notes", count("note")],
    ] as const;
  }, [stars, userId]);
  if (members.isLoading) return <Loading />;
  if (!user) return <Empty>Not found</Empty>;
  const list = favorites?.find((l) => l.user_id === userId);
  const status = person?.online ? (person.listening ? "Listening" : "Online") : person?.last_seen ? `Last seen ${lastSeen(person.last_seen)}` : "";
  return (
    <div className="grid gap-8">
      <PageHero
        title={user.display_name}
        meta={[profile?.nickname ? `“${profile.nickname}”` : "", own ? "You" : status, person?.quiet ? "Quiet mode" : ""].filter(Boolean).join(" · ")}
        actions={<Avatar userId={user.id} size={96} pose={person?.listening ? "listening" : "idle"} className="-my-2" />}
      />
      <section className={panel}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Mood</h2>
          {own && profile?.mood && !moodOpen && (
            <Button size="sm" variant="ghost" onClick={() => setMoodOpen(true)}>
              Change
            </Button>
          )}
        </div>
        {own && (moodOpen || !profile?.mood) ? (
          <MoodPicker current={profile?.mood} onDone={() => setMoodOpen(false)} />
        ) : profile?.mood ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <MoodChip mood={profile.mood} note className="text-lg font-bold" />
            {!own && <MoodReply mood={profile.mood} name={user.display_name} />}
          </div>
        ) : (
          <p className="font-semibold text-muted">No mood set</p>
        )}
      </section>
      <section className={panel}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Now</h2>
          {own && (
            <IconButton label="Edit profile" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
            </IconButton>
          )}
        </div>
        <div className="grid gap-3">
          <div>
            <p className="text-xs font-extrabold text-muted">Favorite song</p>
            {profile?.favorite_track ? (
              <SongRow track={profile.favorite_track}>
                <IconButton label={`Play ${profile.favorite_track.title}`} onClick={() => playTracks([profile.favorite_track!], 0, { type: "queue", name: "Favorite song" })}>
                  <Play />
                </IconButton>
              </SongRow>
            ) : (
              <p className="font-semibold text-muted">None yet</p>
            )}
          </div>
          <div>
            <p className="text-xs font-extrabold text-muted">Current obsession</p>
            <p dir="auto" className="font-semibold">
              {profile?.obsession || <span className="text-muted">None yet</span>}
            </p>
          </div>
        </div>
      </section>
      {own && <EditProfile profile={profile} open={editing} onOpenChange={setEditing} />}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shared.map(([label, n]) => (
          <div key={label} className="rounded-card bg-surface-solid/60 p-3 shadow-soft">
            <div className="text-xs font-extrabold text-muted">{label}</div>
            <div className="tabular font-display text-2xl font-semibold">{n}</div>
          </div>
        ))}
      </section>
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-xl font-semibold">Favorite things</h2>
          <Link href={`/favorites/?id=${user.id}`} className="text-sm font-bold text-accent-strong">
            All
          </Link>
        </div>
        {list && FAVORITE_CATEGORIES.some((c) => list.items[c]?.length) ? (
          <ul className="flex flex-wrap gap-2">
            {FAVORITE_CATEGORIES.flatMap((c) => (list.items[c] ?? []).slice(0, 3).map((it) => (
              <li key={`${c}-${it}`} dir="auto" className="rounded-full bg-accent-soft/70 px-3.5 py-1.5 text-sm font-bold">
                {it}
              </li>
            )))}
          </ul>
        ) : (
          <Empty>Nothing yet</Empty>
        )}
      </section>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Profile />
    </Suspense>
  );
}
