"use client";

import { Mic, Trash2 } from "lucide-react";
import { useState } from "react";

import { Loading } from "@/components/common";
import { playDedication } from "@/components/Dedications";
import { ConfirmDialog } from "@/components/dialogs";
import { Artwork } from "@/components/media";
import { Empty, IconButton, PageTitle } from "@/components/ui";
import { fmtMs } from "@/lib/format";
import { keepsakeApi, keepsakeKeys, useDedications, type Dedication } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

const STATUS: Record<Dedication["clip"]["status"], string> = { processing: "Processing", ready: "", failed: "Failed" };

export default function DedicationsPage() {
  const q = useDedications();
  const me = useMe().data;
  const members = useMembers();
  const [removing, setRemoving] = useState<Dedication | null>(null);
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  return (
    <>
      <PageTitle>Dedications</PageTitle>
      {q.isLoading && <Loading />}
      {q.data && !q.data.length && <Empty>No dedications</Empty>}
      <ul className="grid grid-cols-1 gap-2">
        {q.data?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-card bg-surface-solid/60 p-2 shadow-soft">
            <Artwork src={d.track?.artwork_thumb_url ?? null} className="size-14 shrink-0 rounded-chip" />
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate font-bold">
                {d.track?.title ?? "—"}
              </p>
              <p dir="auto" className="truncate text-sm font-semibold text-muted">
                {name(d.author_id)}
                {d.clip.duration_ms ? ` · ${fmtMs(d.clip.duration_ms)}` : ""}
                {STATUS[d.clip.status] ? ` · ${STATUS[d.clip.status]}` : ""}
              </p>
              {d.note && (
                <p dir="auto" className="truncate font-hand text-lg">
                  {d.note}
                </p>
              )}
            </div>
            <IconButton label={`Play dedication for ${d.track?.title ?? "song"}`} disabled={d.clip.status !== "ready" || !d.track} onClick={() => d.track && void playDedication(d.track)}>
              <Mic />
            </IconButton>
            {d.author_id === me?.id && (
              <IconButton label="Delete" size="sm" onClick={() => setRemoving(d)}>
                <Trash2 />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this dedication?"
        action="Delete"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await keepsakeApi.deleteDedication(removing.id);
            void queryClient.invalidateQueries({ queryKey: keepsakeKeys.dedications });
          } catch {
            toast("Not deleted");
          }
        }}
      />
    </>
  );
}
