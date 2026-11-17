"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, IconButton, inputClass } from "@/components/ui";
import { profileKeys, profilesApi, type DailyQuestion } from "@/lib/profiles";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";

import { Line, Panel } from "./parts";

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: profileKeys.adminQuestions });
  void queryClient.invalidateQueries({ queryKey: profileKeys.question });
};

function QuestionForm({ initial, onSave, onCancel, action }: { initial?: DailyQuestion; onSave: (body: string, kind: "text" | "song") => Promise<void>; onCancel?: () => void; action: string }) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [kind, setKind] = useState<"text" | "song">(initial?.kind ?? "text");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        await onSave(body.trim(), kind);
        if (!initial) setBody("");
      }}
      className="grid gap-2 px-2 py-2 sm:grid-cols-[1fr_auto_auto]"
    >
      <input dir="auto" value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} aria-label="Question" placeholder="Question" className={inputClass} />
      <select value={kind} onChange={(e) => setKind(e.target.value as "text" | "song")} aria-label="Answer" className={inputClass}>
        <option value="text">Text answer</option>
        <option value="song">Song answer</option>
      </select>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!body.trim()}>
          {action}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

export function QuestionsAdmin() {
  const q = useQuery({ queryKey: profileKeys.adminQuestions, queryFn: profilesApi.adminQuestions });
  const [editing, setEditing] = useState<string | null>(null);
  const waiting = (q.data ?? []).filter((x) => !x.asked_on);
  const asked = (q.data ?? []).filter((x) => x.asked_on);
  const run = async (fn: () => Promise<unknown>, failed: string) => {
    try {
      await fn();
      refresh();
    } catch {
      toast(failed);
    }
  };
  const move = (i: number, by: number) => {
    const ids = waiting.map((x) => x.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => profilesApi.orderQuestions(ids), "Order not saved");
  };
  return (
    <Panel id="daily-questions" title="Daily questions">
      <QuestionForm action="Add" onSave={(body, kind) => run(() => profilesApi.createQuestion(body, kind), "Question not added")} />
      {waiting.map((x, i) =>
        editing === x.id ? (
          <QuestionForm
            key={x.id}
            initial={x}
            action="Save"
            onCancel={() => setEditing(null)}
            onSave={async (body, kind) => {
              await run(() => profilesApi.updateQuestion(x.id, body, kind), "Question not saved");
              setEditing(null);
            }}
          />
        ) : (
          <Line key={x.id} label={<span dir="auto">{x.body}</span>} sub={i === 0 ? `Next · ${x.kind === "song" ? "Song answer" : "Text answer"}` : x.kind === "song" ? "Song answer" : "Text answer"}>
            <div className="flex">
              <IconButton label="Move up" size="sm" onClick={() => move(i, -1)} disabled={i === 0}>
                <ArrowUp />
              </IconButton>
              <IconButton label="Move down" size="sm" onClick={() => move(i, 1)} disabled={i === waiting.length - 1}>
                <ArrowDown />
              </IconButton>
              <IconButton label="Edit" size="sm" onClick={() => setEditing(x.id)}>
                <Pencil />
              </IconButton>
              <IconButton label="Delete" size="sm" onClick={() => void run(() => profilesApi.deleteQuestion(x.id), "Question not deleted")}>
                <Trash2 />
              </IconButton>
            </div>
          </Line>
        ),
      )}
      {waiting.length === 0 && <p className="px-3 py-2 font-semibold text-muted">None waiting</p>}
      {asked.slice(0, 30).map((x) => (
        <Line key={x.id} label={<span dir="auto">{x.body}</span>} sub={`Asked ${new Date(`${x.asked_on}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`} />
      ))}
    </Panel>
  );
}
