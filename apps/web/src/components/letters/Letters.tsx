"use client";

import { ArrowLeft, Pencil, Play, Plus, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Loading } from "@/components/common";
import { ConfirmDialog } from "@/components/dialogs";
import { Cover } from "@/components/media";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, SectionTitle, Segmented, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { lettersApi, lettersKeys, refreshLetters, useHomeZone, useLetter, useLetters, useRefetchAt, type Letter, type LetterInput } from "@/lib/letters";
import { daysBetween, formatDay, groupReceived, groupWritten, todayIn, zoneCity } from "@/lib/paper";
import { plural } from "@/lib/format";
import { queryClient, usePlaylist, usePlaylists } from "@/lib/queries";
import { useIsAdmin, useMe, useMembers } from "@/lib/session";
import { uiSound } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { playTracks } from "@/player/controls";

import { Envelope, tintFor, type EnvelopeStage } from "./Envelope";
import { Handwriting, useHandFont } from "./Handwriting";
import { LetterPaper, PAPER_FIELD, ruledField } from "./Paper";
import { SongPicker, SongRow } from "./SongPicker";

const KIND_LABEL: Record<Letter["kind"], string> = { welcome: "Welcome letter", standard: "Letter", open_when: "Open when", time_locked: "Time-locked" };

const panel = "rounded-[10px] border-2 border-b-[5px] border-panel-line bg-panel";

export function useNames() {
  const members = useMembers();
  return (id: string | null | undefined) => members.data?.find((u) => u.id === id)?.display_name ?? "";
}

const SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], SHORT);

export const unlockText = (l: Letter) => (l.unlock_date ? `${formatDay(l.unlock_date)}, ${l.unlock_time ?? "00:00"}` : "");

function EnvelopeLink({ letter, caption }: { letter: Letter; caption?: ReactNode }) {
  const label = letter.occasion || letter.title;
  return (
    <Link href={`/letters/?id=${letter.id}`} className="group grid grid-cols-1 content-start gap-2 pt-[18%] text-center" aria-label={label || KIND_LABEL[letter.kind]}>
      <span className="block transition-transform duration-200 ease-out group-hover:-translate-y-1">
        <Envelope
          ajar
          stage={letter.opened_at && !letter.locked ? "open" : "sealed"}
          tint={tintFor(letter.id)}
          locked={letter.locked}
          label={label ? <Handwriting authorId={letter.author_id} className="text-[clamp(14px,9cqw,24px)] leading-[1.05]">{label}</Handwriting> : undefined}
        />
      </span>
      {(caption || letter.placeholder) && (
        <span className="flex flex-wrap items-center justify-center gap-1.5 text-[13px] font-bold text-muted">
          {caption}
          {letter.placeholder && <PlaceholderMark />}
        </span>
      )}
    </Link>
  );
}

function EnvelopeGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

function Received({ letters, me }: { letters: Letter[]; me: string }) {
  const g = groupReceived(letters, me);
  const today = todayIn(useHomeZone());
  useRefetchAt(g.sealed[0]?.unlock_at, lettersKeys.letters);
  if (!g.openWhen.length && !g.sealed.length && !g.letters.length) return <Empty>No letters</Empty>;
  return (
    <div className="grid grid-cols-1 gap-10">
      {g.openWhen.length > 0 && (
        <section>
          <SectionTitle>Open when</SectionTitle>
          <EnvelopeGrid>
            {g.openWhen.map((l) => (
              <EnvelopeLink key={l.id} letter={l} caption={l.opened_at ? `Opened ${shortDate(l.opened_at)}` : undefined} />
            ))}
          </EnvelopeGrid>
        </section>
      )}
      {g.sealed.length > 0 && (
        <section>
          <SectionTitle>Sealed</SectionTitle>
          <EnvelopeGrid>
            {g.sealed.map((l) => (
              <EnvelopeLink
                key={l.id}
                letter={l}
                caption={
                  <span>
                    {formatDay(l.unlock_date ?? today, SHORT)}
                    <span className="block text-xs">{plural(Math.max(daysBetween(today, l.unlock_date ?? today), 0), "day")}</span>
                  </span>
                }
              />
            ))}
          </EnvelopeGrid>
        </section>
      )}
      {g.letters.length > 0 && (
        <section>
          <SectionTitle>Letters</SectionTitle>
          <EnvelopeGrid>
            {g.letters.map((l) => (
              <EnvelopeLink key={l.id} letter={l} caption={l.unlock_date ? formatDay(l.unlock_date, SHORT) : shortDate(l.created_at)} />
            ))}
          </EnvelopeGrid>
        </section>
      )}
    </div>
  );
}

