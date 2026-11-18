"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";

import { Failed, Loading, PlayBar, totalDuration } from "@/components/common";
import { MixCover } from "@/components/mixes/Mixes";
import { TrackList, type TrackNote } from "@/components/tracks";
import { plural } from "@/lib/format";
import { mixContext, updatedLabel, useMix } from "@/lib/mixes";

export default function MixPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MixView />
    </Suspense>
  );
}

function MixView() {
  const kind = useSearchParams().get("kind");
  const q = useMix(kind);
  const notes = useMemo(() => {
    const out: Record<string, TrackNote> = {};
    for (const t of q.data?.tracks ?? []) out[t.id] = { label: t.reason.label, isNew: t.new };
    return out;
  }, [q.data]);
  if (!kind) return <Failed what="Mix" />;
  if (q.isLoading) return <Loading />;
  if (!q.data) return <Failed what="Mix" />;
  const m = q.data;
  const fresh = m.tracks.filter((t) => t.new).length;
  const meta = [plural(m.tracks.length, "song"), totalDuration(m.tracks), fresh ? `${fresh} new` : null, `Updated ${updatedLabel(m.generated_at).toLowerCase()}`]
    .filter(Boolean)
    .join(" · ");
  const context = mixContext(m.kind, m.title);
  return (
    <>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end">
        <MixCover src={m.cover_url} title={m.title} className="size-44 shrink-0 rounded-card shadow-soft lg:size-56" />
        <div className="min-w-0">
          <div className="text-xs font-extrabold text-muted">Mix</div>
          <h1 className="font-display text-[30px] font-semibold leading-tight lg:text-[40px]">{m.title}</h1>
          <p className="mt-1 text-sm font-bold text-muted">{meta}</p>
        </div>
      </header>
      <div className="mb-5">
        <PlayBar tracks={m.tracks} context={context} />
      </div>
      <TrackList tracks={m.tracks} context={context} notes={notes} />
    </>
  );
}
