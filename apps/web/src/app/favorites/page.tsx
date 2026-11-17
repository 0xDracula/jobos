"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Loading } from "@/components/common";
import { PageHero } from "@/components/sky/PageHero";
import { Segmented, inputClass } from "@/components/ui";
import { PageTitle } from "@/components/ui";
import { FAVORITE_CATEGORIES, giftApi, giftKeys, useFavoriteLists, type FavoriteCategory, type FavoriteItems } from "@/lib/gift";
import { queryClient } from "@/lib/queries";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";

const LABELS: Record<FavoriteCategory, string> = {
  flowers: "Flowers",
  food: "Food",
  drinks: "Drinks",
  colors: "Colors",
  places: "Places",
  films: "Films",
  artists: "Artists",
  scents: "Scents",
};

function Category({ cat, items, editable, onChange }: { cat: FavoriteCategory; items: string[]; editable: boolean; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.some((x) => x.toLowerCase() === v.toLowerCase())) return setDraft("");
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <section className="rounded-card bg-surface-solid/60 p-3 shadow-soft">
      <h2 className="mb-2 font-display text-lg font-semibold">{LABELS[cat]}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-accent-soft/70 pe-1 ps-3.5 text-sm font-bold">
            <span dir="auto">{it}</span>
            {editable ? (
              <button
                type="button"
                aria-label={`Remove ${it}`}
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="grid size-7 place-items-center rounded-full hover:bg-accent-soft"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <span className="pe-2.5" />
            )}
          </li>
        ))}
        {!items.length && !editable && <li className="text-sm font-semibold text-muted">—</li>}
      </ul>
      {editable && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            dir="auto"
            aria-label={`Add to ${LABELS[cat]}`}
            placeholder={`Add to ${LABELS[cat].toLowerCase()}`}
            className={inputClass}
            value={draft}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
          />
        </form>
      )}
    </section>
  );
}

export default function FavoritesPage() {
  const me = useMe().data;
  const members = useMembers();
  const lists = useFavoriteLists();
  const [who, setWho] = useState<string>("");
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setWho(id);
  }, []);
  const viewing = who || me?.id || "";
  const list = lists.data?.find((l) => l.user_id === viewing);
  const editable = viewing === me?.id;
  const save = async (items: FavoriteItems) => {
    queryClient.setQueryData(giftKeys.favorites, (old: typeof lists.data) => old?.map((l) => (l.user_id === viewing ? { ...l, items } : l)));
    try {
      await giftApi.setFavorites(items);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Not saved");
      void lists.refetch();
    }
  };
  const people = members.data ?? [];
  return (
    <>
      <PageHero title="Favorite things" />
      {people.length > 1 && me && (
        <div className="mb-5">
          <Segmented
            label="Person"
            value={viewing}
            onChange={setWho}
            options={people.map((u) => [u.id, u.id === me.id ? "Mine" : u.display_name] as [string, string])}
          />
        </div>
      )}
      {lists.isLoading && <Loading />}
      {list && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FAVORITE_CATEGORIES.map((cat) => (
            <Category key={cat} cat={cat} items={list.items[cat] ?? []} editable={editable} onChange={(next) => void save({ ...list.items, [cat]: next })} />
          ))}
        </div>
      )}
    </>
  );
}
