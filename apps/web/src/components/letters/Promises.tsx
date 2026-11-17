"use client";

import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Loading } from "@/components/common";
import { ConfirmDialog, Dialog } from "@/components/dialogs";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Empty, Field, IconButton, SectionTitle, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { lettersApi, refreshLetters, useHomeZone, usePromises, type PromiseEntry } from "@/lib/letters";
import { formatDay, todayIn } from "@/lib/paper";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

import { Handwriting, useHandFont } from "./Handwriting";

const panel = "rounded-[10px] border-2 border-b-[5px] border-panel-line bg-panel";

function PromiseRow({ p, mine, onEdit, onDelete }: { p: PromiseEntry; mine: boolean; onEdit: () => void; onDelete: () => void }) {
  const tz = useHomeZone();
  const kept = !!p.kept_on;
  const toggle = async () => {
    try {
      await lettersApi.updatePromise(p.id, p.body, kept ? null : todayIn(tz));
      refreshLetters("promises");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    }
  };
  const mark = (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full border-2",
        kept ? "border-transparent bg-sage text-[#2f4a2a]" : "border-panel-line text-transparent",
      )}
    >
      <Check className="size-4" strokeWidth={3} />
    </span>
  );
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      {mine ? (
        <button type="button" onClick={() => void toggle()} aria-pressed={kept} aria-label={kept ? "Kept" : "Mark kept"} title={kept ? "Kept" : "Mark kept"} className="mt-0.5 rounded-full">
          {mark}
        </button>
      ) : (
        <span className="mt-0.5" aria-label={kept ? "Kept" : "Not kept"}>
          {mark}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Handwriting authorId={p.author_id} className={cn("whitespace-pre-wrap text-[22px] leading-snug", kept && "opacity-75")}>
          {p.body}
        </Handwriting>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-bold text-muted">
          {kept && p.kept_on ? `Kept ${formatDay(p.kept_on)}` : null}
          {p.placeholder && <PlaceholderMark />}
        </p>
      </div>
      {mine && (
        <div className="flex shrink-0">
          <IconButton label="Edit" size="sm" onClick={onEdit}>
            <Pencil />
          </IconButton>
          <IconButton label="Delete" size="sm" onClick={onDelete}>
            <Trash2 />
          </IconButton>
        </div>
      )}
    </li>
  );
}

function PromiseForm({ initial, onSave, action }: { initial: { body: string; kept_on: string | null }; onSave: (body: string, keptOn: string | null) => Promise<void>; action: string }) {
  const me = useMe().data;
  const hand = useHandFont(me?.id);
  const [body, setBody] = useState(initial.body);
  const [kept, setKept] = useState(initial.kept_on ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-3">
      <Field label="Promise">
        <textarea dir="auto" rows={3} maxLength={2000} className={cn(inputClass, "py-3")} style={{ fontFamily: hand, fontSize: 22, lineHeight: 1.35 }} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="Kept on">
        <input type="date" className={cn(inputClass, "w-48")} value={kept} onChange={(e) => setKept(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        disabled={busy || !body.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave(body, kept || null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {action}
      </Button>
    </div>
  );
}

export function PromisesPage() {
  const me = useMe().data;
  const members = useMembers();
  const q = usePromises();
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<PromiseEntry | null>(null);
  const [removing, setRemoving] = useState<PromiseEntry | null>(null);
  const list = q.data ?? [];
  const kept = list.filter((p) => p.kept_on).length;
  const people = [...(members.data ?? [])].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
  return (
    <>
      <PageHero title="Promises" meta={q.data ? `${kept} of ${list.length} kept` : undefined}>
        <Button variant="primary" onClick={() => setWriting(true)}>
          <Plus className="size-5" /> New promise
        </Button>
      </PageHero>
      {q.isLoading && <Loading />}
      {q.data && !list.length && <Empty>No promises</Empty>}
      <div className="grid grid-cols-1 gap-8">
        {people.map((u) => {
          const theirs = list.filter((p) => p.author_id === u.id);
          if (!theirs.length) return null;
          return (
            <section key={u.id}>
              <SectionTitle>{u.id === me?.id ? "Yours" : u.display_name}</SectionTitle>
              <ul className={cn(panel, "divide-y divide-panel-line")}>
                {theirs.map((p) => (
                  <PromiseRow key={p.id} p={p} mine={p.author_id === me?.id} onEdit={() => setEditing(p)} onDelete={() => setRemoving(p)} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <Dialog open={writing} onOpenChange={setWriting} title="New promise">
        <PromiseForm
          initial={{ body: "", kept_on: null }}
          action="Add promise"
          onSave={async (body, keptOn) => {
            try {
              await lettersApi.createPromise(body, keptOn);
              refreshLetters("promises");
              setWriting(false);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Not saved");
            }
          }}
        />
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Promise">
        {editing && (
          <PromiseForm
            key={editing.id}
            initial={{ body: editing.body, kept_on: editing.kept_on }}
            action="Save promise"
            onSave={async (body, keptOn) => {
              try {
                await lettersApi.updatePromise(editing.id, body, keptOn);
                refreshLetters("promises");
                setEditing(null);
              } catch (e) {
                toast(e instanceof Error ? e.message : "Not saved");
              }
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this promise?"
        action="Delete"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await lettersApi.deletePromise(removing.id);
            refreshLetters("promises");
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </>
  );
}
