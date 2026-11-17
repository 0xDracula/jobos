"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { AvatarEditor } from "@/avatar";
import { AccountSettings } from "@/components/AccountSettings";
import { PageHero } from "@/components/sky/PageHero";
import { ConfirmDialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Button, Empty, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { deviceName, isIOS } from "@/lib/device";
import { install, useInstall } from "@/lib/install";
import { fmtBytes } from "@/lib/format";
import { refreshUsage, removeAllDownloads, useOffline } from "@/lib/offline";
import { usePrefs, type MotionPref, type Theme } from "@/lib/prefs";
import { keys, useHide } from "@/lib/queries";
import { SHORTCUTS } from "@/player/shortcuts";
import { LocationSettings, RoomPrefs } from "@/room/ui/RoomSettings";

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

function Downloads() {
  const entries = useOffline((s) => s.entries);
  const usage = useOffline((s) => s.usage);
  const quota = useOffline((s) => s.quota);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => void refreshUsage(), []);
  const list = Object.values(entries);
  const bytes = list.reduce((sum, e) => sum + e.bytes, 0);
  return (
    <Section title="Downloads">
      <Row label="Downloaded songs">
        <span className="tabular font-bold text-muted">
          {list.length} · {fmtBytes(bytes)}
        </span>
      </Row>
      {usage != null && quota != null && (
        <Row label="Storage used">
          <span className="tabular font-bold text-muted">
            {fmtBytes(usage)} of {fmtBytes(quota)}
          </span>
        </Row>
      )}
      <Row label="Remove downloads">
        <Button variant="soft" size="sm" disabled={!list.length} onClick={() => setConfirm(true)}>
          Remove all
        </Button>
      </Row>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove all downloads?"
        action="Remove"
        onConfirm={() => void removeAllDownloads()}
      />
    </Section>
  );
}

function Hidden() {
  const hidden = useQuery({ queryKey: keys.hidden, queryFn: api.hidden });
  const hide = useHide();
  const qc = useQueryClient();
  const unhide = (type: "track" | "artist", id: string, label: string) => {
    hide(type, id, false, label);
    void qc.invalidateQueries({ queryKey: keys.hidden });
  };
  const tracks = hidden.data?.tracks ?? [];
  const artists = hidden.data?.artists ?? [];
  return (
    <Section title="Hidden">
      {!tracks.length && !artists.length && <Empty>Nothing hidden</Empty>}
      {artists.map((a) => (
        <div key={a.id} className="flex items-center gap-3 px-2 py-1.5">
          <Artwork src={a.image_url} className="size-11 shrink-0 rounded-full" />
          <span dir="auto" className="min-w-0 flex-1 truncate font-bold">
            {a.name}
          </span>
          <span className="text-sm font-semibold text-muted">Artist</span>
          <Button size="sm" onClick={() => unhide("artist", a.id, a.name)}>
            Unhide
          </Button>
        </div>
      ))}
      {tracks.map((t) => (
        <div key={t.id} className="flex items-center gap-3 px-2 py-1.5">
          <Artwork src={t.artwork_thumb_url} className="size-11 shrink-0 rounded-chip" />
          <span className="min-w-0 flex-1">
            <span dir="auto" className="block truncate font-bold">
              {t.title}
            </span>
            <span dir="auto" className="block truncate text-sm font-semibold text-muted">
              {t.artists.join(", ")}
            </span>
          </span>
          <Button size="sm" onClick={() => unhide("track", t.id, t.title)}>
            Unhide
          </Button>
        </div>
      ))}
    </Section>
  );
}

function App() {
  const prompt = useInstall((s) => s.prompt);
  const installed = useInstall((s) => s.installed);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIOS()), []);
  return (
    <Section title="App">
      <Row label="Install">
        {installed ? (
          <span className="font-bold text-muted">Installed</span>
        ) : prompt ? (
          <Button variant="primary" size="sm" onClick={() => void install()}>
            Install
          </Button>
        ) : ios ? (
          <span className="font-bold text-muted">Share → Add to Home Screen</span>
        ) : (
          <span className="font-bold text-muted">Browser menu → Install</span>
        )}
      </Row>
    </Section>
  );
}

export default function SettingsPage() {
  const theme = usePrefs((p) => p.theme);
  const motion = usePrefs((p) => p.motion);
  const set = usePrefs((p) => p.set);
  const [device, setDevice] = useState("");
  useEffect(() => setDevice(deviceName()), []);
  return (
    <>
      <PageHero title="Settings" />
      <div className="lg:columns-2 lg:gap-8 [&>*]:break-inside-avoid">
      <AccountSettings />
      <AvatarEditor />
      <Section title="Appearance">
        <Row label="Theme">
          <Segmented<Theme>
            label="Theme"
            value={theme}
            onChange={(v) => set({ theme: v })}
            options={[
              ["auto", "Auto"],
              ["day", "Day"],
              ["night", "Night"],
            ]}
          />
        </Row>
        <Row label="Motion">
          <Segmented<MotionPref>
            label="Motion"
            value={motion}
            onChange={(v) => set({ motion: v })}
            options={[
              ["system", "System"],
              ["reduced", "Reduced"],
              ["full", "Full"],
            ]}
          />
        </Row>
      </Section>
      <LocationSettings />
      <RoomPrefs />
      <App />
      <Downloads />
      <Hidden />
      <Section title="Keyboard shortcuts">
        <dl className="grid grid-cols-1 gap-0.5">
          {SHORTCUTS.map(([keysLabel, action]) => (
            <div key={action} className="flex items-center justify-between gap-4 px-3 py-2">
              <dt>
                <kbd className="rounded-chip border border-line bg-surface-solid px-2 py-0.5 text-sm font-bold">{keysLabel}</kbd>
              </dt>
              <dd className="text-end font-semibold text-muted">{action}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Device">
        <Row label="Name">
          <span className="font-bold text-muted">{device}</span>
        </Row>
      </Section>
      </div>
    </>
  );
}
