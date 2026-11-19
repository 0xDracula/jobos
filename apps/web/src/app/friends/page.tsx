"use client";

import { ChevronDown, Inbox, Search, SquarePen, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { useDebounced } from "@/components/common";
import { ActivityList, ConversationRow, FriendStrip, PersonRow } from "@/components/friends/people";
import { NewChatSheet } from "@/components/friends/sheets";
import { PageHero } from "@/components/sky/PageHero";
import { Button, IconButton, inputClass, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { afterFollowChange, peopleApi, useFollowRequests, useFriends, usePeopleSearch, useSuggested } from "@/lib/people";
import { queryClient } from "@/lib/queries";
import { conversationApi, socialKeys, useConversations } from "@/lib/social";
import { toast } from "@/lib/toast";

type Tab = "chats" | "activity" | "people";

export default function FriendsPage() {
  return (
    <Suspense>
      <Friends />
    </Suspense>
  );
}

function Friends() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (["chats", "activity", "people"].includes(params.get("tab") ?? "") ? params.get("tab") : "chats") as Tab;
  const [newChat, setNewChat] = useState(false);
  const setTab = (t: Tab) => router.replace(t === "chats" ? "/friends/" : `/friends/?tab=${t}`, { scroll: false });
  return (
    <>
      <PageHero
        title="Friends"
        actions={
          <div className="flex gap-1">
            <IconButton label="Find people" onClick={() => setTab("people")}>
              <UserPlus />
            </IconButton>
            <IconButton label="New chat" onClick={() => setNewChat(true)}>
              <SquarePen />
            </IconButton>
          </div>
        }
      />
      <div className="grid max-w-2xl gap-5">
        <FriendStrip />
        <div>
          <Segmented<Tab>
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              ["chats", "Chats"],
              ["activity", "Activity"],
              ["people", "People"],
            ]}
          />
        </div>
        {tab === "chats" && <Chats onNew={() => setNewChat(true)} />}
        {tab === "activity" && <ActivityList />}
        {tab === "people" && <People />}
      </div>
      <NewChatSheet open={newChat} onOpenChange={setNewChat} />
    </>
  );
}

function Chats({ onNew }: { onNew: () => void }) {
  const q = useConversations();
  const [showRequests, setShowRequests] = useState(false);
  if (!q.data) return <p className="py-6 text-center font-semibold text-muted">{q.isError ? "Chats unavailable" : "Loading"}</p>;
  const chats = q.data.filter((c) => c.accepted);
  const requests = q.data.filter((c) => !c.accepted);
  const answer = async (id: string, accept: boolean) => {
    try {
      await (accept ? conversationApi.accept(id) : conversationApi.remove(id));
      void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not saved");
    }
  };
  return (
    <div className="grid gap-2">
      {chats.length ? (
        <ul>
          {chats.map((c) => (
            <ConversationRow key={c.id} c={c} />
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-3 py-8 text-center">
          <p className="font-display text-lg">No chats yet</p>
          <Button variant="primary" onClick={onNew}>
            <SquarePen className="size-4" /> New chat
          </Button>
        </div>
      )}
      {requests.length > 0 && (
        <div className="rounded-card border border-line bg-surface px-3">
          <button type="button" onClick={() => setShowRequests((v) => !v)} className="flex min-h-14 w-full items-center gap-3 text-start">
            <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted">
              <Inbox className="size-5" />
            </span>
            <span className="flex-1 font-extrabold">Message requests</span>
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-surface-3 px-1.5 text-[11.5px] font-extrabold">{requests.length}</span>
            <ChevronDown className={`size-5 text-muted transition-transform ${showRequests ? "rotate-180" : ""}`} />
          </button>
          {showRequests && (
            <ul className="border-t border-line">
              {requests.map((c) => (
                <li key={c.id} className="grid gap-1 py-1">
                  <ul>
                    <ConversationRow c={c} />
                  </ul>
                  <div className="flex gap-2 pb-2">
                    <Button size="sm" variant="primary" onClick={() => void answer(c.id, true)}>
                      Accept
                    </Button>
                    <Button size="sm" onClick={() => void answer(c.id, false)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function People() {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const results = usePeopleSearch(term);
  const requests = useFollowRequests().data ?? [];
  const friends = useFriends().data?.friends ?? [];
  const suggested = useSuggested().data ?? [];
  const answer = async (id: string, accept: boolean) => {
    try {
      await (accept ? peopleApi.accept(id) : peopleApi.removeFollower(id));
      afterFollowChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not saved");
    }
  };
  return (
    <div className="grid gap-6">
      <label className="relative block">
        <span className="sr-only">Search people</span>
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or username" className={`${inputClass} ps-10`} dir="auto" />
      </label>
      {term ? (
        <section>
          {results.data?.length ? (
            <ul>
              {results.data.map((p) => (
                <PersonRow key={p.id} person={p} />
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center font-semibold text-muted">{results.isFetching ? "Searching" : "No one found"}</p>
          )}
        </section>
      ) : (
        <>
          {requests.length > 0 && (
            <section>
              <h2 className="mb-1 font-display text-xl">Requests</h2>
              <ul>
                {requests.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    action={
                      <span className="flex gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => void answer(p.id, true)}>
                          Accept
                        </Button>
                        <Button size="sm" onClick={() => void answer(p.id, false)}>
                          Decline
                        </Button>
                      </span>
                    }
                  />
                ))}
              </ul>
            </section>
          )}
          {friends.length > 0 && (
            <section>
              <h2 className="mb-1 font-display text-xl">Friends · {friends.length}</h2>
              <ul>
                {friends.map((f) => (
                  <PersonRow key={f.person.id} person={f.person} />
                ))}
              </ul>
            </section>
          )}
          {suggested.length > 0 && (
            <section>
              <h2 className="mb-1 font-display text-xl">Suggested</h2>
              <ul>
                {suggested.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </ul>
            </section>
          )}
          <Link href="/link/" className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-line-strong">
            <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent-strong">
              <UserPlus className="size-[22px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-extrabold">Invite someone</span>
              <span className="block text-[13px] font-semibold text-muted">Friend or partner</span>
            </span>
          </Link>
        </>
      )}
    </div>
  );
}
