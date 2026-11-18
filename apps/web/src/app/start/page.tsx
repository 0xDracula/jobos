"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, Download, Mic, Search, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Avatar } from "@/avatar";
import { Button, Spinner } from "@/components/ui";
import { json, request } from "@/lib/api";
import { cn } from "@/lib/cn";
import { queryClient } from "@/lib/queries";
import { useMe } from "@/lib/session";
import { toast } from "@/lib/toast";

type Artist = { id: string; name: string; image: string | null };
type Choice = "import" | "artists" | "empty";

function regionCode(): string {
  for (const l of navigator.languages ?? [navigator.language]) {
    const m = /^[a-z]{2,3}-([A-Z]{2})\b/.exec(l);
    if (m) return m[1];
  }
  return "ZZ";
}

const CHOICES: { choice: Choice; title: string; meta: string; icon: typeof Mic }[] = [
  { choice: "import", title: "Import from Spotify", meta: "Playlist link", icon: Download },
  { choice: "artists", title: "Pick artists", meta: "Three or more", icon: Mic },
  { choice: "empty", title: "Start empty", meta: "No mixes yet", icon: Square },
];

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <span className="flex flex-1 justify-center gap-1.5" aria-label={`Step ${step} of 2`}>
      <i className="h-1 w-[22px] rounded-full bg-accent" />
      <i className={cn("h-1 w-[22px] rounded-full", step === 2 ? "bg-accent" : "bg-line-strong")} />
    </span>
  );
}

function ArtistTile({ a, on, onToggle }: { a: Artist; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onToggle} className="relative grid justify-items-center gap-2 text-center">
      <span className={cn("block size-[92px] overflow-hidden rounded-full bg-surface-2 transition-shadow", on && "shadow-[0_0_0_3px_var(--bg),0_0_0_5px_var(--accent)]")}>
        {a.image && (
          <img src={a.image} alt="" className="size-full object-cover" loading="lazy" />
        )}
      </span>
      {on && (
        <span className="absolute end-2 top-0 grid size-[26px] place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_0_3px_var(--bg)]">
          <Check className="size-4" strokeWidth={3} />
        </span>
      )}
      <span dir="auto" className="line-clamp-2 text-[13px] font-extrabold leading-tight">
        {a.name}
      </span>
    </button>
  );
}

