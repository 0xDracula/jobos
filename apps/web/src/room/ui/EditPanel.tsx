"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, FlipHorizontal2, Repeat } from "lucide-react";

import { Button, Chip, IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

import { saveRoomLayout } from "../data";
import { ACCENT_COLORS, clampToZone, DECORATIONS, DEFAULT_LAYOUT, FLOOR_STYLES, placementOf, STYLE_LABELS, WALL_STYLES, type RoomLayout } from "../layout";
import { useRoom } from "../state";

const STEP = 4;

function Styles({ label, styles, value, onPick }: { label: string; styles: readonly string[]; value: string; onPick: (s: string) => void }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-16 shrink-0 pt-1.5 text-sm font-bold text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {styles.map((s) => (
          <Chip key={s} role="radio" aria-checked={value === s} selected={value === s} onClick={() => onPick(s)}>
            {STYLE_LABELS[s] ?? s}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-sm font-bold text-muted">{label}</span>
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

export function EditPanel({ saved, unlocked }: { saved: RoomLayout; unlocked: Set<string> }) {
  const draft = useRoom((s) => s.draft) ?? saved;
  const selected = useRoom((s) => s.selected);
  const available = DECORATIONS.filter((d) => !d.unlock || unlocked.has(d.unlock));
  const deco = available.find((d) => d.id === selected) ?? null;
  const current = () => useRoom.getState().draft ?? saved;
  const change = (patch: Partial<RoomLayout>) => useRoom.setState({ draft: { ...current(), ...patch } });
  const changeItem = (id: string, f: (c: RoomLayout["items"][string]) => RoomLayout["items"][string]) => {
    const d = current();
    change({ items: { ...d.items, [id]: f(d.items[id] ?? {}) } });
  };

  const move = (away: number, right: number) => {
    if (!deco) return;
    const p = placementOf(deco, current().items[deco.id]);
    const [x, y] = clampToZone(deco.zone, p.x + right * STEP, p.y - away * STEP);
    changeItem(deco.id, (c) => ({ ...c, x, y }));
  };
  const flip = () => deco && changeItem(deco.id, (c) => ({ ...c, flip: !(c.flip ?? deco.home.flip) }));
  const swap = () => deco && changeItem(deco.id, (c) => ({ ...c, variant: ((c.variant ?? 0) + 1) % deco.sprites.length }));
  const hidden = deco ? !!draft.items[deco.id]?.hidden : false;

  const finish = (save: boolean) => {
    if (save) void saveRoomLayout(draft);
    useRoom.setState({ sheet: null, draft: null, selected: null });
  };

  return (
    <section
      aria-label="Edit room"
      className="glass absolute inset-x-2 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 grid max-h-[55dvh] gap-3 overflow-y-auto rounded-sheet p-4 shadow-soft [background:var(--surface-solid)] lg:inset-x-auto lg:bottom-28 lg:right-6 lg:w-[420px]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Edit room</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => useRoom.setState({ draft: structuredClone(DEFAULT_LAYOUT), selected: null })}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => finish(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => finish(true)}>
            Save
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {available.map((d) => (
          <Chip key={d.id} selected={selected === d.id} onClick={() => useRoom.setState({ selected: selected === d.id ? null : d.id })}>
            {draft.items[d.id]?.hidden && <EyeOff className="size-3.5" />}
            {d.label}
          </Chip>
        ))}
      </div>

      {deco && (
        <div className="flex flex-wrap items-center gap-1 rounded-card bg-surface-solid/60 p-2">
          <div className="grid grid-cols-3 gap-0.5">
            <span />
            <IconButton label="Move away" size="sm" onClick={() => move(1, 0)} disabled={hidden}>
              <ArrowUp />
            </IconButton>
            <span />
            <IconButton label="Move left" size="sm" onClick={() => move(0, -1)} disabled={hidden}>
              <ArrowLeft />
            </IconButton>
            <span />
            <IconButton label="Move right" size="sm" onClick={() => move(0, 1)} disabled={hidden}>
              <ArrowRight />
            </IconButton>
            <span />
            <IconButton label="Move closer" size="sm" onClick={() => move(-1, 0)} disabled={hidden}>
              <ArrowDown />
            </IconButton>
            <span />
          </div>
          <div className="ms-auto flex gap-1">
            <IconButton label="Flip" onClick={flip} disabled={hidden}>
              <FlipHorizontal2 />
            </IconButton>
            {deco.sprites.length > 1 && (
              <IconButton label="Swap" onClick={swap} disabled={hidden}>
                <Repeat />
              </IconButton>
            )}
            <IconButton label={hidden ? "Show" : "Hide"} onClick={() => changeItem(deco.id, (c) => ({ ...c, hidden: !hidden }))}>
              {hidden ? <Eye /> : <EyeOff />}
            </IconButton>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Styles label="Walls" styles={WALL_STYLES} value={draft.look.wall} onPick={(wall) => change({ look: { ...current().look, wall } })} />
        <Styles label="Floor" styles={FLOOR_STYLES} value={draft.look.floor} onPick={(floor) => change({ look: { ...current().look, floor } })} />
        <Swatches label="Accent" colors={ACCENT_COLORS} value={draft.look.accent} onPick={(accent) => change({ look: { ...current().look, accent } })} />
      </div>
    </section>
  );
}
