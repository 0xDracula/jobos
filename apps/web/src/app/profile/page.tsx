"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useMemo } from "react";

import { Loading } from "@/components/common";
import { PersonBadge } from "@/components/PersonBadge";
import { Empty } from "@/components/ui";
import { FAVORITE_CATEGORIES, useFavoriteLists, useStars } from "@/lib/gift";
import { useMe, useMembers } from "@/lib/session";
import { usePresence } from "@/lib/social";

function lastSeen(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
    <div className="mx-auto grid max-w-2xl gap-6">
      <header className="flex items-center gap-4">
        <PersonBadge userId={user.id} className="size-20 text-3xl" />
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-semibold leading-tight">{user.display_name}</h1>
          <p className="font-semibold text-muted">
            {user.id === me?.id ? "You" : status}
            {person?.quiet ? " · Quiet mode" : ""}
          </p>
        </div>
      </header>
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {shared.map(([label, n]) => (
          <div key={label} className="rounded-card bg-surface-solid/60 p-3 shadow-soft">
            <div className="text-xs font-extrabold uppercase tracking-wide text-muted">{label}</div>
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
