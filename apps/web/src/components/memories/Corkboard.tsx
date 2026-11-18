"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDay, tilt, today } from "@/lib/days";
import { gentle } from "@/lib/motion";
import { memoriesApi, memoryKeys, useMemories, useMemoriesLive, type Memory, type Photo } from "@/lib/memories";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { useResolvedTheme } from "@/lib/theme";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";

import { Byline, DayField, PhotoField, PhotoImage, SongChip, SongField, paperTokens, playSong } from "./parts";

const PINS = ["#e88fa3", "#c9b8f0", "#ffd25e", "#8fbf8a", "#8fa6e0"];

function corkStyle(night: boolean) {
  const base = night ? "#5e4637" : "#cfa274";
  const dark = night ? "#4c372b" : "#b98b5d";
  const light = night ? "#6e5444" : "#ddb88c";
  return {
    backgroundColor: base,
    backgroundImage: [
      `radial-gradient(${dark} 1px, transparent 1.6px)`,
      `radial-gradient(${light} 1px, transparent 1.6px)`,
      `radial-gradient(${dark} 0.8px, transparent 1.2px)`,
    ].join(","),
    backgroundSize: "13px 13px, 17px 17px, 7px 9px",
    backgroundPosition: "0 0, 6px 9px, 3px 2px",
    boxShadow: `inset 0 0 0 8px var(--plank), inset 0 0 0 11px var(--plank-shade), inset 0 10px 24px rgba(0,0,0,${night ? 0.35 : 0.18})`,
  };
}

const paper = (night: boolean) => (night ? "#ebe4d8" : "#fffdf8");

function Pin({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="absolute -top-2 left-1/2 z-10 size-4 -translate-x-1/2 rounded-full shadow-[0_3px_3px_rgba(0,0,0,0.35)]"
      style={{ background: `radial-gradient(circle at 35% 30%, #ffffffcc 0 18%, ${color} 24% 100%)` }}
    />
  );
}

function Polaroid({ m, index, night, onOpen }: { m: Memory; index: number; night: boolean; onOpen: () => void }) {
  return (
    <li className="relative" style={{ rotate: `${tilt(m.id)}deg` }}>
      <Pin color={PINS[index % PINS.length]} />
      <motion.button
        type="button"
        layoutId={`memory-${m.id}`}
        transition={gentle}
        onClick={onOpen}
        aria-label={m.title}
        className="block w-full rounded-[3px] p-2 pb-3 text-start shadow-[0_8px_16px_rgba(30,20,10,0.32)] transition-transform duration-200 hover:-translate-y-1 hover:rotate-[-1deg]"
        style={{ ...paperTokens, background: paper(night) }}
      >
        <span className="relative block aspect-square overflow-hidden bg-[#e9e2d6]">
          <PhotoImage photo={m.photo} className="size-full" />
          {(m.placeholder || m.photo?.placeholder) && <PlaceholderMark className="absolute bottom-1.5 start-1.5 bg-panel/90 px-1.5 text-[9px]" />}
        </span>
        <span dir="auto" className="mt-2 block truncate font-hand text-[19px] leading-tight sm:text-[22px]">
          {m.title}
        </span>
        <span className="block truncate text-xs font-bold text-muted">{fmtDay(m.date)}</span>
      </motion.button>
    </li>
  );
}

