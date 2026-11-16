"use client";

import { useState } from "react";

import { AuthCard, FormError, onSubmit, TextInput } from "@/components/AuthCard";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { nextPath } from "@/lib/session";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api.login(username, password);
      window.location.assign(nextPath());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Sign in">
      <form onSubmit={onSubmit(submit)} className="grid gap-4">
        <TextInput id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" />
        <TextInput id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <FormError>{error}</FormError>
        <Button type="submit" variant="primary" disabled={busy}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
