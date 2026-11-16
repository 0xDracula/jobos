"use client";

import { useEffect, useState } from "react";

import { AuthCard, FormError, onSubmit, TextInput, tokenFromPath } from "@/components/AuthCard";
import { Button, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

export default function ResetPage() {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = tokenFromPath("reset");
    setToken(t);
    if (!t) {
      setInvalid(true);
      return;
    }
    api
      .reset(t)
      .then((r) => setUsername(r.username))
      .catch(() => setInvalid(true));
  }, []);

  const save = async () => {
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.useReset(token, password);
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <AuthCard title="New password">
        <p className="font-semibold text-muted">This link isn&apos;t valid anymore.</p>
      </AuthCard>
    );
  }
  if (username === null) {
    return (
      <AuthCard title="New password">
        <Spinner />
      </AuthCard>
    );
  }
  return (
    <AuthCard title="New password">
      <form onSubmit={onSubmit(save)} className="grid gap-4">
        <p className="font-semibold text-muted">{username}</p>
        <TextInput id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <TextInput id="confirm" label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" disabled={busy}>
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}
