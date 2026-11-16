"use client";

import { Mic, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { keepsakeApi, keepsakeKeys, useDedicatedIds, type VoiceClip } from "@/lib/keepsakes";
import { queryClient } from "@/lib/queries";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { pause, play, playTracks, seek } from "@/player/controls";
import { selectTrack, usePlayer } from "@/player/store";

import { Dialog } from "./dialogs";
import { Button, Field, Spinner, inputClass } from "./ui";

const MAX_RECORD_MS = 3 * 60_000;

let clipAudio: HTMLAudioElement | null = null;

export async function playDedication(track: Track) {
  try {
    const list = (await keepsakeApi.trackDedications(track.id)).dedications.filter((d) => d.clip.status === "ready" && d.clip.url);
    const d = list[0];
    if (!d?.clip.url) {
      toast("Dedication not ready");
      return;
    }
    clipAudio?.pause();
    pause();
    const audio = new Audio(d.clip.url);
    clipAudio = audio;
    audio.onended = () => {
      if (clipAudio !== audio) return;
      clipAudio = null;
      if (selectTrack(usePlayer.getState())?.id === track.id) {
        seek(0);
        play();
      } else {
        playTracks([track], 0, { type: "queue", name: "Dedication" });
      }
    };
    await audio.play();
    toast("Dedication");
  } catch {
    toast("Dedication not played");
  }
}

export const stopDedication = () => {
  clipAudio?.pause();
  clipAudio = null;
};

export function DedicationMark({ track, className }: { track: Track; className?: string }) {
  const ids = useDedicatedIds();
  if (!ids.has(track.id)) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void playDedication(track);
      }}
      aria-label={`Play dedication for ${track.title}`}
      title="Dedication"
      className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-accent-strong hover:bg-accent-soft/60", className)}
    >
      <Mic className="size-4" />
    </button>
  );
}

type Recording = { blob: Blob; url: string; ms: number; name: string };

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const extFor = (mime: string) => (mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm");

export function useClipRecorder() {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [rec, setRec] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTicker = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTicker();
        const type = r.mimeType || mime || "audio/webm";
        const blob = new Blob(chunks, { type });
        setRec({ blob, url: URL.createObjectURL(blob), ms: Date.now() - started.current, name: `clip.${extFor(type)}` });
        setState("done");
      };
      recorder.current = r;
      started.current = Date.now();
      setElapsed(0);
      r.start(250);
      setState("recording");
      ticker.current = setInterval(() => {
        const ms = Date.now() - started.current;
        setElapsed(ms);
        if (ms >= MAX_RECORD_MS) r.stop();
      }, 250);
    } catch {
      toast("Microphone unavailable");
    }
  };
  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();
  const pickFile = (f: File) => {
    setRec({ blob: f, url: URL.createObjectURL(f), ms: 0, name: f.name });
    setState("done");
  };
  const reset = () => {
    if (rec) URL.revokeObjectURL(rec.url);
    setRec(null);
    setState("idle");
    setElapsed(0);
  };
  useEffect(() => () => {
    stopTicker();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);
  const upload = async (): Promise<VoiceClip | null> => {
    if (!rec) return null;
    return keepsakeApi.uploadClip(rec.blob, rec.name);
  };
  return { state, rec, elapsed, start, stop, pickFile, reset, upload };
}

export function ClipRecorder({ recorder }: { recorder: ReturnType<typeof useClipRecorder> }) {
  const file = useRef<HTMLInputElement>(null);
  const { state, rec, elapsed } = recorder;
  return (
    <div className="grid gap-3">
      {state === "recording" ? (
        <Button variant="danger" onClick={recorder.stop}>
          <Square className="size-4" /> Stop · {fmtMs(elapsed)}
        </Button>
      ) : state === "done" && rec ? (
        <div className="grid gap-2">
          <audio controls src={rec.url} className="w-full" />
          <Button variant="ghost" size="sm" onClick={recorder.reset}>
            Record again
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void recorder.start()}>
            <Mic className="size-4" /> Record
          </Button>
          <Button onClick={() => file.current?.click()}>
            <Upload className="size-4" /> Upload
          </Button>
          <input
            ref={file}
            type="file"
            accept="audio/*,.webm,.m4a,.mp3,.wav,.ogg,.opus"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) recorder.pickFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

export function DedicationDialog({ track, onClose }: { track: Track | null; onClose: () => void }) {
  const recorder = useClipRecorder();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!track) {
      recorder.reset();
      setNote("");
    }
  }, [track]);
  const save = async () => {
    if (!track) return;
    setSaving(true);
    try {
      const clip = await recorder.upload();
      if (!clip) return;
      await keepsakeApi.createDedication(track.id, clip.id, note.trim());
      void queryClient.invalidateQueries({ queryKey: keepsakeKeys.dedications });
      toast("Dedication saved");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Dedication not saved");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={!!track} onOpenChange={(o) => !o && onClose()} title="Dedication">
      {track && (
        <div className="grid gap-4">
          <p dir="auto" className="truncate font-bold">
            {track.title} · {track.artists.join(", ")}
          </p>
          <ClipRecorder recorder={recorder} />
          <Field label="Note">
            <input dir="auto" className={inputClass} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={() => void save()} disabled={recorder.state !== "done" || saving}>
            {saving && <Spinner className="size-4" />} Save dedication
          </Button>
        </div>
      )}
    </Dialog>
  );
}