function statusOf(l: Letter): string {
  if (l.status === "draft") return "Draft";
  if (l.kind === "time_locked" && l.locked) return `Unlocks ${unlockText(l)}`;
  return l.opened_at ? `Opened ${shortDate(l.opened_at)}` : "Unopened";
}

function WrittenRow({ letter, onDelete }: { letter: Letter; onDelete: () => void }) {
  const admin = useIsAdmin();
  const welcome = letter.kind === "welcome";
  return (
    <li className="flex min-h-16 items-center gap-3 px-3 py-2">
      <Link href={`/letters/?id=${letter.id}`} className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Handwriting authorId={letter.author_id} as="span" className="truncate pe-1.5 text-[22px] leading-tight">
            {letter.occasion || letter.title || (letter.body ?? "").split("\n")[0] || KIND_LABEL[letter.kind]}
          </Handwriting>
          {letter.placeholder && <PlaceholderMark />}
        </span>
        <span className="block text-sm font-bold text-muted">
          {KIND_LABEL[letter.kind]} · {statusOf(letter)}
        </span>
      </Link>
      {welcome ? (
        admin && (
          <Link href="/admin/#gift" aria-label="Edit welcome letter" className="grid size-9 place-items-center rounded-full hover:bg-accent-soft/50">
            <Pencil className="size-[18px]" />
          </Link>
        )
      ) : (
        <>
          <Link href={`/letters/?edit=${letter.id}`} aria-label="Edit" title="Edit" className="grid size-9 place-items-center rounded-full hover:bg-accent-soft/50">
            <Pencil className="size-[18px]" />
          </Link>
          <IconButton label="Delete" size="sm" onClick={onDelete}>
            <Trash2 />
          </IconButton>
        </>
      )}
    </li>
  );
}

function Written({ letters, me }: { letters: Letter[]; me: string }) {
  const g = groupWritten(letters, me);
  const [removing, setRemoving] = useState<Letter | null>(null);
  const sections: [string, Letter[]][] = [
    ["Drafts", g.drafts],
    ["Open when", g.openWhen],
    ["Time-locked", g.timeLocked],
    ["Letters", g.letters],
    ["Welcome letter", g.welcome],
  ];
  const any = sections.some(([, list]) => list.length);
  return (
    <div className="grid grid-cols-1 gap-8">
      {!any && <Empty>No letters</Empty>}
      {sections.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <SectionTitle>{title}</SectionTitle>
            <ul className={cn(panel, "divide-y divide-panel-line")}>
              {list.map((l) => (
                <WrittenRow key={l.id} letter={l} onDelete={() => setRemoving(l)} />
              ))}
            </ul>
          </section>
        ) : null,
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this letter?"
        action="Delete"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await lettersApi.deleteLetter(removing.id);
            refreshLetters("letters");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </div>
  );
}

