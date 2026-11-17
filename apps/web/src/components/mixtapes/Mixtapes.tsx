"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Gift, Mic, Play, Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useDebounced } from "@/components/common";
import { PageHero } from "@/components/sky/PageHero";
import { ClipRecorder, useClipRecorder } from "@/components/Dedications";
import { ConfirmDialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Plank } from "@/components/Shelf";
import { Button, Chip, Empty, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { giftKeys, useMixtapes, type MixtapeSummary } from "@/lib/gift";
import { keepsakeApi, useMixtape, type Mixtape, type MixtapeInput } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { uiSound } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";
import { usePlayer } from "@/player/store";

const COLORS = ["#c86b5e", "#e3a857", "#6f9a7a", "#5d7fb8", "#9a6fb8", "#d77fa1", "#3a3a50"];

export function Cassette({ title, color, spinning, className }: { title: string; color: string; spinning?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const spin = spinning && !reduced;
  const reel = (cx: number) => (
    <g style={{ transformOrigin: `${cx}px 67px`, animation: spin ? "spin 2.4s linear infinite" : undefined }}>
      <circle cx={cx} cy={67} r={12} fill="#f4efe6" />
      <circle cx={cx} cy={67} r={4} fill="#2b2b3a" />
      {[0, 60, 120].map((a) => (
        <rect key={a} x={cx - 1.2} y={56} width={2.4} height={22} rx={1} fill="#2b2b3a" transform={`rotate(${a} ${cx} 67)`} />
      ))}
    </g>
  );
  return (
    <div className={cn("relative aspect-[240/150] w-full [container-type:inline-size]", className)}>
      <svg viewBox="0 0 240 150" className="absolute inset-0 size-full drop-shadow-[0_10px_18px_rgba(30,27,58,0.25)]" aria-hidden>
        <rect x={2} y={2} width={236} height={146} rx={12} fill="#2b2b3a" />
        <rect x={16} y={12} width={208} height={84} rx={7} fill={color} />
        <rect x={24} y={20} width={192} height={26} rx={3} fill="#fff8ec" />
        <rect x={60} y={52} width={120} height={30} rx={14} fill="#1c1c28" />
        {reel(90)}
        {reel(150)}
        <path d="M58 148 L72 112 H168 L182 148 Z" fill="#232331" />
        {[78, 96, 144, 162].map((x) => (
          <circle key={x} cx={x} cy={130} r={3} fill="#3a3a50" />
        ))}
      </svg>
      <div className="absolute inset-x-[11%] top-[14.5%] flex h-[16%] items-center justify-center overflow-hidden">
        <span dir="auto" className="truncate font-hand text-[clamp(12px,7cqw,30px)] leading-none text-[#3b2f2a]">
          {title}
        </span>
      </div>
    </div>
  );
}

function ShelfTape({ m, mine, name }: { m: MixtapeSummary; mine: boolean; name: string }) {
  const wrapped = !mine && !m.opened_at;
  const href = mine && !m.sent_at ? `/mixtapes/?edit=${m.id}` : `/mixtapes/?id=${m.id}`;
  return (
    <Link href={href} className="group grid w-[188px] shrink-0 snap-start gap-1.5">
      <span className="relative block transition-transform duration-200 ease-out group-hover:-translate-y-1">
        <Cassette title={wrapped ? "" : m.title} color={m.color} />
        {wrapped && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-[10px]"
            style={{
              background: `repeating-linear-gradient(45deg, ${m.color}, ${m.color} 10px, color-mix(in oklab, ${m.color} 78%, white) 10px, color-mix(in oklab, ${m.color} 78%, white) 20px)`,
            }}
          >
            <span className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-[#fff8ec]/90" />
            <span className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 bg-[#fff8ec]/90" />
          </span>
        )}
      </span>
      <span dir="auto" className="truncate font-hand text-xl leading-tight">
        {wrapped ? "Mixtape" : m.title}
      </span>
      <span className="-mt-1.5 truncate text-[13px] font-semibold text-muted">
        {mine ? (m.sent_at ? `To ${name}` : "Draft") : `From ${name}`} · {m.track_count} {m.track_count === 1 ? "song" : "songs"}
      </span>
    </Link>
  );
}

export function MixtapeList() {
  const me = useMe().data;
  const members = useMembers();
  const q = useMixtapes();
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const received = (q.data ?? []).filter((m) => m.to_user === me?.id);
  const made = (q.data ?? []).filter((m) => m.from_user === me?.id);
  return (
    <>
      <PageHero title="Mixtapes" meta={q.data ? `${received.length} received · ${made.length} made` : undefined}>
        <Link href="/mixtapes/?edit=new" className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-strong px-4 font-semibold text-on-accent shadow-soft">
          <Plus className="size-5" /> New mixtape
        </Link>
      </PageHero>
      {q.isLoading && <Spinner className="size-6 text-muted" />}
      <div className="grid grid-cols-1 gap-10">
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">Received</h2>
          {q.data && !received.length ? (
            <Empty>None yet</Empty>
          ) : (
            <Plank>
              {received.map((m) => (
                <ShelfTape key={m.id} m={m} mine={false} name={name(m.from_user)} />
              ))}
            </Plank>
          )}
        </section>
        <section>
          <h2 className="mb-3 font-display text-xl font-semibold">Made</h2>
          {q.data && !made.length ? (
            <Empty>None yet</Empty>
          ) : (
            <Plank>
              {made.map((m) => (
                <ShelfTape key={m.id} m={m} mine name={name(m.to_user)} />
              ))}
            </Plank>
          )}
        </section>
      </div>
    </>
  );
}

function playIntro(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.onended = () => resolve();
    a.onerror = () => resolve();
    void a.play().catch(() => resolve());
  });
}

function Unwrap({ m, onOpen }: { m: Mixtape; onOpen: () => void }) {
  const reduced = useReducedMotion();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    uiSound("paper");
    try {
      await keepsakeApi.openMixtape(m.id);
      void queryClient.invalidateQueries({ queryKey: giftKeys.mixtapes });
      void queryClient.invalidateQueries({ queryKey: giftKeys.stars });
    } catch {
    }
    setTimeout(onOpen, reduced ? 200 : 900);
  };
  const half = (side: -1 | 1) => (
    <motion.div
      className="absolute inset-y-0 w-1/2"
      style={{
        [side < 0 ? "left" : "right"]: 0,
        background: `repeating-linear-gradient(45deg, ${m.color}, ${m.color} 14px, color-mix(in oklab, ${m.color} 80%, white) 14px, color-mix(in oklab, ${m.color} 80%, white) 28px)`,
        borderRadius: side < 0 ? "24px 0 0 24px" : "0 24px 24px 0",
      }}
      animate={opening ? (reduced ? { opacity: 0 } : { x: side * 260, rotate: side * 14, opacity: 0 }) : {}}
      transition={{ duration: reduced ? 0.2 : 0.8, ease: [0.3, 0.7, 0.4, 1] }}
    />
  );
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-6 pt-6">
      <div className="relative aspect-[240/150] w-full">
        <div className="absolute inset-0 grid place-items-center">
          <Cassette title={m.title} color={m.color} className="w-[86%]" />
        </div>
        {half(-1)}
        {half(1)}
        <motion.div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-5 -translate-x-1/2 bg-[#fff8ec]/90"
          animate={opening ? { opacity: 0 } : {}}
          transition={{ duration: 0.3 }}
        />
        <motion.div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-5 -translate-y-1/2 bg-[#fff8ec]/90"
          animate={opening ? { opacity: 0 } : {}}
          transition={{ duration: 0.3 }}
        />
      </div>
      <Button variant="primary" onClick={() => void open()} disabled={opening}>
        <Gift className="size-5" /> Unwrap
      </Button>
    </div>
  );
}

function Side({ m, side, onPlay }: { m: Mixtape; side: "A" | "B"; onPlay: (index: number) => void }) {
  const tracks = m.tracks.filter((t) => t.side === side);
  if (!tracks.length) return null;
  return (
    <section className="rounded-card bg-surface-solid/60 p-3 shadow-soft">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Side {side}</h2>
        <IconButton label={`Play side ${side}`} onClick={() => onPlay(0)}>
          <Play />
        </IconButton>
      </div>
      <ol className="grid gap-1">
        {tracks.map((t, i) => (
          <li key={t.position}>
            <button type="button" onClick={() => onPlay(i)} disabled={!t.track} className="flex w-full items-start gap-3 rounded-button p-1.5 text-start hover:bg-accent-soft/40">
              <span className="tabular mt-3 w-5 shrink-0 text-end text-sm font-bold text-muted">{i + 1}</span>
              <Artwork src={t.track?.artwork_thumb_url ?? null} className="size-11 shrink-0 rounded-chip" />
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-bold">
                  {t.track?.title ?? "Unavailable"}
                </span>
                <span dir="auto" className="block truncate text-sm font-semibold text-muted">
                  {t.track?.artists.join(", ")}
                  {t.track?.duration_ms ? ` · ${fmtMs(t.track.duration_ms)}` : ""}
                </span>
                {t.note && (
                  <span dir="auto" className="mt-0.5 block font-hand text-lg leading-snug">
                    {t.note}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function MixtapeView({ id }: { id: string }) {
  const me = useMe().data;
  const members = useMembers();
  const q = useMixtape(id);
  const [unwrapped, setUnwrapped] = useState(false);
  const playing = usePlayer((s) => s.playing && s.context?.id === id);
  const m = q.data;
  if (q.isLoading) return <Spinner className="size-6 text-muted" />;
  if (!m) return <Empty>Mixtape not found</Empty>;
  const fromName = members.data?.find((u) => u.id === m.from_user)?.display_name ?? "";
  if (m.to_user === me?.id && !m.opened_at && !unwrapped) return <Unwrap m={m} onOpen={() => setUnwrapped(true)} />;
  const play = async (side: "A" | "B" | "all", index = 0, withIntro = false) => {
    const list = m.tracks.filter((t) => (side === "all" || t.side === side) && t.track).map((t) => t.track as Track);
    if (!list.length) return;
    if (withIntro && m.intro?.url) await playIntro(m.intro.url);
    playTracks(list, index, { type: "queue", id: m.id, name: m.title });
  };
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Cassette title={m.title} color={m.color} spinning={playing} className="mx-auto max-w-sm" />
      <div className="text-center">
        <p className="text-sm font-bold text-muted">
          {m.from_user === me?.id ? "From you" : `From ${fromName}`}
          {m.sent_at ? ` · ${new Date(m.sent_at).toLocaleDateString([], { month: "long", day: "numeric" })}` : ""}
        </p>
        {m.note && (
          <p dir="auto" className="mt-2 whitespace-pre-wrap font-hand text-2xl leading-snug">
            {m.note}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => void play("all", 0, true)}>
            <Play className="size-5" /> Play
          </Button>
          {m.intro?.url && (
            <Button onClick={() => void playIntro(m.intro!.url!)}>
              <Mic className="size-5" /> Intro
            </Button>
          )}
        </div>
      </div>
      <Side m={m} side="A" onPlay={(i) => void play("A", i)} />
      <Side m={m} side="B" onPlay={(i) => void play("B", i)} />
    </div>
  );
}

type DraftTrack = { track: Track; side: "A" | "B"; note: string };

export function MixtapeEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const existing = useMixtape(id);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [note, setNote] = useState("");
  const [tracks, setTracks] = useState<DraftTrack[]>([]);
  const [introId, setIntroId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const recorder = useClipRecorder();
  const q = useDebounced(search.trim(), 250);
  const results = useQuery({ queryKey: ["library-search", q], queryFn: async () => (await api.searchLibrary(q)).tracks, enabled: q.length > 1 });

  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setTitle(m.title);
    setColor(m.color);
    setNote(m.note);
    setIntroId(m.intro?.id ?? null);
    setTracks(m.tracks.filter((t) => t.track).map((t) => ({ track: t.track as Track, side: t.side, note: t.note })));
  }, [existing.data]);

  const add = (t: Track, side: "A" | "B") => setTracks((list) => [...list, { track: t, side, note: "" }]);
  const move = (i: number, d: -1 | 1) =>
    setTracks((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const update = (i: number, patch: Partial<DraftTrack>) => setTracks((list) => list.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  const ordered = useMemo(() => [...tracks.filter((t) => t.side === "A"), ...tracks.filter((t) => t.side === "B")], [tracks]);

  const save = async (send: boolean) => {
    setBusy(true);
    try {
      let intro = introId;
      if (recorder.state === "done") intro = (await recorder.upload())?.id ?? intro;
      const input: MixtapeInput = {
        title: title.trim(),
        color,
        note,
        intro_clip_id: intro,
        tracks: ordered.map((t) => ({ track_id: t.track.id, side: t.side, note: t.note })),
      };
      const m = id ? await keepsakeApi.updateMixtape(id, input) : await keepsakeApi.createMixtape(input);
      if (send) await keepsakeApi.sendMixtape(m.id);
      void queryClient.invalidateQueries({ queryKey: giftKeys.mixtapes });
      toast(send ? "Mixtape sent" : "Draft saved");
      router.replace(send ? `/mixtapes/?id=${m.id}` : `/mixtapes/?edit=${m.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };

  if (id && existing.isLoading) return <Spinner className="size-6 text-muted" />;
  if (existing.data?.sent_at) return <MixtapeView id={existing.data.id} />;
  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <PageHero title={id ? "Mixtape draft" : "New mixtape"} />
      <Cassette title={title || "…"} color={color} className="mx-auto max-w-sm" />
      <Field label="Label">
        <input dir="auto" className={`${inputClass} font-hand text-xl`} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div role="radiogroup" aria-label="Cover color" className="flex flex-wrap gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={cn("size-10 rounded-full border-2 transition-transform", color === c ? "scale-110 border-ink" : "border-transparent")}
            style={{ background: c }}
          />
        ))}
      </div>
      <Field label="Note">
        <textarea dir="auto" rows={3} className={`${inputClass} py-3 font-hand text-xl`} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <section className="grid gap-2">
        <h2 className="font-display text-lg font-semibold">Voice intro</h2>
        {introId && recorder.state === "idle" ? (
          <div className="flex items-center gap-2">
            <span className="font-bold text-muted">Recorded</span>
            <Button size="sm" variant="ghost" onClick={() => setIntroId(null)}>
              Remove
            </Button>
          </div>
        ) : (
          <ClipRecorder recorder={recorder} />
        )}
      </section>

      <section className="grid gap-2">
        <h2 className="font-display text-lg font-semibold">Songs</h2>
        {(["A", "B"] as const).map((side) => (
          <div key={side} className="rounded-card bg-surface-solid/60 p-2 shadow-soft">
            <h3 className="px-1 pb-1 text-sm font-extrabold uppercase tracking-wide text-muted">Side {side}</h3>
            {!tracks.some((t) => t.side === side) && <p className="px-1 py-2 text-sm font-semibold text-muted">Empty</p>}
            <ol className="grid gap-1">
              {tracks.map((t, i) =>
                t.side !== side ? null : (
                  <li key={`${t.track.id}-${i}`} className="grid gap-1 rounded-button p-1.5 hover:bg-accent-soft/30">
                    <div className="flex items-center gap-2">
                      <Artwork src={t.track.artwork_thumb_url} className="size-10 shrink-0 rounded-chip" />
                      <span dir="auto" className="min-w-0 flex-1 truncate font-bold">
                        {t.track.title} · {t.track.artists.join(", ")}
                      </span>
                      <IconButton label="Move up" size="sm" onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </IconButton>
                      <IconButton label="Move down" size="sm" onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </IconButton>
                      <Chip onClick={() => update(i, { side: side === "A" ? "B" : "A" })}>{side === "A" ? "To B" : "To A"}</Chip>
                      <IconButton label="Remove" size="sm" onClick={() => setTracks((list) => list.filter((_, k) => k !== i))}>
                        <Trash2 />
                      </IconButton>
                    </div>
                    <input
                      dir="auto"
                      aria-label={`Note for ${t.track.title}`}
                      placeholder="Note"
                      className={`${inputClass} min-h-9 font-hand text-lg`}
                      value={t.note}
                      maxLength={1000}
                      onChange={(e) => update(i, { note: e.target.value })}
                    />
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}
        <input aria-label="Find a song" placeholder="Find a song" dir="auto" className={inputClass} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="grid gap-1">
          {results.data?.slice(0, 12).map((t) => (
            <li key={t.id} className="flex items-center gap-2 rounded-button p-1.5 hover:bg-accent-soft/30">
              <Artwork src={t.artwork_thumb_url} className="size-10 shrink-0 rounded-chip" />
              <span dir="auto" className="min-w-0 flex-1 truncate font-semibold">
                {t.title} · {t.artists.join(", ")}
              </span>
              <Chip onClick={() => add(t, "A")}>A</Chip>
              <Chip onClick={() => add(t, "B")}>B</Chip>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save(false)} disabled={busy || !title.trim()}>
            Save draft
          </Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={busy || !title.trim() || !tracks.length}>
            Send
          </Button>
          {id && (
            <Button variant="ghost" onClick={() => setDeleting(true)} disabled={busy}>
              Delete draft
            </Button>
          )}
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this draft?"
        action="Delete"
        onConfirm={async () => {
          if (!id) return;
          try {
            await keepsakeApi.deleteMixtape(id);
            void queryClient.invalidateQueries({ queryKey: giftKeys.mixtapes });
            router.replace("/mixtapes/");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </div>
  );
}
