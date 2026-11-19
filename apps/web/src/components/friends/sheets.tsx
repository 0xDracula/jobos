"use client";

import { Check, LogOut, UserMinus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { create } from "zustand";

import { Dialog } from "@/components/dialogs";
import { Button, inputClass, Segmented, Switch } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useFriends, type Person } from "@/lib/people";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import {
  conversationApi, conversationName, shareLyrics, shareSong, socialKeys, useConversations,
  type Conversation, type LyricLine,
} from "@/lib/social";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { startJam } from "@/player/together";

import { AvatarStack, PersonAvatar } from "./people";

function PickPerson({ person, on, onToggle }: { person: Person; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} className="grid w-full justify-items-center gap-1.5 text-center">
      <span className="relative">
        <PersonAvatar person={person} size={52} className={cn(on && "ring-[2.5px] ring-accent ring-offset-2 ring-offset-[var(--surface-solid)]")} />
        {on && (
          <span className="absolute -bottom-0.5 -end-1 grid size-5 place-items-center rounded-full bg-accent text-on-accent ring-2 ring-[var(--surface-solid)]">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span dir="auto" className="w-full truncate text-xs font-extrabold text-ink-2">
        {person.display_name}
      </span>
    </button>
  );
}

function useFriendList(): Person[] {
  return useFriends().data?.friends.map((f) => f.person) ?? [];
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function FriendGrid({ picked, onToggle, exclude = [] }: { picked: string[]; onToggle: (id: string) => void; exclude?: string[] }) {
  const friends = useFriendList().filter((p) => !exclude.includes(p.id));
  if (!friends.length) return <p className="py-4 text-center font-semibold text-muted">No friends yet</p>;
  return (
    <ul className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
      {friends.map((p) => (
        <li key={p.id}>
          <PickPerson person={p} on={picked.includes(p.id)} onToggle={() => onToggle(p.id)} />
        </li>
      ))}
    </ul>
  );
}

export function NewChatSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const friends = useFriendList();
  const go = (id: string) => {
    onOpenChange(false);
    setPicked([]);
    setTitle("");
    void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
    router.push(`/chat/?c=${id}`);
  };
  const openDirect = async (person: Person) => {
    try {
      go((await conversationApi.open({ user_id: person.id })).id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Chat unavailable");
    }
  };
  const createGroup = async () => {
    setBusy(true);
    try {
      go((await conversationApi.open({ title: title.trim(), members: picked })).id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Group not created");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New chat">
      <div className="grid gap-4 pt-1">
        <Segmented<"direct" | "group">
          label="Chat kind"
          value={mode}
          onChange={setMode}
          options={[
            ["direct", "Message"],
            ["group", "Group"],
          ]}
        />
        {mode === "direct" ? (
          friends.length ? (
            <ul>
              {friends.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => void openDirect(p)} className="flex w-full items-center gap-3 py-2 text-start">
                    <PersonAvatar person={p} size={44} />
                    <span className="min-w-0">
                      <span dir="auto" className="block truncate font-extrabold">
                        {p.display_name}
                      </span>
                      <span className="block truncate text-[13px] font-semibold text-muted">@{p.username}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center font-semibold text-muted">No friends yet</p>
          )
        ) : (
          <>
            <label className="grid gap-1.5">
              <span className="text-[13px] font-extrabold text-ink-2">Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Group name" className={inputClass} dir="auto" />
            </label>
            <FriendGrid picked={picked} onToggle={(id) => setPicked((l) => toggle(l, id))} />
            <Button variant="primary" disabled={busy || picked.length < 1} onClick={() => void createGroup()}>
              {picked.length ? `Create · ${picked.length + 1} people` : "Create"}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

type Sendable =
  | { kind: "song"; track: Pick<Track, "id" | "title" | "artists">; startMs?: number; note?: string; onSent?: (names: string[]) => void }
  | { kind: "lyric"; track: Track; lines: LyricLine[]; onSent?: (names: string[]) => void };

const useSendSheet = create<{ item: Sendable | null }>(() => ({ item: null }));

export const openSend = (item: Sendable) => useSendSheet.setState({ item });

export function SendSheet() {
  const item = useSendSheet((s) => s.item);
  const me = useMe().data?.id;
  const groups = (useConversations().data ?? []).filter((c) => c.kind === "group");
  const [people, setPeople] = useState<string[]>([]);
  const [chats, setChats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const friends = useFriendList();
  const close = () => {
    useSendSheet.setState({ item: null });
    setPeople([]);
    setChats([]);
  };
  const send = async () => {
    if (!item) return;
    setBusy(true);
    const names: string[] = [];
    try {
      const targets = [...chats];
      for (const id of people) {
        targets.push((await conversationApi.open({ user_id: id })).id);
        names.push(friends.find((p) => p.id === id)?.display_name ?? "");
      }
      for (const id of chats) names.push(conversationName(groups.find((g) => g.id === id)!, me));
      for (const c of targets) {
        if (item.kind === "song") shareSong(c, item.track, { startMs: item.startMs, note: item.note });
        else shareLyrics(c, item.track, item.lines);
      }
      void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
      toast(names.length === 1 ? `Sent to ${names[0]}` : `Sent to ${names.length} chats`);
      item.onSent?.(names);
      close();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Not sent");
    } finally {
      setBusy(false);
    }
  };
  const count = people.length + chats.length;
  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && close()} title="Send">
      <div className="grid gap-4 pt-1">
        <FriendGrid picked={people} onToggle={(id) => setPeople((l) => toggle(l, id))} />
        {groups.length > 0 && (
          <div className="grid gap-2">
            <p className="text-[13.5px] font-extrabold text-muted">Groups</p>
            {groups.map((g) => (
              <GroupOption key={g.id} c={g} me={me} on={chats.includes(g.id)} onToggle={() => setChats((l) => toggle(l, g.id))} />
            ))}
          </div>
        )}
        <Button variant="primary" disabled={busy || count === 0} onClick={() => void send()}>
          {count ? `Send to ${count}` : "Send"}
        </Button>
      </div>
    </Dialog>
  );
}

function GroupOption({ c, me, on, onToggle }: { c: Conversation; me: string | undefined; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn("flex w-full items-center gap-3 rounded-[14px] border-[1.5px] bg-surface-2 p-3 text-start", on ? "border-accent" : "border-transparent")}
    >
      <AvatarStack people={c.members.filter((m) => m.id !== me)} size={30} />
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate font-extrabold">
          {conversationName(c, me)}
        </span>
        <span className="block text-[13px] font-semibold text-muted">{c.members.length} people</span>
      </span>
      <span className={cn("grid size-[22px] place-items-center rounded-full border-2", on ? "border-accent" : "border-line-strong")}>
        {on && <span className="size-2.5 rounded-full bg-accent" />}
      </span>
    </button>
  );
}

export function JamSheet({ open, onOpenChange, conversation, invite: preset = [] }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversation?: Conversation | null;
  invite?: string[];
}) {
  const router = useRouter();
  const me = useMe().data?.id;
  const [people, setPeople] = useState<string[]>(preset);
  const [withChat, setWithChat] = useState(true);
  const [friendsJoin, setFriendsJoin] = useState(true);
  const [anyoneAdd, setAnyoneAdd] = useState(true);
  const [anyoneSkip, setAnyoneSkip] = useState(true);
  const [busy, setBusy] = useState(false);
  const inChat = useMemo(() => conversation?.members.map((m) => m.id) ?? [], [conversation]);
  const start = async () => {
    setBusy(true);
    try {
      const id = await startJam({
        invite: people,
        conversation_id: conversation && withChat ? conversation.id : undefined,
        friends_join: friendsJoin,
        anyone_add: anyoneAdd,
        anyone_skip: anyoneSkip,
      });
      if (!id) {
        toast("Play something first");
        return;
      }
      onOpenChange(false);
      router.push(`/jam/?id=${id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Jam not started");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Start a jam">
      <div className="grid gap-4 pt-1">
        {conversation && (
          <GroupOption c={conversation} me={me} on={withChat} onToggle={() => setWithChat((v) => !v)} />
        )}
        <div className="grid gap-2">
          <p className="text-[13.5px] font-extrabold text-muted">Invite</p>
          <FriendGrid picked={people} onToggle={(id) => setPeople((l) => toggle(l, id))} exclude={withChat ? inChat : []} />
        </div>
        <div className="grid divide-y divide-line rounded-[14px] bg-surface-2 px-3.5">
          <SwitchRow label="Open to friends" checked={friendsJoin} onChange={setFriendsJoin} />
          <SwitchRow label="Anyone can add songs" checked={anyoneAdd} onChange={setAnyoneAdd} />
          <SwitchRow label="Anyone can skip" checked={anyoneSkip} onChange={setAnyoneSkip} />
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void start()}>
          {people.length ? `Start jam · ${people.length} invited` : "Start jam"}
        </Button>
      </div>
    </Dialog>
  );
}

export function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 text-[15px] font-semibold">
      <span>{label}</span>
      <Switch label={label} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function GroupSheet({ open, onOpenChange, conversation }: { open: boolean; onOpenChange: (v: boolean) => void; conversation: Conversation }) {
  const router = useRouter();
  const me = useMe().data?.id;
  const [title, setTitle] = useState(conversation.title);
  const [adding, setAdding] = useState<string[]>([]);
  const owner = conversation.role === "owner";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: socialKeys.conversation(conversation.id) });
    void queryClient.invalidateQueries({ queryKey: socialKeys.conversations });
  };
  const act = async (fn: () => Promise<unknown>, failed: string) => {
    try {
      await fn();
      refresh();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : failed);
      return false;
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Group">
      <div className="grid gap-5 pt-1">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => conversationApi.rename(conversation.id, title.trim()), "Name not saved").then((ok) => ok && toast("Name saved"));
          }}
        >
          <input aria-label="Name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder={conversationName(conversation, me)} className={inputClass} dir="auto" />
          <Button type="submit" disabled={title.trim() === conversation.title}>
            Save
          </Button>
        </form>
        <div>
          <p className="mb-1 text-[13.5px] font-extrabold text-muted">{conversation.members.length} people</p>
          <ul>
            {conversation.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-1.5">
                <PersonAvatar person={m} size={40} />
                <span dir="auto" className="min-w-0 flex-1 truncate font-extrabold">
                  {m.id === me ? "You" : m.display_name}
                </span>
                {m.role === "owner" && <span className="text-xs font-bold text-muted">Owner</span>}
                {owner && m.id !== me && (
                  <Button size="sm" variant="ghost" aria-label={`Remove ${m.display_name}`} onClick={() => void act(() => conversationApi.removeMember(conversation.id, m.id), "Not removed")}>
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-2">
          <p className="text-[13.5px] font-extrabold text-muted">Add</p>
          <FriendGrid picked={adding} onToggle={(id) => setAdding((l) => toggle(l, id))} exclude={conversation.members.map((m) => m.id)} />
          {adding.length > 0 && (
            <Button variant="primary" onClick={() => void act(() => conversationApi.addMembers(conversation.id, adding), "Not added").then((ok) => ok && setAdding([]))}>
              Add {adding.length}
            </Button>
          )}
        </div>
        <Button
          variant="danger"
          onClick={() =>
            void act(() => conversationApi.removeMember(conversation.id, me!), "Not left").then((ok) => {
              if (!ok) return;
              onOpenChange(false);
              router.push("/friends/");
            })
          }
        >
          <LogOut className="size-4" /> Leave group
        </Button>
      </div>
    </Dialog>
  );
}