function MemoryView({ m, night, onClose, onEdit }: { m: Memory; night: boolean; onClose: () => void; onEdit: () => void }) {
  const me = useMe().data;
  const [removing, setRemoving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const canDelete = me && (me.id === m.created_by || me.role === "admin");
  const portrait = (m.photo?.height ?? 1) > (m.photo?.width ?? 1);
  return (
    <motion.div
      className="fixed inset-0 z-[75] grid place-items-center overflow-y-auto bg-[#0b0d11]/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={m.title}
    >
      <motion.article
        layoutId={`memory-${m.id}`}
        transition={gentle}
        onClick={(e) => e.stopPropagation()}
        className={cn("relative w-full rounded-[4px] p-3 pb-5 shadow-[0_24px_60px_rgba(10,8,30,0.5)] sm:p-4", portrait ? "max-w-md" : "max-w-2xl")}
        style={{ ...paperTokens, background: paper(night) }}
      >
        <div className="relative overflow-hidden bg-[#e9e2d6]">
          <PhotoImage photo={m.photo} size="display" eager fit="contain" className={cn("w-full", portrait ? "max-h-[62dvh]" : "max-h-[56dvh]")} />
        </div>
        <div className="mt-3 grid gap-2 px-1">
          <div className="flex items-start gap-2">
            <h2 dir="auto" className="min-w-0 flex-1 font-hand text-[32px] leading-tight">
              {m.title}
            </h2>
            {(m.placeholder || m.photo?.placeholder) && <PlaceholderMark className="mt-2" />}
          </div>
          {m.caption && (
            <p dir="auto" className="whitespace-pre-wrap font-hand text-[22px] leading-snug">
              {m.caption}
            </p>
          )}
          <Byline userId={m.created_by} date={m.date} />
          <div className="flex flex-wrap items-center gap-2">
            <SongChip track={m.track} name={m.title} />
            <span className="ms-auto flex gap-1">
              <IconButton label="Edit memory" onClick={onEdit}>
                <Pencil />
              </IconButton>
              {canDelete && (
                <IconButton label="Delete memory" onClick={() => setRemoving(true)}>
                  <Trash2 />
                </IconButton>
              )}
            </span>
          </div>
        </div>
        <span className="absolute -end-3 -top-3 rounded-full bg-panel shadow-soft">
          <IconButton ref={closeRef} label="Close" onClick={onClose}>
            <X />
          </IconButton>
        </span>
      </motion.article>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Delete this memory?"
        action="Delete"
        onConfirm={async () => {
          try {
            await memoriesApi.deleteMemory(m.id);
            onClose();
            void queryClient.invalidateQueries({ queryKey: memoryKeys.memories });
            void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </motion.div>
  );
}

export function MemoryEditor({ memory, open, onClose }: { memory: Memory | null; open: boolean; onClose: (saved?: Memory) => void }) {
  const [date, setDate] = useState<string | null>(today());
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDate(memory?.date ?? today());
    setTitle(memory?.title ?? "");
    setCaption(memory?.caption ?? "");
    setPhoto(memory?.photo ?? null);
    setTrack(memory?.track ?? null);
  }, [open, memory]);
  const save = async () => {
    if (!date) return;
    setBusy(true);
    try {
      const input = { date, title, caption, photo_id: photo?.id ?? null, track_id: track?.id ?? null };
      const saved = memory ? await memoriesApi.updateMemory(memory.id, input) : await memoriesApi.createMemory(input);
      void queryClient.invalidateQueries({ queryKey: memoryKeys.memories });
      void queryClient.invalidateQueries({ queryKey: memoryKeys.soundtrack });
      onClose(saved);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={memory ? "Memory" : "New memory"} wide>
      <div className="grid gap-4">
        <PhotoField value={photo} onChange={setPhoto} />
        <Field label="Title">
          <input dir="auto" className={`${inputClass} font-hand text-xl`} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Caption">
          <textarea dir="auto" rows={4} className={`${inputClass} py-3 font-hand text-xl`} value={caption} maxLength={2000} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <DayField label="Date" value={date} onChange={setDate} required />
        <SongField value={track} onChange={setTrack} />
        <Button variant="primary" onClick={() => void save()} disabled={busy || !title.trim() || !date || photo?.status === "processing"}>
          {busy && <Spinner className="size-4" />} Save memory
        </Button>
      </div>
    </Dialog>
  );
}

export function Corkboard() {
  useMemoriesLive();
  const q = useMemories();
  const params = useSearchParams();
  const router = useRouter();
  const night = useResolvedTheme() === "night";
  const [openId, setOpenId] = useState<string | null>(params.get("id"));
  const [editing, setEditing] = useState<Memory | "new" | null>(null);
  const list = q.data ?? [];
  const open = list.find((m) => m.id === openId) ?? null;

  const show = (m: Memory) => {
    setOpenId(m.id);
    playSong(m.track, m.title);
  };
  const close = () => {
    setOpenId(null);
    if (params.get("id")) router.replace("/memories/", { scroll: false });
  };

  return (
    <>
      <PageHero title="Memories" meta={q.data ? `${list.length} ${list.length === 1 ? "memory" : "memories"}` : undefined}>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-5" /> Add memory
        </Button>
      </PageHero>
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      {q.data && !list.length && <Empty>No memories</Empty>}
      {list.length > 0 && (
        <section aria-label="Corkboard" className="rounded-[14px] px-4 pb-8 pt-9 sm:px-8 sm:pt-10" style={corkStyle(night)}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4 lg:gap-y-10">
            {list.map((m, i) => (
              <Polaroid key={m.id} m={m} index={i} night={night} onOpen={() => show(m)} />
            ))}
          </ul>
        </section>
      )}
      <AnimatePresence>
        {open && (
          <MemoryView
            key={open.id}
            m={open}
            night={night}
            onClose={close}
            onEdit={() => setEditing(open)}
          />
        )}
      </AnimatePresence>
      <MemoryEditor
        memory={editing === "new" ? null : editing}
        open={!!editing}
        onClose={(saved) => {
          setEditing(null);
          if (saved && !open) setOpenId(saved.id);
        }}
      />
    </>
  );
}
