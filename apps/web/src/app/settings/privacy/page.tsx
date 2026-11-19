"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { SwitchRow } from "@/components/friends/sheets";
import { Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePair } from "@/lib/pair";
import { peopleApi, peopleKeys, useFollowRequests, usePrivacy, type Privacy } from "@/lib/people";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";

const PRIVATE_SESSION_HOURS = 6;

export default function PrivacyPage() {
  const router = useRouter();
  const q = usePrivacy();
  const requests = useFollowRequests().data ?? [];
  const p = q.data;
  const partnered = !!usePair().data?.pair?.partner;
  const save = async (patch: Partial<Privacy> & { private_session_hours?: number }) => {
    if (!p) return;
    const next = { ...p, ...patch };
    queryClient.setQueryData(peopleKeys.privacy, next);
    try {
      queryClient.setQueryData(peopleKeys.privacy, await peopleApi.setPrivacy(next));
    } catch (err) {
      queryClient.setQueryData(peopleKeys.privacy, p);
      toast(err instanceof ApiError ? err.message : "Not saved");
    }
  };
  const sessionOn = !!p?.private_session_until && Date.parse(p.private_session_until) > Date.now();
  return (
    <div className="mx-auto grid max-w-xl gap-6 pb-10">
      <div className="flex items-center gap-2">
        <IconBack onClick={() => router.back()} />
        <h1 className="font-display text-[28px] leading-tight">Privacy</h1>
      </div>
      {!p ? (
        <p className="py-6 text-center font-semibold text-muted">{q.isError ? "Privacy unavailable" : "Loading"}</p>
      ) : (
        <>
          <Group title="Profile">
            <Choice title="Public" meta="Anyone on Jobbos" on={!p.private} onPick={() => void save({ private: false })} />
            <Choice title="Private" meta="Followers you approve" on={p.private} onPick={() => void save({ private: true })} />
            {p.private && (
              <Link href="/friends/?tab=people" className="flex min-h-14 items-center justify-between gap-3">
                <span className="font-extrabold">Follow requests</span>
                <span className="flex items-center gap-2 text-sm font-bold text-muted tabular-nums">
                  {requests.length}
                  <ChevronRight className="size-5" />
                </span>
              </Link>
            )}
          </Group>
          <Group title="Listening activity">
            <div className="py-3">
              <Segmented<Privacy["activity_audience"]>
                label="Listening activity"
                value={p.activity_audience}
                onChange={(v) => void save({ activity_audience: v })}
                full
                options={[
                  ["followers", "Followers"],
                  ["friends", "Friends"],
                  ...(partnered || p.activity_audience === "partner" ? [["partner", "Partner"] as [Privacy["activity_audience"], string]] : []),
                  ["none", "No one"],
                ]}
              />
            </div>
          </Group>
          <Group title="More">
            <div className="flex min-h-14 items-center justify-between gap-3">
              <span>
                <span className="block font-extrabold">Private session</span>
                <span className="block text-[13px] font-semibold text-muted">
                  {sessionOn ? `Until ${new Date(p.private_session_until!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Off"}
                </span>
              </span>
              <SwitchOnly label="Private session" checked={sessionOn} onChange={(v) => void save({ private_session_hours: v ? PRIVATE_SESSION_HOURS : 0 })} />
            </div>
            <Row label="Messages from">
              <Segmented<Privacy["messages_from"]>
                label="Messages from"
                value={p.messages_from}
                onChange={(v) => void save({ messages_from: v })}
                options={[
                  ["friends", "Friends"],
                  ["everyone", "Everyone"],
                ]}
              />
            </Row>
            <Row label="Jam invites from">
              <Segmented<Privacy["jam_invites_from"]>
                label="Jam invites from"
                value={p.jam_invites_from}
                onChange={(v) => void save({ jam_invites_from: v })}
                options={[
                  ["friends", "Friends"],
                  ["everyone", "Everyone"],
                ]}
              />
            </Row>
            <SwitchRow label="Show in search" checked={p.searchable} onChange={(v) => void save({ searchable: v })} />
          </Group>
        </>
      )}
    </div>
  );
}

function IconBack({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Back" onClick={onClick} className="grid size-11 place-items-center rounded-full hover:bg-surface-2">
      <ArrowLeft className="size-[22px]" />
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13.5px] font-extrabold text-muted">{title}</h2>
      <div className="divide-y divide-line rounded-card border border-line bg-surface px-4">{children}</div>
    </section>
  );
}

function Choice({ title, meta, on, onPick }: { title: string; meta: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className="flex min-h-14 w-full items-center justify-between gap-3 py-2.5 text-start">
      <span>
        <span className="block font-extrabold">{title}</span>
        <span className="block text-[13px] font-semibold text-muted">{meta}</span>
      </span>
      <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-accent" : "border-line-strong")}>
        {on && <span className="size-2.5 rounded-full bg-accent" />}
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2">
      <span className="font-extrabold">{label}</span>
      {children}
    </div>
  );
}

function SwitchOnly({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-3")}
    >
      <span className={cn("absolute top-0.5 block size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}
