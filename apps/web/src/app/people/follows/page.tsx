"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { FollowButton, PersonRow } from "@/components/friends/people";
import { Button, IconButton, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { afterFollowChange, peopleApi, useFollowList, usePersonProfile } from "@/lib/people";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";

type Tab = "followers" | "following";

export default function FollowsPage() {
  return (
    <Suspense>
      <Follows />
    </Suspense>
  );
}

function Follows() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useMe().data;
  const who = params.get("u") ?? me?.username ?? null;
  const tab: Tab = params.get("tab") === "following" ? "following" : "followers";
  const profile = usePersonProfile(who).data;
  const list = useFollowList(who, tab);
  const mine = !!profile?.person.relation.self;
  const remove = async (id: string) => {
    try {
      await peopleApi.removeFollower(id);
      afterFollowChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not removed");
    }
  };
  return (
    <div className="mx-auto grid max-w-xl gap-4 pb-8">
      <div className="flex items-center gap-2">
        <IconButton label="Back" onClick={() => router.back()}>
          <ArrowLeft />
        </IconButton>
        <h1 dir="auto" className="min-w-0 flex-1 truncate font-display text-[22px]">
          {profile?.person.display_name ?? ""}
        </h1>
      </div>
      <Segmented<Tab>
        label="List"
        value={tab}
        onChange={(t) => router.replace(`/people/follows/?u=${encodeURIComponent(who ?? "")}&tab=${t}`, { scroll: false })}
        options={[
          ["followers", profile ? `Followers ${profile.counts.followers}` : "Followers"],
          ["following", profile ? `Following ${profile.counts.following}` : "Following"],
        ]}
      />
      {list.isError ? (
        <p className="py-6 text-center font-semibold text-muted">Private account</p>
      ) : !list.data ? (
        <p className="py-6 text-center font-semibold text-muted">Loading</p>
      ) : !list.data.length ? (
        <p className="py-6 text-center font-semibold text-muted">No one yet</p>
      ) : (
        <ul>
          {list.data.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              action={
                mine && tab === "followers" && !p.relation.following ? (
                  <span className="flex gap-1.5">
                    <FollowButton person={p} />
                    <Button size="sm" variant="ghost" onClick={() => void remove(p.id)}>
                      Remove
                    </Button>
                  </span>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
