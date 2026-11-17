"use client";

import { Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useHandFont } from "@/components/letters/Handwriting";
import { PAPER_FIELD, ruledField } from "@/components/letters/Paper";
import { replayWelcome } from "@/components/letters/stores";
import { PlaceholderMark } from "@/components/PlaceholderMark";
import { Button, Field, IconButton, Spinner, inputClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtBytes, plural } from "@/lib/format";
import { lettersApi, lettersKeys, refreshLetters, useAdminLetters, type HandwritingFont } from "@/lib/letters";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { User } from "@/lib/types";

import { Line, Panel } from "../parts";

function WelcomeLetter() {
  const me = useMe().data;
  const q = useAdminLetters();
  const hand = useHandFont(me?.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const w = q.data?.welcome;
  useEffect(() => {
    setTitle(w?.title ?? "");
    setBody(w?.body ?? "");
  }, [w]);
  const save = async () => {
    setBusy(true);
    try {
      await lettersApi.setWelcome(title, body);
      refreshLetters("welcome", "letters");
      toast("Welcome letter saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Welcome letter"
      action={
        <span className="flex items-center gap-2 text-sm font-bold text-muted">
          {w?.placeholder && <PlaceholderMark />}
          {w ? (w.opened_at ? `Opened ${new Date(w.opened_at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}` : "Unopened") : null}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 p-1">
        <Field label="Title">
          <input dir="auto" className={inputClass} style={{ fontFamily: hand, fontSize: 22 }} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Letter">
          <textarea
            dir="auto"
            rows={10}
            className={PAPER_FIELD}
            style={ruledField(hand)}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy || !body.trim()}>
            Save welcome letter
          </Button>
          <Button onClick={replayWelcome} disabled={!w}>
            Preview
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function DailyNotes() {
  const q = useAdminLetters();
  const members = useMembers();
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const rows = q.data?.daily_left ?? [];
  return (
    <Panel
      title="Daily notes"
      action={
        <Link href="/jar/" className="text-sm font-bold text-accent-strong">
          Note jar
        </Link>
      }
    >
      {!rows.length && <Line label="Unopened">0</Line>}
      {rows.map((r) => (
        <Line key={r.author_id} label={`From ${name(r.author_id)}`} sub={r.placeholders ? plural(r.placeholders, "placeholder") : undefined}>
          <span className="tabular font-display text-2xl font-semibold">{r.left}</span>
        </Line>
      ))}
    </Panel>
  );
}

function FontSample({ user }: { user: User }) {
  const family = useHandFont(user.id);
  return (
    <span dir="auto" className="block truncate text-[26px] leading-tight" style={{ fontFamily: family }}>
      {user.display_name} · Aa Bb Cc 123 · أبجد
    </span>
  );
}

function FontRow({ user, font }: { user: User; font: HandwritingFont | undefined }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      await lettersApi.uploadFont(user.id, file);
      refreshLetters("fonts");
      toast("Font uploaded");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not uploaded");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await lettersApi.deleteFont(user.id);
      refreshLetters("fonts");
    } catch {
      toast("Not removed");
    }
  };
  const status =
    font?.status === "ready"
      ? [font.family ?? font.original_name, font.glyphs ? plural(font.glyphs, "glyph") : "", font.bytes ? fmtBytes(font.bytes) : ""].filter(Boolean).join(" · ")
      : font?.status === "processing"
        ? "Processing"
        : font?.status === "failed"
          ? `Failed${font.error ? `: ${font.error}` : ""}`
          : "Caveat";
  return (
    <div className="grid grid-cols-1 gap-2 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold">{user.display_name}</div>
          <div className={cn("text-sm font-semibold", font?.status === "failed" ? "text-danger" : "text-muted")}>{status}</div>
        </div>
        <div className="flex items-center gap-1">
          {(busy || font?.status === "processing") && <Spinner className="size-5 text-muted" />}
          <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
            <Upload className="size-4" /> TTF or OTF
          </Button>
          {font && (
            <IconButton label={`Remove ${user.display_name}'s font`} size="sm" onClick={() => void remove()}>
              <X />
            </IconButton>
          )}
          <input
            ref={input}
            type="file"
            accept=".ttf,.otf,font/ttf,font/otf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <FontSample user={user} />
    </div>
  );
}

function Fonts() {
  const q = useAdminLetters();
  const members = useMembers();
  const processing = q.data?.fonts.some((f) => f.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void queryClient.invalidateQueries({ queryKey: lettersKeys.admin }), 2000);
    return () => clearInterval(t);
  }, [processing]);
  useEffect(() => {
    if (!processing) refreshLetters("fonts");
  }, [processing]);
  return (
    <Panel title="Handwriting fonts">
      {members.data?.map((u) => (
        <FontRow key={u.id} user={u} font={q.data?.fonts.find((f) => f.user_id === u.id)} />
      ))}
    </Panel>
  );
}

const PLACEHOLDER_KINDS: [string, string, string][] = [
  ["welcome", "Welcome letter", "/admin/#gift"],
  ["letters", "Letters", "/letters/?tab=written"],
  ["notes:daily", "Daily notes", "/jar/"],
  ["notes:morning", "Morning notes", "/jar/"],
  ["notes:night", "Night notes", "/jar/"],
  ["promises", "Promises", "/promises/"],
  ["picks", "Picks", "/song-of-the-day/"],
  ["songs_of_the_day", "Songs of the day", "/song-of-the-day/"],
];

function LetterPlaceholders() {
  const q = useAdminLetters();
  const counts = q.data?.placeholders ?? {};
  const left = Object.values(counts).reduce((n, c) => n + c, 0);
  return (
    <Panel title="Letters and notes placeholders" action={<span className="tabular text-sm font-bold text-muted">{left} left</span>}>
      {PLACEHOLDER_KINDS.filter(([k]) => counts[k]).map(([k, label, href]) => (
        <Line key={k} label={label}>
          <Link href={href} className="tabular text-sm font-bold text-accent-strong">
            {counts[k]}
          </Link>
        </Line>
      ))}
      {!left && <Line label="None left" />}
    </Panel>
  );
}

export function LettersAdmin() {
  return (
    <>
      <WelcomeLetter />
      <DailyNotes />
      <Fonts />
      <LetterPlaceholders />
    </>
  );
}
