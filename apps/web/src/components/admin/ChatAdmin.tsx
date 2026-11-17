"use client";

import { Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { STICKERS, stickerURL } from "@/components/chat/stickers";
import { Button, IconButton, inputClass } from "@/components/ui";
import { request } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { socialKeys, useChatEffects, useUploadedStickers } from "@/lib/social";
import { toast } from "@/lib/toast";

import { Panel } from "./parts";

const EFFECTS = [
  ["hearts", "Hearts"],
  ["confetti", "Confetti"],
  ["sparkles", "Sparkles"],
  ["stars", "Stars"],
] as const;

function Stickers() {
  const uploaded = useUploadedStickers();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name.replace(/\.[^.]+$/, ""));
      await request("/api/admin/chat/stickers", { method: "POST", body: form });
      void queryClient.invalidateQueries({ queryKey: socialKeys.stickers });
    } catch {
      toast("Sticker not uploaded");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await request(`/api/admin/chat/stickers/${id}`, { method: "DELETE" });
      void queryClient.invalidateQueries({ queryKey: socialKeys.stickers });
    } catch {
      toast("Sticker not deleted");
    }
  };
  return (
    <Panel
      title="Stickers"
      action={
        <>
          <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
            <Upload className="size-4" /> Upload
          </Button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/gif,image/webp,image/jpeg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </>
      }
    >
      <div className="grid grid-cols-4 gap-2 p-2 sm:grid-cols-8">
        {STICKERS.map((s) => (
          <figure key={s.id} className="grid justify-items-center gap-1 rounded-[10px] bg-surface p-2">
            <img src={stickerURL(s.id) ?? ""} alt="" className="size-14 [image-rendering:pixelated]" />
            <figcaption className="text-xs font-bold text-muted">{s.label}</figcaption>
          </figure>
        ))}
        {uploaded.data?.map((s) => (
          <figure key={s.id} className="relative grid justify-items-center gap-1 rounded-[10px] bg-surface p-2">
            <img src={s.url} alt="" className="size-14 object-contain" />
            <figcaption className="max-w-full truncate text-xs font-bold text-muted">{s.name}</figcaption>
            <IconButton label={`Delete ${s.name}`} size="sm" onClick={() => void remove(s.id)} className="absolute -end-1 -top-1 bg-surface-solid shadow-soft">
              <Trash2 />
            </IconButton>
          </figure>
        ))}
      </div>
    </Panel>
  );
}

function Effects() {
  const effects = useChatEffects();
  const [rows, setRows] = useState<[string, string][]>([]);
  useEffect(() => {
    if (effects.data) setRows(Object.entries(effects.data));
  }, [effects.data]);
  const save = async () => {
    const list = rows.map(([e, n]) => [e.trim(), n] as const).filter(([e]) => e);
    try {
      await request("/api/admin/chat/effects", { method: "PUT", body: JSON.stringify(Object.fromEntries(list)) });
      void queryClient.invalidateQueries({ queryKey: socialKeys.effects });
      toast("Effects saved");
    } catch {
      toast("Effects not saved");
    }
  };
  return (
    <Panel
      title="Message effects"
      action={
        <Button size="sm" variant="primary" onClick={() => void save()}>
          Save
        </Button>
      }
    >
      {rows.map(([emoji, name], i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1">
          <input
            aria-label="Emoji"
            value={emoji}
            maxLength={8}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
            className={`${inputClass} w-20 text-center text-xl`}
          />
          <select
            aria-label="Effect"
            value={name}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
            className={`${inputClass} flex-1`}
          >
            {EFFECTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <IconButton label="Remove" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div className="px-2 py-1">
        <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, ["", "hearts"]])} disabled={rows.length >= 20}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </Panel>
  );
}

export function ChatAdmin() {
  return (
    <>
      <Stickers />
      <Effects />
    </>
  );
}
