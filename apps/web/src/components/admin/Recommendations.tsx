"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioWaveform, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui";
import { request } from "@/lib/api";
import { plural } from "@/lib/format";
import { useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

import { Bar, Line, Panel, Stat } from "./parts";

type PlayStats = { plays: number; skips: number; completes: number; skip_rate: number; completion_rate: number };
type RecStatus = {
  models: { files: number; analyzed: number; queued: number };
  releases_checked_at: string | null;
  users: {
    user_id: string;
    candidates: { refreshed_at: string; counts: Record<string, number>; errors: Record<string, string> | null; total: number } | null;
    groups: { idx: number; weight: number; size: number; top: string | null }[] | null;
    mixes: { kind: string; title: string; count: number; generated_at: string }[] | null;
    metrics: { recommended: PlayStats; own: PlayStats };
  }[];
};

const SOURCES: Record<string, string> = { ytmusic: "YouTube Music", deezer: "Deezer", lastfm: "Last.fm", listenbrainz: "ListenBrainz" };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Recommendations() {
  const qc = useQueryClient();
  const members = useMembers();
  const q = useQuery({ queryKey: ["admin", "recommendations"], queryFn: () => request<RecStatus>("/api/admin/recommendations"), refetchInterval: 30_000 });
  const nameOf = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  const refresh = useMutation({
    mutationFn: () => request("/api/admin/recommendations/refresh", { method: "POST" }),
    onSuccess: () => {
      toast("Mixes rebuilt; new candidates queued");
      void qc.invalidateQueries({ queryKey: ["admin", "recommendations"] });
      void qc.invalidateQueries({ queryKey: ["mixes"] });
    },
    onError: () => toast("Refresh failed"),
  });
  const analyze = useMutation({
    mutationFn: () => request<{ queued: number }>("/api/admin/analysis/models/backfill", { method: "POST" }),
    onSuccess: (r) => {
      toast(r.queued ? `${plural(r.queued, "song")} queued` : "Nothing to analyze");
      void qc.invalidateQueries({ queryKey: ["admin", "recommendations"] });
    },
  });
  const s = q.data;
  return (
    <Panel
      title="Recommendations"
      action={
        <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className="size-4" /> Rebuild mixes
        </Button>
      }
    >
      {s && (
        <>
          <Line label="Song analysis" sub={`${s.models.analyzed} of ${plural(s.models.files, "song")}${s.models.queued ? ` · ${s.models.queued} queued` : ""}`}>
            <Button size="sm" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
              <AudioWaveform className="size-4" /> Analyze
            </Button>
          </Line>
          <div className="px-3 pb-2">
            <Bar total={s.models.files} parts={[{ value: s.models.analyzed, className: "bg-[var(--series-1)]", label: "Analyzed" }]} />
          </div>
          <Line label="New releases" sub={s.releases_checked_at ? `Checked ${when(s.releases_checked_at)}` : "Not checked yet"} />
          {s.users.map((u) => (
            <div key={u.user_id} className="grid gap-3 rounded-card bg-surface p-3">
              <p className="font-bold">{nameOf(u.user_id)}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Recommended skips" value={u.metrics.recommended.plays ? pct(u.metrics.recommended.skip_rate) : "–"} />
                <Stat label="Own picks skips" value={u.metrics.own.plays ? pct(u.metrics.own.skip_rate) : "–"} />
                <Stat label="Recommended finished" value={u.metrics.recommended.plays ? pct(u.metrics.recommended.completion_rate) : "–"} />
                <Stat label="Own picks finished" value={u.metrics.own.plays ? pct(u.metrics.own.completion_rate) : "–"} />
              </div>
              <p className="text-sm font-semibold text-muted">
                {plural(u.metrics.recommended.plays, "recommended play")} · {plural(u.metrics.own.plays, "own play")} · last 30 days
              </p>
              <div className="text-sm">
                <p className="mb-1 text-xs font-extrabold text-muted">Candidates</p>
                {u.candidates ? (
                  <p className="font-semibold">
                    {u.candidates.total} · {when(u.candidates.refreshed_at)} ·{" "}
                    {Object.entries(u.candidates.counts)
                      .map(([k, n]) => `${SOURCES[k] ?? k} ${n}`)
                      .join(", ")}
                    {u.candidates.errors && Object.keys(u.candidates.errors).length > 0 && (
                      <span className="text-danger"> · failed: {Object.keys(u.candidates.errors).map((k) => SOURCES[k] ?? k).join(", ")}</span>
                    )}
                  </p>
                ) : (
                  <p className="font-semibold text-muted">Not fetched yet</p>
                )}
              </div>
              <div className="text-sm">
                <p className="mb-1 text-xs font-extrabold text-muted">Taste groups</p>
                {u.groups?.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {u.groups.map((g) => (
                      <li key={g.idx} dir="auto" className="rounded-full bg-surface-solid px-2.5 py-1 font-semibold">
                        {pct(g.weight)} · {plural(g.size, "song")}
                        {g.top ? ` · ${g.top}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-semibold text-muted">None until songs are analyzed</p>
                )}
              </div>
              <div className="text-sm">
                <p className="mb-1 text-xs font-extrabold text-muted">Mixes</p>
                <p className="font-semibold">
                  {(u.mixes ?? [])
                    .filter((m) => m.count > 0)
                    .map((m) => `${m.title} ${m.count}`)
                    .join(" · ") || "None"}
                </p>
              </div>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
