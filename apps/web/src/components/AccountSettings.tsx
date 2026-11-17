"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Button, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { signOut, useMe } from "@/lib/session";
import { socialApi, socialKeys, usePresence } from "@/lib/social";
import { toast } from "@/lib/toast";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-display text-xl font-semibold">{title}</h2>
      <div className="grid grid-cols-1 gap-1 rounded-card bg-surface-solid/60 p-2 shadow-soft">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="font-bold">{label}</span>
      {children}
    </div>
  );
}

const EVENTS: [string, string, boolean][] = [
  ["messages", "Messages", true],
  ["letters", "Unlocked letters", true],
  ["mixtapes", "Mixtapes", true],
  ["dates", "Calendar", true],
  ["dedications", "Dedications", false],
  ["reminders", "Reminds me of you", true],
  ["swaps", "Song swaps", false],
  ["lamp", "Lamp", false],
];

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type PushState = "unsupported" | "denied" | "off" | "on";

async function pushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  const { key } = await socialApi.pushKey();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
  await socialApi.subscribe(sub.toJSON());
}

export function AccountSettings() {
  const me = useMe().data;
  const presence = usePresence();
  const quiet = !!presence.data?.people.find((p) => p.id === me?.id)?.quiet;
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.settings()).settings });
  const notify = (settings.data?.notify ?? {}) as Record<string, boolean>;
  const [push, setPush] = useState<PushState>("off");
  useEffect(() => {
    pushState().then(setPush).catch(() => setPush("unsupported"));
  }, []);

  const setNotify = async (key: string, on: boolean) => {
    const next = { ...notify, [key]: on };
    queryClient.setQueryData<Record<string, unknown>>(["settings"], (s) => ({ ...s, notify: next }));
    try {
      await api.setSetting("notify", next);
    } catch {
      toast("Setting not saved");
    }
  };

  return (
    <>
      <Section title="Account">
        <Row label={me ? `${me.display_name} (${me.username})` : "Account"}>
          <div className="flex gap-2">
            {me?.role === "admin" && (
              <Link href="/admin/" className="inline-flex min-h-9 items-center rounded-button bg-accent-soft/70 px-3 text-sm font-semibold hover:bg-accent-soft">
                Admin
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </Row>
      </Section>
      <Section title="Notifications">
        <Row label="This device">
          {push === "on" ? (
            <span className="font-bold text-muted">On</span>
          ) : push === "denied" ? (
            <span className="font-bold text-muted">Blocked in browser settings</span>
          ) : push === "unsupported" ? (
            <span className="font-bold text-muted">Unavailable here</span>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                enablePush()
                  .then(() => setPush("on"))
                  .catch(() => {
                    toast("Notifications not turned on");
                    void pushState().then(setPush);
                  })
              }
            >
              Turn on
            </Button>
          )}
        </Row>
        <Row label="Quiet mode">
          <Switch
            label="Quiet mode"
            checked={quiet}
            onCheckedChange={(on) =>
              socialApi
                .quiet(on)
                .then(() => queryClient.invalidateQueries({ queryKey: socialKeys.presence }))
                .catch(() => toast("Quiet mode not changed"))
            }
          />
        </Row>
        {EVENTS.map(([key, label, def]) => (
          <Row key={key} label={label}>
            <Switch label={label} checked={notify[key] ?? def} onCheckedChange={(on) => void setNotify(key, on)} />
          </Row>
        ))}
      </Section>
    </>
  );
}