function Artists({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [country] = useState(regionCode);
  const chart = useQuery({
    queryKey: ["start", "chart", country],
    queryFn: () => request<{ artists: Artist[] }>(`/api/start/chart?country=${country}`),
    staleTime: Infinity,
  });
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const found = useQuery({
    queryKey: ["start", "search", debounced],
    queryFn: () => request<{ artists: Artist[] }>(`/api/start/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    staleTime: Infinity,
  });
  const [picked, setPicked] = useState<Artist[]>([]);
  const [added, setAdded] = useState<Record<string, Artist[]>>({});
  const [busy, setBusy] = useState(false);
  const pickedIds = useMemo(() => new Set(picked.map((a) => a.id)), [picked]);

  const grid = useMemo(() => {
    const base = debounced ? (found.data?.artists ?? []) : (chart.data?.artists ?? []);
    const out: Artist[] = [];
    const seen = new Set<string>();
    const push = (a: Artist) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      out.push(a);
      for (const r of added[a.id] ?? []) push(r);
    };
    const inBase = new Set(base.map((a) => a.id));
    if (!debounced) picked.filter((a) => !inBase.has(a.id)).forEach(push);
    base.forEach(push);
    return out;
  }, [debounced, found.data, chart.data, picked, added]);

  const toggle = async (a: Artist) => {
    if (pickedIds.has(a.id)) {
      setPicked((p) => p.filter((x) => x.id !== a.id));
      return;
    }
    setPicked((p) => [...p, a]);
    if (added[a.id]) return;
    try {
      const r = await queryClient.fetchQuery({
        queryKey: ["start", "artist", a.id] as const,
        queryFn: () => request<{ related: Artist[] }>(`/api/start/artists/${a.id}`),
        staleTime: Number.POSITIVE_INFINITY,
      });
      setAdded((m) => ({ ...m, [a.id]: r.related.slice(0, 6) }));
    } catch {
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      await request<null>("/api/start", json("POST", { artists: picked }));
      onDone();
    } catch {
      toast("Couldn't save");
      setBusy(false);
    }
  };

  const loading = debounced ? found.isLoading : chart.isLoading;
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-[52px] items-center gap-2 px-2 pt-3">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full text-ink hover:bg-surface-2">
          <ChevronLeft className="size-6" />
        </button>
        <Steps step={2} />
        <span className="w-10" />
      </div>
      <div className="px-4 pt-4">
        <h1 className="font-display text-[28px] leading-tight">Artists</h1>
        <label className="mt-4 flex h-[46px] items-center gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 text-muted">
          <Search className="size-[18px] shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search artists"
            aria-label="Search artists"
            className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="flex-1 px-4 pb-40 pt-6">
        {loading ? (
          <div className="grid place-items-center py-16">
            <Spinner />
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl grid-cols-3 gap-x-2.5 gap-y-[18px] sm:grid-cols-4 lg:grid-cols-5">
            {grid.map((a) => (
              <ArtistTile key={a.id} a={a} on={pickedIds.has(a.id)} onToggle={() => void toggle(a)} />
            ))}
          </div>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 grid gap-2 bg-[linear-gradient(0deg,var(--bg)_72%,transparent)] px-4 pb-[max(env(safe-area-inset-bottom),28px)] pt-5">
        <p className="tabular text-center text-[13px] font-bold text-muted">{picked.length} selected</p>
        <Button variant="primary" className="mx-auto h-[52px] w-full max-w-md text-[15px]" onClick={() => void save()} disabled={busy || picked.length === 0}>
          Continue
        </Button>
      </div>
    </div>
  );
}

export default function StartPage() {
  const router = useRouter();
  const me = useMe().data;
  const [step, setStep] = useState<1 | 2>(1);
  const [choice, setChoice] = useState<Choice>("artists");
  const finish = async (skip: boolean, to = "/") => {
    if (skip) {
      try {
        await request<null>("/api/start", json("POST", { skip: true }));
      } catch {
      }
    }
    void queryClient.invalidateQueries();
    router.replace(to);
  };
  const next = () => {
    if (choice === "artists") setStep(2);
    else if (choice === "import") void finish(true, "/search/");
    else void finish(true);
  };
  if (step === 2) return <Artists onBack={() => setStep(1)} onDone={() => void finish(false)} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex min-h-[52px] items-center gap-2 px-2 pt-3">
        <span className="w-12" />
        <Steps step={1} />
        <button type="button" onClick={() => void finish(true)} className="w-12 text-center text-sm font-extrabold text-muted hover:text-ink">
          Skip
        </button>
      </div>
      <div className="mx-auto w-full max-w-md px-4 pt-6">
        {me && (
          <span className="block w-fit overflow-hidden rounded-full bg-surface-2">
            <Avatar userId={me.id} size={72} />
          </span>
        )}
        <h1 className="mt-4 font-display text-[28px] leading-tight">Your music</h1>
        <div role="radiogroup" aria-label="Your music" className="mt-6 grid gap-2.5">
          {CHOICES.map((c) => {
            const on = choice === c.choice;
            const Icon = c.icon;
            return (
              <button
                key={c.choice}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChoice(c.choice)}
                className={cn("flex w-full items-center gap-3.5 rounded-card border-[1.5px] bg-surface p-4 text-start transition-colors", on ? "border-accent" : "border-line hover:border-line-strong")}
              >
                <span className={cn("grid size-12 shrink-0 place-items-center rounded-[14px]", on ? "bg-accent text-on-accent" : "bg-surface-2 text-ink")}>
                  <Icon className="size-[22px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold">{c.title}</span>
                  <span className="block text-[13px] font-semibold text-muted">{c.meta}</span>
                </span>
                <span className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-accent" : "border-line-strong")}>
                  {on && <span className="size-2.5 rounded-full bg-accent" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mx-auto mt-auto w-full max-w-md px-4 pb-[max(env(safe-area-inset-bottom),28px)] pt-6">
        <Button variant="primary" className="h-[52px] w-full text-[15px]" onClick={next}>
          Continue
        </Button>
      </div>
    </div>
  );
}
