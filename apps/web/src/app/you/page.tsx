"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Globe, Heart, Lock, Settings, Shield } from "lucide-react";
import Link from "next/link";

import { PersonAvatar, Tag } from "@/components/friends/people";
import { Cover } from "@/components/media";
import { PixelIcon } from "@/components/pixel/PixelIcon";
import { MoodChip } from "@/components/profile/Mood";
import { PageHero } from "@/components/sky/PageHero";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { api } from "@/lib/api";
import { plural } from "@/lib/format";
import { usePair } from "@/lib/pair";
import { peopleApi, usePersonProfile, usePrivacy, VISIBILITY_LABELS, type PlaylistVisibility } from "@/lib/people";
import { useProfile } from "@/lib/profiles";
import { keys, queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";

const ROWS = [
  { href: "/stats/", icon: "stats", label: "Stats" },
  { href: "/recaps/", icon: "recap", label: "Recaps" },
] as const;

export default function YouPage() {
  const me = useMe().data;
  const mood = useProfile(me?.id)?.mood;
  const profile = usePersonProfile(me?.username ?? null).data;
  const privacy = usePrivacy().data;
  const partner = usePair().data?.pair?.partner ?? null;
  const playlists = useQuery({ queryKey: keys.playlists, queryFn: async () => (await api.playlists()).playlists, staleTime: 60_000 }).data ?? [];
  const mine = playlists.filter((p) => p.owner_id === me?.id);
  const setVisibility = async (id: string, v: PlaylistVisibility) => {
    try {
      await peopleApi.playlistVisibility(id, v);
      void queryClient.invalidateQueries({ queryKey: keys.playlists });
    } catch {
      toast("Not saved");
    }
  };
  const base = me ? `/people/follows/?u=${encodeURIComponent(me.username)}` : "";
  return (
    <>
      <PageHero
        title="You"
        actions={
          <Link href="/settings/" aria-label="Settings" className="grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-surface-2">
            <Settings className="size-[22px]" />
          </Link>
        }
      />
      <div className="grid max-w-xl gap-5">
        {me && (
          <section className="grid justify-items-center gap-1 rounded-card border border-line bg-surface p-5 text-center">
            <Link href={`/people/?u=${encodeURIComponent(me.username)}`}>
              <PersonAvatar person={me} size={88} className="mb-1.5" />
            </Link>
            <h2 dir="auto" className="font-display text-2xl leading-tight">
              {me.display_name}
            </h2>
            <p className="font-bold text-muted">@{me.username}</p>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5">
              {mood && <MoodChip mood={mood} />}
              {privacy && (
                <Tag quiet>
                  {privacy.private ? <Lock className="me-1 size-3" /> : <Globe className="me-1 size-3" />}
                  {privacy.private ? "Private" : "Public"}
                </Tag>
              )}
            </div>
            {profile && (
              <div className="mt-3 flex justify-center divide-x divide-line-strong">
                <Link href={`${base}&tab=followers`} className="grid justify-items-center px-5">
                  <b className="text-lg font-extrabold tabular-nums">{profile.counts.followers}</b>
                  <span className="text-[12.5px] font-bold text-muted">Followers</span>
                </Link>
                <Link href={`${base}&tab=following`} className="grid justify-items-center px-5">
                  <b className="text-lg font-extrabold tabular-nums">{profile.counts.following}</b>
                  <span className="text-[12.5px] font-bold text-muted">Following</span>
                </Link>
                <Link href="/friends/?tab=people" className="grid justify-items-center px-5">
                  <b className="text-lg font-extrabold tabular-nums">{profile.counts.friends}</b>
                  <span className="text-[12.5px] font-bold text-muted">Friends</span>
                </Link>
              </div>
            )}
            <div className="mt-4 grid w-full grid-cols-2 gap-2">
              <Link href="/profile/" className="inline-flex min-h-11 items-center justify-center rounded-[12px] border border-line bg-surface-2 px-4 font-extrabold">
                Edit profile
              </Link>
              <Link href="/friends/?tab=people" className="inline-flex min-h-11 items-center justify-center rounded-[12px] border border-line bg-surface-2 px-4 font-extrabold">
                Find people
              </Link>
            </div>
          </section>
        )}
        {partner ? (
          <Link href="/us/" className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong">
            <PersonAvatar person={partner} size={44} />
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate font-extrabold">
                {partner.display_name}
              </span>
              <span className="block text-[13px] font-semibold text-muted">Partner</span>
            </span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
        ) : (
          <Link href="/link/" className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong">
            <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-strong">
              <Heart className="size-[22px]" />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-extrabold">Link a partner</span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
        )}
        {mine.length > 0 && (
          <section>
            <h2 className="mb-1 font-display text-xl">Your playlists</h2>
            <ul>
              {mine.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-1.5">
                  <Link href={`/playlist/?id=${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Cover cover={p.cover_url} collage={p.collage} alt="" className="size-[52px] shrink-0 rounded-[8px]" />
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate font-extrabold">
                        {p.name}
                      </span>
                      <span className="block text-[13px] font-semibold text-muted">{plural(p.counts.total, "song")}</span>
                    </span>
                  </Link>
                  <Menu>
                    <MenuTrigger className="inline-flex h-9 items-center gap-1 rounded-[10px] bg-surface-2 px-2.5 text-[12.5px] font-extrabold text-ink-2">
                      {VISIBILITY_LABELS[p.visibility ?? "private"]}
                    </MenuTrigger>
                    <MenuContent align="end">
                      {(Object.keys(VISIBILITY_LABELS) as PlaylistVisibility[]).map((v) => (
                        <MenuItem key={v} onSelect={() => void setVisibility(p.id, v)}>
                          {VISIBILITY_LABELS[v]}
                        </MenuItem>
                      ))}
                    </MenuContent>
                  </Menu>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Link href="/settings/privacy/" className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong">
          <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-strong">
            <Shield className="size-[22px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold">Privacy</span>
            {privacy && (
              <span className="block text-[13px] font-semibold text-muted">
                {privacy.private ? "Private" : "Public"} · activity for {privacy.activity_audience === "none" ? "no one" : privacy.activity_audience}
              </span>
            )}
          </span>
          <ChevronRight className="size-5 text-muted" />
        </Link>
        <ul className="grid grid-cols-2 gap-2.5">
          {ROWS.map((r) => (
            <li key={r.href}>
              <Link
                href={r.href}
                className="grid min-h-[100px] content-start justify-items-center gap-2 rounded-card border border-line bg-surface px-1 pb-2.5 pt-3.5 text-center text-[12.5px] font-bold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
              >
                <PixelIcon name={r.icon} size={36} />
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
