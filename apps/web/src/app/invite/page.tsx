"use client";

import { useEffect, useState } from "react";

import { AuthCard, FormError, onSubmit, TextInput, tokenFromPath } from "@/components/AuthCard";
import { Button, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
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
        setUsername(invite.username || "partner");
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
  return (
    <AuthCard title={invite?.display_name ? `For ${invite.display_name}` : "Invite"}>
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
    </AuthCard>
  );
}
