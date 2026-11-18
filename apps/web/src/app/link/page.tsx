"use client";

import { Check, Copy, Headphones, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/avatar";
import { PageHero } from "@/components/sky/PageHero";
import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { pairApi, refreshPair, usePair, type PairKind } from "@/lib/pair";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";

const KINDS: { kind: PairKind; title: string; icon: typeof Heart; shares: string[] }[] = [
  { kind: "partner", title: "Partner", icon: Heart, shares: ["Chat", "Listen together", "Letters", "Notes", "Lamp", "Anniversary", "Our song"] },
  { kind: "friend", title: "Friend", icon: Headphones, shares: ["Chat", "Listen together", "Picks", "Song swap", "Daily question", "Stats"] },
];

const expiry = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

function KindCard({ k, on, onPick }: { k: (typeof KINDS)[number]; on: boolean; onPick: () => void }) {
  const Icon = k.icon;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn("grid w-full gap-3.5 rounded-card border-[1.5px] bg-surface p-4 text-start transition-colors", on ? "border-accent" : "border-line hover:border-line-strong")}
    >
      <span className="flex items-center gap-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-[14px]", on ? "bg-accent text-on-accent" : "bg-surface-2 text-ink")}>
          <Icon className="size-[22px]" />
        </span>
        <span className="flex-1 font-display text-lg">{k.title}</span>
        <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-accent" : "border-line-strong")}>
          {on && <span className="size-2.5 rounded-full bg-accent" />}
        </span>
      </span>
      <span className="flex flex-wrap gap-1.5">
        {k.shares.map((s) => (
          <span key={s} className="inline-flex h-7 items-center rounded-[10px] bg-surface-2 px-2.5 text-[12.5px] font-bold text-ink-2">
            {s}
          </span>
        ))}
      </span>
    </button>
  );
}

function InviteLink({ url, kind, expiresAt }: { url: string; kind: PairKind; expiresAt: string }) {
  const me = useMe().data;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Copy unavailable");
    }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Jobbos", url });
        return;
      } catch {
      }
    } else {
      await copy();
    }
  };
  return (
    <div className="grid gap-3">
      <div className="grid justify-items-center gap-3 rounded-card border border-line bg-surface px-4 pb-6 pt-7 text-center">
        {me && (
          <span className="flex items-center gap-2 text-[13.5px] font-extrabold text-ink-2">
            <span className="overflow-hidden rounded-full bg-surface-2">
              <Avatar userId={me.id} size={26} />
            </span>
            {me.display_name}
          </span>
        )}
        <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-extrabold text-accent-strong">
          {kind === "partner" ? "Partner" : "Friend"}
        </span>
        <code className="w-full truncate rounded-[12px] bg-surface-2 px-3 py-2.5 text-[13px] font-bold text-ink-2" dir="ltr">
          {url}
        </code>
        <span className="text-[12.5px] font-bold text-muted">Expires {expiry(expiresAt)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={() => void share()}>
          <Share2 className="size-[18px]" />
          Share link
        </Button>
        <Button onClick={() => void copy()}>
          {copied ? <Check className="size-[18px]" /> : <Copy className="size-[18px]" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

export default function LinkPage() {
  const state = usePair().data;
  const [kind, setKind] = useState<PairKind>("partner");
  const [made, setMade] = useState<{ url: string; kind: PairKind; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const { invite, path } = await pairApi.invite(kind);
      setMade({ url: `${window.location.origin}${path}`, kind, expiresAt: invite.expires_at });
      refreshPair();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Invite unavailable");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await pairApi.revoke(id);
      refreshPair();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Revoke unavailable");
    }
  };
  const partner = state?.pair?.partner;
  return (
    <>
      <PageHero title="Link with someone" />
      <div className="grid max-w-xl gap-3">
        {partner ? (
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
            <span className="overflow-hidden rounded-full bg-surface-2">
              <Avatar userId={partner.id} size={44} />
            </span>
            <span className="min-w-0 flex-1">
              <span dir="auto" className="block truncate font-extrabold">
                Linked with {partner.display_name}
              </span>
              <span className="block text-[13px] font-semibold text-muted">{state?.pair?.kind === "friend" ? "Friend" : "Partner"}</span>
            </span>
            <Link href="/settings/" className="text-[13px] font-bold text-muted hover:text-ink">
              Settings
            </Link>
          </div>
        ) : made ? (
          <InviteLink url={made.url} kind={made.kind} expiresAt={made.expiresAt} />
        ) : (
          <>
            <div role="radiogroup" aria-label="Kind" className="grid gap-2.5">
              {KINDS.map((k) => (
                <KindCard key={k.kind} k={k} on={kind === k.kind} onPick={() => setKind(k.kind)} />
              ))}
            </div>
            <Button variant="primary" className="mt-2 h-[52px] text-[15px]" onClick={() => void create()} disabled={busy || !state}>
              Make invite link
            </Button>
          </>
        )}
        {!partner && !!state?.invites.length && (
          <section className="mt-6">
            <h2 className="mb-2 font-display text-xl">Open invites</h2>
            <ul className="grid gap-2">
              {state.invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold">{inv.link_kind === "friend" ? "Friend" : "Partner"}</span>
                    <span className="block text-[13px] font-semibold text-muted">
                      {inv.status === "declined" ? "Declined" : "Pending"} · expires {expiry(inv.expires_at)}
                    </span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void revoke(inv.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
