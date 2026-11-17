"use client";

import { useQuery } from "@tanstack/react-query";
import { Pin, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { IconButton, Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { socialApi, usePins, type ChatMessage } from "@/lib/social";

export function messageText(m: ChatMessage): string {
  if (m.deleted) return "Deleted message";
  const title = m.data?.track?.title ?? "";
  switch (m.kind) {
    case "song":
      return `Song: ${title}`;
    case "lyric":
      return m.data?.lines?.map((l) => l.text).join(" / ") ?? `Lyrics: ${title}`;
    case "voice":
      return "Voice note";
    case "photo":
      return m.body ? `Photo: ${m.body}` : "Photo";
    case "sticker":
      return "Sticker";
    case "session":
      return `Listen together: ${m.body}`;
    case "swap":
      return `Song swap · ${title}: ${m.body}`;
    default:
      return m.body;
  }
}

const dateOf = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

export function PinnedBar({ onJump }: { onJump: (id: string) => void }) {
  const pins = usePins();
  const list = pins.data ?? [];
  if (!list.length) return null;
  return (
    <Menu modal={false}>
      <MenuTrigger className="flex w-full items-center gap-2 rounded-[14px] border border-[var(--chat-theirs-line)] bg-[var(--chat-theirs)] px-3 py-2 text-start text-sm">
        <Pin className="size-4 shrink-0 text-accent-strong" />
        <span dir="auto" className="min-w-0 flex-1 truncate">
          <span className="font-bold">Pinned · </span>
          {messageText(list[0])}
        </span>
        {list.length > 1 && <span className="shrink-0 text-xs font-extrabold text-muted">{list.length}</span>}
      </MenuTrigger>
      <MenuContent align="start" className="w-[min(92vw,420px)]">
        {list.map((m) => (
          <MenuItem key={m.id} onSelect={() => onJump(m.id)}>
            <span className="min-w-0">
              <span dir="auto" className="line-clamp-2 block">
                {messageText(m)}
              </span>
              <span className="block text-xs font-bold text-muted">{dateOf(m.created_at)}</span>
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function ChatSearch({ nameOf, onJump, onClose }: { nameOf: (id: string) => string; onJump: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ queryKey: ["chat-search", term], queryFn: () => socialApi.search(term), enabled: term.length >= 2, staleTime: 30_000 });
  const list = results.data?.messages ?? [];
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-[14px] border-2 border-[var(--chat-theirs-line)] bg-[var(--chat-input)] px-3">
        <Search className="size-4 shrink-0 text-muted" />
        <input
          autoFocus
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          placeholder="Search messages"
          aria-label="Search messages"
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-muted"
        />
        <IconButton label="Close search" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      {term.length >= 2 && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-[min(60vh,440px)] overflow-y-auto rounded-[16px] border border-[var(--chat-theirs-line)] bg-[var(--surface-solid)] p-1.5 shadow-soft">
          {results.isPending ? (
            <p className="p-3 text-sm font-bold text-muted">Searching</p>
          ) : list.length === 0 ? (
            <p className="p-3 text-sm font-bold text-muted">No messages found</p>
          ) : (
            list.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onJump(m.id)}
                className={cn("block w-full rounded-[12px] px-3 py-2 text-start hover:bg-accent-soft/50")}
              >
                <span className="flex items-baseline gap-2 text-xs font-extrabold text-muted">
                  <span className="truncate">{nameOf(m.sender_id)}</span>
                  <span className="ms-auto shrink-0">{dateOf(m.created_at)}</span>
                </span>
                <span dir="auto" className="line-clamp-2 block text-[15px]">
                  {messageText(m)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
