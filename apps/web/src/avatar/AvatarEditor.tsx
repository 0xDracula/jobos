"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Switch } from "@/components/ui";
import { giftApi } from "@/lib/gift";
import { cn } from "@/lib/cn";
import { useMe, useMembers } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { User } from "@/lib/types";

import { Avatar } from "./Avatar";
import { AVATAR_STYLES, HAIR_COLORS, lookKey, lookOf, OUTFIT_COLORS, SKIN_COLORS, STYLE_LABELS, type AvatarLook } from "./look";

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2">
      <span className="font-bold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={c}
            onClick={() => onPick(c)}
            className={cn("size-8 rounded-full border-2 shadow-soft", value === c ? "border-accent-strong" : "border-white/80")}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function AvatarEditor() {
  const me = useMe();
  const members = useMembers();
  const qc = useQueryClient();
  const id = me.data?.id ?? "";
  const saved = lookOf(id, members.data?.find((u) => u.id === id)?.avatar);
  const [look, setLook] = useState<AvatarLook>(saved);
  const [saving, setSaving] = useState(false);
  const savedKey = lookKey(saved);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setLook(saved);
  }, [savedKey, touched]);
  const change = (patch: Partial<AvatarLook>) => {
    setTouched(true);
    setLook((l) => ({ ...l, ...patch }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await giftApi.setAvatar(look);
      qc.setQueryData<User[]>(["members"], (list) => list?.map((u) => (u.id === id ? { ...u, avatar: look } : u)));
      void qc.invalidateQueries({ queryKey: ["members"] });
      setTouched(false);
      toast("Avatar saved");
    } catch {
      toast("Avatar not saved");
    } finally {
      setSaving(false);
    }
  };
  if (!id) return null;
  const dirty = lookKey(look) !== savedKey;
  return (
    <section id="avatar" className="mb-10 scroll-mt-6">
      <h2 className="mb-3 font-display text-xl font-semibold">Avatar</h2>
      <div className="grid grid-cols-1 gap-1 rounded-card bg-surface-solid/60 p-2 shadow-soft">
        <div className="flex items-center justify-center gap-6 rounded-card bg-[#1e1b3a] py-4">
          <Avatar userId={id} look={look} size={120} />
          <Avatar userId={id} look={look} size={120} pose="listening" />
        </div>
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-2">
          <span className="font-bold">Hair style</span>
          <div role="radiogroup" aria-label="Hair style" className="flex flex-wrap gap-1.5">
            {AVATAR_STYLES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={look.style === s}
                aria-label={STYLE_LABELS[s]}
                title={STYLE_LABELS[s]}
                onClick={() => change({ style: s })}
                className={cn("grid size-12 place-items-center rounded-button border-2 bg-[#1e1b3a]", look.style === s ? "border-accent-strong" : "border-transparent")}
              >
                <Avatar userId={id} look={{ ...look, style: s }} size={40} />
              </button>
            ))}
          </div>
        </div>
        <Swatches label="Hair color" colors={HAIR_COLORS} value={look.hair} onPick={(hair) => change({ hair })} />
        <Swatches label="Skin" colors={SKIN_COLORS} value={look.skin} onPick={(skin) => change({ skin })} />
        <Swatches label="Outfit" colors={OUTFIT_COLORS} value={look.outfit} onPick={(outfit) => change({ outfit })} />
        <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
          <span className="font-bold">Glasses</span>
          <Switch label="Glasses" checked={look.glasses} onCheckedChange={(glasses) => change({ glasses })} />
        </div>
        <div className="flex justify-end gap-2 px-3 py-2">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => { setTouched(false); setLook(saved); }}>
            Reset
          </Button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </section>
  );
}
