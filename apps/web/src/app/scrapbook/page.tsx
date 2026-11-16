"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Loading } from "@/components/common";
import { ConfirmDialog } from "@/components/dialogs";
import { Empty, IconButton, PageTitle } from "@/components/ui";
import { keepsakeApi, keepsakeKeys, useScrapbook, type Clipping } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import { playFrom } from "@/player/playFrom";

const PAPERS = ["#fff8ec", "#fdf1f4", "#f2f6ff", "#f5fbef", "#fff4e0"];
const TILTS = [-2.2, 1.4, -0.8, 2, -1.6, 0.9];
const pick = <T,>(list: T[], id: string) => list[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];

function ClippingCard({ c, mine, name, onDelete }: { c: Clipping; mine: boolean; name: string; onDelete: () => void }) {
  const first = c.lines.find((l) => l.ms != null)?.ms ?? null;
  return (
    <li className="relative" style={{ transform: `rotate(${pick(TILTS, c.id)}deg)` }}>
      <span aria-hidden className="absolute -top-2 left-1/2 h-5 w-16 -translate-x-1/2 rotate-[-3deg] rounded-[3px] bg-[#e8d9b5]/80 shadow-sm" />
      <button
        type="button"
        onClick={() => void playFrom(c.track_id, first, "Scrapbook")}
        className="block w-full rounded-[6px] px-5 pb-4 pt-6 text-start text-[#3b2f2a] shadow-soft transition-transform hover:-translate-y-0.5"
        style={{ background: pick(PAPERS, c.id) }}
        aria-label={`Play ${c.track?.title ?? "song"} from this line`}
      >
        {c.lines.map((l, i) => (
          <p key={i} dir="auto" className="font-hand text-[22px] leading-snug">
            {l.text}
          </p>
        ))}
        <p dir="auto" className="mt-3 text-xs font-extrabold uppercase tracking-wide opacity-60">
          {c.track ? `${c.track.title} · ${c.track.artists.join(", ")}` : "—"}
        </p>
        <p className="text-xs font-bold opacity-50">{name}</p>
      </button>
      {mine && (
        <IconButton label="Remove clipping" size="sm" className="absolute end-1 top-3 text-[#3b2f2a]/60" onClick={onDelete}>
          <Trash2 />
        </IconButton>
      )}
    </li>
  );
}

export default function ScrapbookPage() {
  const q = useScrapbook();
  const me = useMe().data;
  const members = useMembers();
  const [removing, setRemoving] = useState<Clipping | null>(null);
  const name = (id: string) => members.data?.find((u) => u.id === id)?.display_name ?? "";
  return (
    <>
      <PageTitle>Scrapbook</PageTitle>
      {q.isLoading && <Loading />}
      {q.data && !q.data.length && <Empty>No clippings</Empty>}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-8 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {q.data?.map((c) => (
          <ClippingCard key={c.id} c={c} mine={c.user_id === me?.id} name={name(c.user_id)} onDelete={() => setRemoving(c)} />
        ))}
      </ul>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this clipping?"
        action="Remove"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await keepsakeApi.deleteClipping(removing.id);
            void queryClient.invalidateQueries({ queryKey: keepsakeKeys.scrapbook });
          } catch {
            toast("Not removed");
          }
        }}
      />
    </>
  );
}
