"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { adminApi, adminKeys } from "@/lib/admin";
import { fmtBytes } from "@/lib/format";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";

import { ConfirmDialog } from "../dialogs";
import { Button, Empty } from "../ui";

import { Line, Panel, Stat, when } from "./parts";

const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function show(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return when(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function Sources() {
  const q = useQuery({ queryKey: adminKeys.status, queryFn: adminApi.status, refetchInterval: 30_000 });
  const [clear, setClear] = useState(false);
  const st = q.data?.store;
  const media = q.data?.media;
  const yt = media?.yt_dlp;
  const retry = async (id: number) => {
    try {
      await adminApi.retryJob(id);
      void queryClient.invalidateQueries({ queryKey: adminKeys.status });
    } catch {
      toast("Not retried");
    }
  };
  const jobs = new Map<string, Record<string, number>>();
  for (const j of st?.jobs ?? []) jobs.set(j.kind, { ...(jobs.get(j.kind) ?? {}), [j.status]: j.count });
  return (
    <>
      <Panel title="Downloader">
        {yt ? (
          <>
            <Line label="yt-dlp" sub={yt.update_available ? `Update available: ${yt.latest}` : "Up to date"}>
              <span className="tabular font-bold text-muted">
                {yt.version ?? "—"}
                {yt.released ? ` · ${yt.released}` : ""}
              </span>
            </Line>
            {Object.entries(yt)
              .filter(([k]) => !["version", "released", "latest", "update_available"].includes(k))
              .map(([k, v]) => (
                <Line key={k} label={label(k)}>
                  <span className="tabular font-bold text-muted">{show(v)}</span>
                </Line>
              ))}
            <Line label="ytmusicapi">
              <span className="tabular font-bold text-muted">{media?.ytmusicapi?.version ?? "—"}</span>
            </Line>
            <Line label="YouTube cookies">
              <span className="font-bold text-muted">{media?.cookies?.configured ? "Configured" : "None"}</span>
            </Line>
            <Line label="PO token provider">
              <span className="font-bold text-muted">{media?.po_token_provider?.version ?? "Not installed"}</span>
            </Line>
          </>
        ) : (
          <Empty>Media service unreachable</Empty>
        )}
        {Object.entries(q.data?.workers ?? {}).map(([id, w]) => (
          <Line key={id} label="Worker" sub={id}>
            <span className="font-bold text-muted">
              {w.downloads_paused_until ? `Downloads paused until ${when(w.downloads_paused_until)}` : `Last claim ${when(w.last_claim_at)}`}
            </span>
          </Line>
        ))}
      </Panel>

      <Panel title="Backups">
        {q.data?.backup ? (
          <Line label={q.data.backup.ok ? "Last backup" : "Last backup failed"} sub={q.data.backup.message}>
            <span className="tabular text-sm font-bold text-muted">{when(q.data.backup.at)}</span>
          </Line>
        ) : (
          <Line label="No backups" sub="BACKUP_DIR not set" />
        )}
      </Panel>
      <Panel title="Sources">
        {st?.sources.map((s) => (
          <Line key={s.source} label={label(s.source)} sub={s.last_error ? `${when(s.last_error_at)} · ${s.last_error.slice(0, 160)}` : undefined}>
            <span className="font-bold text-muted">Last success {when(s.last_ok_at)}</span>
          </Line>
        ))}
      </Panel>

      <Panel title="Jobs">
        {[...jobs.entries()].map(([kind, counts]) => (
          <Line key={kind} label={label(kind)}>
            <span className="tabular text-sm font-bold text-muted">
              {Object.entries(counts)
                .map(([s, n]) => `${n} ${s}`)
                .join(" · ")}
            </span>
          </Line>
        ))}
      </Panel>

      <Panel title="Failed jobs">
        {!st?.failed.length && <Empty>None</Empty>}
        {st?.failed.map((f) => (
          <Line key={f.id} label={<span dir="auto">{f.title ?? label(f.kind)}</span>} sub={`${label(f.kind)} · ${f.attempts} attempts · ${(f.last_error ?? "").slice(0, 160)}`}>
            <Button size="sm" onClick={() => void retry(f.id)}>
              Retry
            </Button>
          </Line>
        ))}
      </Panel>

      {st && (
        <Panel title="Cache">
          <div className="grid grid-cols-2 gap-2 p-1 sm:grid-cols-4">
            <Stat label="Audio" value={`${st.cache.audio_files} · ${fmtBytes(st.cache.audio_bytes)}`} />
            <Stat label="Pinned" value={`${st.cache.pinned_files} · ${fmtBytes(st.cache.pinned_bytes)}`} />
            <Stat label="Clearable" value={`${st.cache.clearable_files} · ${fmtBytes(st.cache.clearable_bytes)}`} />
            <Stat label="Images" value={`${st.cache.image_files} · ${fmtBytes(st.cache.image_bytes)}`} />
          </div>
          <Line label="Unpinned songs">
            <Button size="sm" disabled={!st.cache.clearable_files} onClick={() => setClear(true)}>
              Clear
            </Button>
          </Line>
        </Panel>
      )}

      <Panel title="Loud files">
        {st && (
          <Line label="Unmeasured files">
            <span className="tabular font-bold text-muted">{st.unmeasured_files}</span>
          </Line>
        )}
        {!st?.loud_files.length && <Empty>None above −1 dBTP</Empty>}
        {st?.loud_files.map((f) => (
          <Line key={f.track_id} label={<span dir="auto">{f.title}</span>}>
            <span className="tabular font-bold text-muted">{f.true_peak_db.toFixed(1)} dBTP</span>
          </Line>
        ))}
      </Panel>

      <ConfirmDialog
        open={clear}
        onOpenChange={setClear}
        title="Clear unpinned songs?"
        action="Clear"
        onConfirm={async () => {
          try {
            const r = await adminApi.clearCache();
            toast(`Cleared ${fmtBytes(r.bytes)}`);
            void queryClient.invalidateQueries({ queryKey: adminKeys.status });
          } catch {
            toast("Not cleared");
          }
        }}
      />
    </>
  );
}
