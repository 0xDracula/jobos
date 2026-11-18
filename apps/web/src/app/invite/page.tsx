"use client";

import { useEffect, useState } from "react";

import { AuthCard, FormError, onSubmit, TextInput, tokenFromPath } from "@/components/AuthCard";
import { Button, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { pairApi } from "@/lib/pair";
import type { InviteView } from "@/lib/types";

type Stage = "loading" | "invalid" | "invite" | "form" | "declined";

export default function InvitePage() {
  const [token, setToken] = useState("");
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("partner");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<string | null>(null);

  useEffect(() => {
    const t = tokenFromPath("invite");
    setToken(t);
    if (!t) {
      setStage("invalid");
      return;
    }
    api
      .invite(t)
      .then(({ invite }) => {
        setInvite(invite);
        setDisplayName(invite.display_name);
        setUsername(invite.link_kind ? invite.username : invite.username || "partner");
        if (invite.link_kind) {
          api
            .me()
            .then(({ user }) => setSignedIn(user.display_name))
            .catch(() => setSignedIn(null));
        }
        setStage(invite.status === "declined" ? "declined" : "invite");
      })
      .catch(() => setStage("invalid"));
  }, []);

  const decline = async () => {
    setBusy(true);
    try {
      await api.declineInvite(token);
      setStage("declined");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.acceptInvite(token, { display_name: displayName.trim(), username: username.trim().toLowerCase(), password });
      window.location.assign("/?welcome=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
      setBusy(false);
    }
  };

  const linkAsMe = async () => {
    setBusy(true);
    setError("");
    try {
      await pairApi.link(token);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
      setBusy(false);
    }
  };

  if (stage === "loading") {
    return (
      <AuthCard title="Invite">
        <Spinner />
      </AuthCard>
    );
  }
  if (stage === "invalid") {
    return (
      <AuthCard title="Invite">
        <p className="font-semibold text-muted">This link isn&apos;t valid anymore.</p>
      </AuthCard>
    );
  }
  if (stage === "form") {
    return (
      <AuthCard title="Your account">
        <form onSubmit={onSubmit(accept)} className="grid gap-4">
          <TextInput id="display-name" label="Display name" value={displayName} onChange={setDisplayName} autoComplete="nickname" dir="auto" />
          <TextInput id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" />
          <TextInput id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <TextInput id="confirm" label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <FormError>{error}</FormError>
          <Button type="submit" variant="primary" disabled={busy}>
            Create account
          </Button>
        </form>
      </AuthCard>
    );
  }
  const kind = invite?.link_kind;
  const title = kind ? `Invite from ${invite?.from?.display_name ?? "someone"}` : invite?.display_name ? `For ${invite.display_name}` : "Invite";
  return (
    <AuthCard title={title}>
      {kind && (
        <p className="-mt-2 mb-5">
          <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2.5 text-xs font-extrabold text-accent-strong">
            {kind === "partner" ? "Partner" : "Friend"}
          </span>
        </p>
      )}
      {invite?.message && (
        <p dir="auto" className="mb-5 whitespace-pre-line font-hand text-[22px] leading-snug">
          {invite.message}
        </p>
      )}
      {stage === "declined" && <p className="mb-4 rounded-button bg-surface-solid px-3 py-2 text-sm font-bold text-muted">Declined</p>}
      <FormError>{error}</FormError>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => setStage("form")} disabled={busy}>
          Accept
        </Button>
        {stage === "invite" && (
          <Button variant="ghost" onClick={decline} disabled={busy}>
            Decline
          </Button>
        )}
      </div>
      {kind && (
        <div className="mt-4 border-t border-line pt-4 text-center">
          {signedIn ? (
            <Button className="w-full" onClick={() => void linkAsMe()} disabled={busy}>
              Link as {signedIn}
            </Button>
          ) : (
            <a href={`/login/?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-sm font-extrabold text-muted hover:text-ink">
              Log in instead
            </a>
          )}
        </div>
      )}
    </AuthCard>
  );
}