export function LetterList({ initialTab }: { initialTab?: "received" | "written" | null }) {
  const me = useMe().data;
  const q = useLetters();
  const letters = useMemo(() => q.data?.letters ?? [], [q.data]);
  const g = useMemo(() => groupReceived(letters, me?.id ?? ""), [letters, me?.id]);
  const received = g.openWhen.length + g.sealed.length + g.letters.length;
  const [tab, setTab] = useState<"received" | "written" | null>(initialTab ?? null);
  const shown = tab ?? (q.data && !received ? "written" : "received");
  const unopened = [...g.openWhen, ...g.letters].filter((l) => !l.opened_at).length;
  const meta = q.data ? [`${unopened} unopened`, g.sealed.length ? `${g.sealed.length} sealed` : ""].filter(Boolean).join(" · ") : undefined;
  return (
    <>
      <PageHero title="Letters" meta={meta}>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/letters/?edit=new" className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-strong px-4 font-semibold text-on-accent shadow-soft">
            <Plus className="size-5" /> Write
          </Link>
          <Segmented
            label="Letters"
            value={shown}
            onChange={setTab}
            options={[
              ["received", "Received"],
              ["written", "Written"],
            ]}
          />
        </div>
      </PageHero>
      {q.isLoading && <Loading />}
      {q.data && me && (shown === "received" ? <Received letters={letters} me={me.id} /> : <Written letters={letters} me={me.id} />)}
    </>
  );
}

