"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { adminApi, adminKeys } from "@/lib/admin";
import { api } from "@/lib/api";
import { fmtMs } from "@/lib/format";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Invite } from "@/lib/types";

import { ConfirmDialog, Dialog } from "../dialogs";
import { Artwork } from "../media";
import { Button, Empty, Field, Segmented, inputClass } from "../ui";

import { ListeningTimeline } from "./Listening";
import { LinkDialog, Line, Panel, when } from "./parts";

const SIGNALS: Record<string, string> = {
  online_last_seen: "Online status and last seen",
  listening_status: "Listening status",
  listening_history: "Listening history",
  read_receipts: "Read receipts",
  typing: "Typing",
};

const STATUS_LABEL: Record<Invite["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  revoked: "Revoked",
};

const absolute = (path: string) => `${window.location.origin}${path}`;

function Accounts() {
  const accounts = useQuery({ queryKey: adminKeys.accounts, queryFn: async () => (await api.adminAccounts()).accounts });
  const [link, setLink] = useState<string | null>(null);
  const [signOut, setSignOut] = useState<{ id: string; name: string } | null>(null);
  const resetLink = async (id: string) => {
    try {
      const r = await api.adminResetLink(id);
      setLink(absolute(r.path));
    } catch {
      toast("Link not created");
    }
  };
  return (
    <Panel title="Accounts">
      {accounts.data?.map((a) => (
        <Line
          key={a.id}
          label={`${a.display_name} (${a.username})`}
          sub={`${a.role === "admin" ? "Admin" : "Member"} · last seen ${when(a.last_seen_at)} · ${a.sessions} sessions`}
        >
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void resetLink(a.id)}>
              Reset link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSignOut({ id: a.id, name: a.display_name })}>
              Sign out everywhere
            </Button>
          </div>
        </Line>
      ))}
      <LinkDialog link={link} title="Password reset link" onClose={() => setLink(null)} />
      <ConfirmDialog
        open={!!signOut}
        onOpenChange={(o) => !o && setSignOut(null)}
        title={`Sign out ${signOut?.name ?? ""} everywhere?`}
        action="Sign out"
        onConfirm={async () => {
          if (!signOut) return;
          try {
            const r = await api.adminSignOut(signOut.id);
            toast(`Sessions ended: ${r.revoked}`);
            void queryClient.invalidateQueries({ queryKey: adminKeys.accounts });
          } catch {
            toast("Not signed out");
          }
        }}
      />
    </Panel>
  );
}

function Invites() {
  const invites = useQuery({ queryKey: adminKeys.invites, queryFn: async () => (await api.adminInvites()).invites });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ display_name: "Partner", username: "partner", message: "" });
  const [link, setLink] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: adminKeys.invites });
  const create = async () => {
    try {
      const r = await api.createInvite(form);
      setOpen(false);
      setLink(absolute(r.path));
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Invite not created");
    }
  };
  const act = async (fn: () => Promise<unknown>, failed: string) => {
    try {
      const r = (await fn()) as { path?: string } | null;
      if (r?.path) setLink(absolute(r.path));
      refresh();
    } catch {
      toast(failed);
    }
  };
  return (
    <Panel
      title="Invites"
      action={
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
          New invite
        </Button>
      }
    >
      {!invites.data?.length && <Empty>No invites</Empty>}
      {invites.data?.map((i) => (
        <Line
          key={i.id}
          label={`${i.display_name} (${i.username})`}
          sub={`${STATUS_LABEL[i.status]} · created ${when(i.created_at)} · expires ${when(i.expires_at)}`}
        >
          <div className="flex gap-2">
            {(i.status === "pending" || i.status === "expired") && (
              <Button size="sm" onClick={() => void act(() => api.regenerateInvite(i.id), "Link not created")}>
                New link
              </Button>
            )}
            {i.status === "pending" && (
              <Button size="sm" variant="ghost" onClick={() => void act(() => api.revokeInvite(i.id), "Not revoked")}>
                Revoke
              </Button>
            )}
          </div>
        </Line>
      ))}
      <Dialog open={open} onOpenChange={setOpen} title="New invite">
        <div className="grid gap-3">
          <Field label="Display name">
            <input className={inputClass} dir="auto" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <Field label="Username">
            <input className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Message">
            <textarea
              dir="auto"
              rows={4}
              className={`${inputClass} py-3`}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </Field>
          <Button variant="primary" onClick={() => void create()} disabled={!form.display_name.trim() || !form.username.trim()}>
            Create invite
          </Button>
        </div>
      </Dialog>
      <LinkDialog link={link} title="Invite link" onClose={() => setLink(null)} />
    </Panel>
  );
}

function Visibility() {
  const v = useQuery({ queryKey: adminKeys.visibility, queryFn: adminApi.visibility });
  const modes = v.data?.visibility ?? {};
  const set = async (signal: string, mode: string) => {
    const next = { ...modes, [signal]: mode };
    queryClient.setQueryData(adminKeys.visibility, { visibility: next, signals: v.data?.signals ?? [] });
    try {
      await adminApi.setVisibility(next);
    } catch {
      toast("Visibility not saved");
      void v.refetch();
    }
  };
  return (
    <Panel title="Visibility">
      {(v.data?.signals ?? Object.keys(SIGNALS)).map((s) => (
        <Line key={s} label={SIGNALS[s] ?? s}>
          <Segmented
            label={SIGNALS[s] ?? s}
            value={modes[s] ?? "off"}
            onChange={(m) => void set(s, m)}
            options={
              s === "typing"
                ? [
                    ["shared", "Both"],
                    ["off", "Off"],
                  ]
                : [
                    ["shared", "Both"],
                    ["admin", "Admin"],
                    ["off", "Off"],
                  ]
            }
          />
        </Line>
      ))}
    </Panel>
  );
}

function PlayingNow() {
  const q = useQuery({ queryKey: adminKeys.listening, queryFn: adminApi.listening, refetchInterval: 15_000 });
  const accounts = useQuery({ queryKey: adminKeys.accounts, queryFn: async () => (await api.adminAccounts()).accounts });
  const name = (id: string) => accounts.data?.find((a) => a.id === id)?.display_name ?? "Someone";
  return (
    <Panel title="Playing now">
      {!q.data?.playing.length && <Empty>Nothing playing</Empty>}
      {q.data?.playing.map((p) => {
        const t = q.data.tracks.find((x) => x.id === p.track_id);
        return (
          <div key={p.user_id} className="flex items-center gap-3 px-2 py-1.5">
            <Artwork src={t?.artwork_thumb_url ?? null} className="size-11 shrink-0 rounded-chip" />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate font-bold">
                {t ? `${t.title} · ${t.artists.join(", ")}` : "Unknown song"}
              </p>
              <p className="truncate text-sm font-semibold text-muted">
                {name(p.user_id)} · {p.device_name} · {fmtMs(p.position_ms)}
              </p>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}

export function People() {
  return (
    <>
      <PlayingNow />
      <ListeningTimeline />
      <Accounts />
      <Invites />
      <Visibility />
    </>
  );
}
