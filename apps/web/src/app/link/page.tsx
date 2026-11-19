"use client";

import { Check, Copy, Heart, Link2, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/avatar";
import { PageHero } from "@/components/sky/PageHero";
import { Button, Segmented } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { pairApi, refreshPair, usePair, type PairKind } from "@/lib/pair";
import { useIsAdmin, useMe } from "@/lib/session";
import { toast } from "@/lib/toast";

const KINDS: Record<PairKind, { title: string; icon: typeof Heart; shares: string[] }> = {
  friend: { title: "Friends", icon: Link2, shares: ["Follow each other", "Chat", "Jams", "Activity"] },
  partner: { title: "Partner", icon: Heart, shares: ["Us", "Letters", "Notes", "Lamp", "Anniversary", "Our song"] },
};

const expiry = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

function Shares({ kind }: { kind: PairKind }) {
  const k = KINDS[kind];
  const Icon = k.icon;
  return (
    <div className="grid gap-3.5 rounded-card border border-line bg-surface p-4">
      <span className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent-strong">
          <Icon className="size-[22px]" />
        </span>
        <span className="font-display text-lg">{k.title}</span>
      </span>
      <ul className="flex flex-wrap gap-1.5">
        {k.shares.map((x) => (
          <li key={x} className="inline-flex h-7 items-center rounded-[10px] bg-surface-2 px-2.5 text-[12.5px] font-bold text-ink-2">
            {x}
          </li>
        ))}
      </ul>
    </div>
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
        {kind === "partner" && (
          <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-extrabold text-accent-strong">Partner</span>
        )}
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
  const admin = useIsAdmin();
  const [kind, setKind] = useState<PairKind>("friend");
  const [made, setMade] = useState<{ url: string; kind: PairKind; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const partner = state?.pair?.partner;
  const choose = admin && !partner;
  const pick = choose ? kind : "friend";
  const create = async () => {
    setBusy(true);
    try {
      const { invite, path } = await pairApi.invite(pick);
      setMade({ url: `${window.location.origin}${path}`, kind: pick, expiresAt: invite.expires_at });
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
  return (
    <div className="max-w-xl">
      <PageHero title="Link with someone" />
      <div className="grid gap-3">
        {partner && (
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
        )}
        {made ? (
          <InviteLink url={made.url} kind={made.kind} expiresAt={made.expiresAt} />
        ) : (
          <>
            {choose && (
              <Segmented<PairKind>
                label="Kind"
                full
                value={kind}
                onChange={setKind}
                options={[
                  ["friend", "Friends"],
                  ["partner", "Partner"],
                ]}
              />
            )}
            <Shares kind={pick} />
            <Button variant="primary" className="mt-1 h-[52px] text-[15px]" onClick={() => void create()} disabled={busy || !state}>
              Make invite link
            </Button>
          </>
        )}
        {!!state?.invites.length && (
          <section className="mt-6">
            <h2 className="mb-2 font-display text-xl">Open invites</h2>
            <ul className="grid gap-2">
              {state.invites.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold">{inv.link_kind === "partner" ? "Partner link" : "Invite link"}</span>
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
    </div>
  );
}