export function LetterReveal({
  letter,
  authorName,
  waitForTap,
  replay = 0,
  label,
  onOpening,
  onRead,
  children,
}: {
  letter: Letter;
  authorName: string;
  waitForTap?: boolean;
  replay?: number;
  label?: ReactNode;
  onOpening?: () => void;
  onRead?: () => void;
  children?: ReactNode;
}) {
  const reduced = useReducedMotionConfig();
  const [stage, setStage] = useState<EnvelopeStage | "read">("sealed");
  const open = () => {
    uiSound("paper");
    onOpening?.();
    setStage(reduced ? "read" : "open");
  };
  useEffect(() => {
    setStage("sealed");
    if (waitForTap) return;
    const t = setTimeout(open, reduced ? 0 : 450);
    return () => clearTimeout(t);
  }, [replay, waitForTap, reduced]);
  useEffect(() => {
    if (stage === "read") onRead?.();
  }, [stage]);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {stage !== "read" ? (
        <motion.div key="envelope" className="mx-auto w-full max-w-sm pt-[36%]" exit={{ opacity: 0, y: 40 }} transition={{ duration: 0.35 }}>
          <button
            type="button"
            disabled={stage !== "sealed" || !waitForTap}
            onClick={open}
            aria-label="Open letter"
            autoFocus={waitForTap}
            className="block w-full rounded-[10px] outline-offset-4 disabled:cursor-default"
          >
            <Envelope
              stage={stage}
              tint={tintFor(letter.id)}
              label={label}
              onOpened={() => setStage("rise")}
              onRisen={() => setStage("read")}
            />
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="letter"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 36, scaleY: 0.9 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 90, damping: 20 }}
          className="origin-top"
        >
          <LetterPaper letter={letter} authorName={authorName} />
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlaylistCard({ id }: { id: string }) {
  const q = usePlaylist(id);
  const p = q.data;
  if (!p) return null;
  const ctx = { type: "playlist" as const, id: p.id, name: p.name };
  return (
    <div className={cn(panel, "flex items-center gap-3 p-2.5")}>
      <Cover cover={p.cover_url} collage={p.collage} className="size-16 shrink-0 rounded-[6px]" />
      <div className="min-w-0 flex-1">
        <p dir="auto" className="truncate font-extrabold">
          {p.name}
        </p>
        <p className="text-sm font-semibold text-muted">{plural(p.tracks.length, "song")}</p>
      </div>
      <IconButton label="Play playlist" onClick={() => playTracks(p.tracks, 0, ctx, { shuffle: false })}>
        <Play />
      </IconButton>
      <IconButton label="Shuffle playlist" onClick={() => playTracks(p.tracks, -1, ctx, { shuffle: true })}>
        <Shuffle />
      </IconButton>
    </div>
  );
}

function Attachments({ letter }: { letter: Letter }) {
  if (!letter.track && !letter.playlist_id) return null;
  return (
    <div className="mx-auto mt-6 grid w-full grid-cols-1 max-w-xl gap-2">
      {letter.track && (
        <div className={panel}>
          <SongRow track={letter.track}>
            <IconButton label={`Play ${letter.track.title}`} onClick={() => playTracks([letter.track as Track], 0, { type: "queue", name: letter.occasion || "Letter" })}>
              <Play />
            </IconButton>
          </SongRow>
        </div>
      )}
      {letter.playlist_id && <PlaylistCard id={letter.playlist_id} />}
    </div>
  );
}

function Sealed({ letter, authorName }: { letter: Letter; authorName: string }) {
  const today = todayIn(useHomeZone());
  const days = letter.unlock_date ? daysBetween(today, letter.unlock_date) : 0;
  useRefetchAt(letter.unlock_at, lettersKeys.letter(letter.id));
  return (
    <div className="mx-auto grid w-full max-w-sm grid-cols-1 gap-4 text-center">
      <div className="pt-4">
        <Envelope
          stage="sealed"
          locked
          tint={tintFor(letter.id)}
          label={letter.occasion || letter.title ? <Handwriting authorId={letter.author_id} className="text-2xl">{letter.occasion || letter.title}</Handwriting> : undefined}
        />
      </div>
      <div>
        <p className="font-display text-xl font-semibold">{unlockText(letter)}</p>
        <p className="font-bold text-muted">
          {days > 0 ? plural(days, "day") : "Today"} · {authorName}
        </p>
      </div>
    </div>
  );
}

export function LetterView({ id }: { id: string }) {
  const me = useMe().data;
  const q = useLetter(id);
  const name = useNames();
  const [replay, setReplay] = useState(0);
  const l = q.data;
  const mine = !!l && l.author_id === me?.id;
  const markOpened = async () => {
    if (!l || mine || l.locked || l.opened_at) return;
    try {
      await lettersApi.openLetter(l.id);
      void queryClient.invalidateQueries({ queryKey: lettersKeys.letters });
    } catch {
    }
  };
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-6">
      <div className="flex items-center gap-2">
        <Link href="/letters/" className="inline-flex min-h-11 items-center gap-2 rounded-button px-2 font-bold hover:bg-accent-soft/50">
          <ArrowLeft className="size-5" /> Letters
        </Link>
        {l && (
          <span className="ms-auto text-sm font-bold text-muted">
            {KIND_LABEL[l.kind]}
            {mine ? ` · ${statusOf(l)}` : ""}
          </span>
        )}
      </div>
      {q.isLoading && <Loading />}
      {q.isError && <Empty>Letter not found</Empty>}
      {l &&
        (l.locked && !mine ? (
          <Sealed letter={l} authorName={name(l.author_id)} />
        ) : (
          <LetterReveal
            letter={l}
            authorName={name(l.author_id)}
            replay={replay}
            label={l.occasion || l.title ? <Handwriting authorId={l.author_id} className="text-2xl">{l.occasion || l.title}</Handwriting> : undefined}
            onRead={() => void markOpened()}
          >
            <Attachments letter={l} />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button variant="ghost" onClick={() => setReplay((n) => n + 1)}>
                <RotateCcw className="size-5" /> Read again
              </Button>
              {mine && l.kind !== "welcome" && (
                <Link href={`/letters/?edit=${l.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-button bg-accent-soft/70 px-4 font-semibold hover:bg-accent-soft">
                  <Pencil className="size-5" /> Edit
                </Link>
              )}
            </div>
          </LetterReveal>
        ))}
    </div>
  );
}

const emptyInput = (kind: LetterInput["kind"]): LetterInput => ({
  kind,
  occasion: "",
  title: "",
  body: "",
  playlist_id: null,
  track_id: null,
  unlock_date: "",
  unlock_time: "00:00",
  status: "published",
});

const isKind = (k: string | null): k is LetterInput["kind"] => k === "standard" || k === "open_when" || k === "time_locked";

export function LetterEditor({ id, kind }: { id: string | null; kind: string | null }) {
  const router = useRouter();
  const me = useMe().data;
  const existing = useLetter(id);
  const playlists = usePlaylists();
  const hand = useHandFont(me?.id);
  const [form, setForm] = useState<LetterInput>(emptyInput(isKind(kind) ? kind : "standard"));
  const [track, setTrack] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tz = useHomeZone();
  const l = existing.data;

  useEffect(() => {
    if (!l || l.kind === "welcome") return;
    setForm({
      kind: l.kind,
      occasion: l.occasion,
      title: l.title,
      body: l.body ?? "",
      playlist_id: l.playlist_id,
      track_id: l.track_id,
      unlock_date: l.unlock_date ?? "",
      unlock_time: l.unlock_time ?? "00:00",
      status: l.status,
    });
    setTrack(l.track ?? null);
  }, [l]);

  const set = (patch: Partial<LetterInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = async (status: LetterInput["status"]) => {
    setBusy(true);
    try {
      const input = { ...form, status, track_id: track?.id ?? null };
      const saved = id ? await lettersApi.updateLetter(id, input) : await lettersApi.createLetter(input);
      refreshLetters("letters");
      toast(status === "draft" ? "Draft saved" : id && l?.status === "published" ? "Letter saved" : "Letter sent");
      router.replace(status === "draft" ? `/letters/?edit=${saved.id}` : `/letters/?id=${saved.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };

  if (id && existing.isLoading) return <Loading />;
  if (id && (!l || l.author_id !== me?.id || l.kind === "welcome")) return <Empty>Letter not found</Empty>;
  const published = l?.status === "published";
  const ready = form.body.trim() && (form.kind !== "open_when" || form.occasion.trim()) && (form.kind !== "time_locked" || form.unlock_date);
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 gap-5">
      <PageHero title={id ? (published ? "Letter" : "Draft") : "New letter"} />
      {l?.placeholder && (
        <div>
          <PlaceholderMark />
        </div>
      )}
      <Segmented
        label="Kind"
        value={form.kind}
        onChange={(k) => set({ kind: k })}
        options={[
          ["standard", "Letter"],
          ["open_when", "Open when"],
          ["time_locked", "Time-locked"],
        ]}
      />
      {form.kind !== "standard" && (
        <Field label={form.kind === "open_when" ? "Occasion" : "Label"}>
          <input dir="auto" className={inputClass} style={{ fontFamily: hand, fontSize: 22 }} value={form.occasion} maxLength={80} onChange={(e) => set({ occasion: e.target.value })} />
        </Field>
      )}
      {form.kind === "time_locked" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unlock date">
            <input type="date" className={inputClass} min={todayIn(tz)} value={form.unlock_date} onChange={(e) => set({ unlock_date: e.target.value })} />
          </Field>
          <Field label={`Unlock time (${zoneCity(tz)})`}>
            <input type="time" className={inputClass} value={form.unlock_time} onChange={(e) => set({ unlock_time: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Title">
        <input dir="auto" className={inputClass} style={{ fontFamily: hand, fontSize: 22 }} value={form.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Letter">
        <textarea
          dir="auto"
          rows={12}
          className={PAPER_FIELD}
          style={ruledField(hand)}
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </Field>
      <Field label="Song">
        <SongPicker value={track} onChange={setTrack} />
      </Field>
      <Field label="Playlist">
        <select dir="auto" className={inputClass} value={form.playlist_id ?? ""} onChange={(e) => set({ playlist_id: e.target.value || null })}>
          <option value="">None</option>
          {playlists.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap gap-2">
        {!published && (
          <Button onClick={() => void save("draft")} disabled={busy}>
            Save draft
          </Button>
        )}
        <Button variant="primary" onClick={() => void save("published")} disabled={busy || !ready}>
          {published ? "Save" : "Send"}
        </Button>
        {id && (
          <Button variant="ghost" onClick={() => setDeleting(true)} disabled={busy}>
            Delete
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this letter?"
        action="Delete"
        onConfirm={async () => {
          if (!id) return;
          try {
            await lettersApi.deleteLetter(id);
            refreshLetters("letters");
            router.replace("/letters/");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </div>
  );
}
