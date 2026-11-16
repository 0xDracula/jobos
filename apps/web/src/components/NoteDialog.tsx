"use client";

import { useEffect, useState } from "react";

import { keepsakeApi, keepsakeKeys } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";

import { Dialog } from "./dialogs";
import { Button, inputClass } from "./ui";

export function NoteDialog({
  trackId,
  line,
  open,
  onClose,
}: {
  trackId: string;
  line: { index: number; text: string; ms: number | null } | null;
  open?: boolean;
  onClose: (saved: boolean) => void;
}) {
  const [body, setBody] = useState("");
  const isOpen = open ?? line != null;
  useEffect(() => {
    if (isOpen) setBody("");
  }, [isOpen]);
  const save = async () => {
    try {
      await keepsakeApi.createNote(trackId, {
        body,
        line_index: line?.index ?? null,
        line_text: line?.text ?? null,
        line_ms: line?.ms ?? null,
      });
      void queryClient.invalidateQueries({ queryKey: keepsakeKeys.notes });
      onClose(true);
    } catch {
      toast("Note not saved");
    }
  };
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose(false)} title="Note">
      <div className="grid gap-3">
        {line && (
          <p dir="auto" className="rounded-card bg-surface px-3 py-2 font-extrabold">
            {line.text}
          </p>
        )}
        <textarea
          dir="auto"
          rows={5}
          autoFocus
          aria-label="Note"
          className={`${inputClass} py-3 font-hand text-xl`}
          value={body}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button variant="primary" onClick={() => void save()} disabled={!body.trim()}>
          Save note
        </Button>
      </div>
    </Dialog>
  );
}
