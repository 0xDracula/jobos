"use client";

import { useQuery } from "@tanstack/react-query";
import { Image as ImageIcon, Mic, Pause, Play, Smile, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Dialog } from "@/components/dialogs";
import { IconButton, Menu, MenuContent, MenuTrigger } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtTime } from "@/lib/format";
import { keepsakeApi } from "@/lib/keepsakes";
import { memoriesApi } from "@/lib/memories";
import { sendMessage, sendUpload, useUploadedStickers, type ChatData, type ChatMessage } from "@/lib/social";
import { toast } from "@/lib/toast";
import { pause, play } from "@/player/controls";
import { usePlayer } from "@/player/store";

import { STICKERS, stickerURL } from "./stickers";

let current: { audio: HTMLAudioElement; resume: boolean; stop: () => void } | null = null;

export function VoiceNote({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const d = m.data ?? {};
  const clip = useQuery({
    queryKey: ["clip", d.clip_id],
    queryFn: () => keepsakeApi.clip(d.clip_id!),
    enabled: !!d.clip_id && !m.status,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2000 : false),
  });
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const peaks = d.peaks?.length ? d.peaks : Array(32).fill(0.3);
  const ms = d.duration_ms ?? clip.data?.duration_ms ?? 0;
  const url = clip.data?.status === "ready" ? clip.data.url : null;

  useEffect(() => () => {
    if (current && playing) current.stop();
  }, [playing]);

  const toggle = () => {
    if (!url) return;
    if (playing && current) return current.stop();
    current?.stop();
    const audio = new Audio(url);
    const resume = usePlayer.getState().playing;
    if (resume) pause();
    let raf = 0;
    const tick = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      audio.pause();
      setPlaying(false);
      setProgress(0);
      if (current?.audio === audio) {
        if (current.resume) play();
        current = null;
      }
    };
    audio.onended = stop;
    audio.onerror = () => {
      stop();
      toast("Voice note unavailable");
    };
    current = { audio, resume, stop };
    void audio.play().then(() => {
      setPlaying(true);
      raf = requestAnimationFrame(tick);
    }, stop);
  };

  return (
    <div className="flex min-w-[220px] items-center gap-3">
      <IconButton
        label={playing ? "Pause voice note" : "Play voice note"}
        onClick={toggle}
        disabled={!url}
        className={cn("shrink-0 bg-surface-solid/80", mine && "bg-white/70 text-[var(--chat-mine-ink)]")}
      >
        {playing ? <Pause /> : <Play />}
      </IconButton>
      <div className="flex h-9 flex-1 items-center justify-between gap-[2px]" aria-hidden>
        {peaks.map((p, i) => (
          <span
            key={i}
            className={cn("w-[3px] shrink-0 rounded-full transition-colors", i / peaks.length < progress ? "bg-current" : "bg-current/35")}
            style={{ height: `${Math.max(12, Math.round(p * 100))}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs font-bold tabular-nums opacity-75">
        {m.status ? "" : !url && clip.data?.status !== "failed" ? "Processing" : fmtTime(ms / 1000)}
      </span>
    </div>
  );
}

async function peaksOf(blob: Blob, bars = 40): Promise<{ peaks: number[]; ms: number }> {
  try {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / bars));
    const raw: number[] = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) sum += data[j] * data[j];
      raw.push(Math.sqrt(sum / step));
    }
    const max = Math.max(...raw, 0.0001);
    return { peaks: raw.map((v) => Math.round((v / max) * 100) / 100), ms: Math.round(buf.duration * 1000) };
  } catch {
    return { peaks: Array(bars).fill(0.3), ms: 0 };
  }
}

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const MAX_MS = 5 * 60_000;

export function VoiceButton({ replyTo, onSent }: { replyTo: string | null; onSent: () => void }) {
  const [mode, setMode] = useState<"idle" | "hold" | "tap">("idle");
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; cancel: boolean } | null>(null);
  const pressedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const finish = (send: boolean) => {
    const c = rec.current;
    if (!c) return;
    c.cancel = !send;
    if (c.r.state === "recording") c.r.stop();
    setMode("idle");
  };

  const start = async (as: "hold" | "tap") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const c = { r, stream, chunks: [] as Blob[], started: Date.now(), cancel: false };
      rec.current = c;
      r.ondataavailable = (e) => e.data.size && c.chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (ticker.current) clearInterval(ticker.current);
        rec.current = null;
        const ms = Date.now() - c.started;
        if (c.cancel || ms < 600) return;
        const type = r.mimeType || mime || "audio/webm";
        const blob = new Blob(c.chunks, { type });
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        sendUpload("voice", { duration_ms: ms, peaks: Array(40).fill(0.3) }, async () => {
          const [{ peaks, ms: decoded }, clip] = await Promise.all([peaksOf(blob), keepsakeApi.uploadClip(blob, `voice.${ext}`)]);
          return { clip_id: clip.id, peaks, duration_ms: decoded || ms } satisfies ChatData;
        }, "", replyTo);
        onSent();
      };
      r.start(250);
      setElapsed(0);
      setMode(as);
      ticker.current = setInterval(() => {
        const ms = Date.now() - c.started;
        setElapsed(ms);
        if (ms >= MAX_MS) finish(true);
      }, 200);
    } catch {
      toast("Microphone unavailable");
      setMode("idle");
    }
  };

  useEffect(() => () => finish(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode === "tap") {
    return (
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1.5 px-2 text-sm font-bold tabular-nums text-danger">
          <span className="size-2 animate-pulse rounded-full bg-danger" /> {fmtTime(elapsed / 1000)}
        </span>
        <IconButton label="Cancel voice note" onClick={() => finish(false)}>
          <Trash2 />
        </IconButton>
        <IconButton label="Send voice note" onClick={() => finish(true)} className="bg-accent text-on-accent hover:bg-accent">
          <Square className="fill-current" />
        </IconButton>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {mode === "hold" && (
        <span className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-danger">
          <span className="size-2 animate-pulse rounded-full bg-danger" /> {fmtTime(elapsed / 1000)}
        </span>
      )}
      <button
        type="button"
        aria-label="Record voice note"
        title="Hold to record"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pressedAt.current = Date.now();
          void start("hold");
        }}
        onPointerUp={(e) => {
          const inside = e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY));
          if (Date.now() - pressedAt.current < 350) return setMode((m) => (m === "hold" ? "tap" : m));
          finish(inside);
        }}
        onPointerCancel={() => finish(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void start("tap");
          }
        }}
        className={cn(
          "grid size-11 shrink-0 touch-none select-none place-items-center rounded-full bg-accent text-on-accent shadow-soft transition-transform",
          mode === "hold" && "scale-125 bg-danger",
        )}
      >
        <Mic className="size-5" />
      </button>
    </div>
  );
}

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * k);
  const height = Math.round(bitmap.height * k);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.86));
  return { blob, width, height };
}

export function PhotoButton({ replyTo, onSent }: { replyTo: string | null; onSent: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    try {
      const { blob, width, height } = await shrink(file);
      const local = URL.createObjectURL(blob);
      sendUpload("photo", { width, height, local_url: local }, async () => {
        const p = await memoriesApi.uploadPhoto(new File([blob], "photo.jpg", { type: "image/jpeg" }));
        return { photo_id: p.id, width, height } satisfies ChatData;
      }, "", replyTo);
      onSent();
    } catch {
      toast("Photo unavailable");
    }
  };
  return (
    <>
      <IconButton label="Send a photo" onClick={() => input.current?.click()}>
        <ImageIcon />
      </IconButton>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void pick(f);
        }}
      />
    </>
  );
}

export function PhotoMessage({ m }: { m: ChatMessage }) {
  const d = m.data ?? {};
  const photo = useQuery({
    queryKey: ["photo", d.photo_id],
    queryFn: () => memoriesApi.photo(d.photo_id!),
    enabled: !!d.photo_id && !m.status,
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 2000 : false),
  });
  const [open, setOpen] = useState(false);
  const p = photo.data;
  const src = p?.status === "ready" ? (p.thumb_url ?? p.url) : (d.local_url ?? null);
  const ratio = d.width && d.height ? d.width / d.height : p?.width && p?.height ? p.width / p.height : 4 / 3;
  return (
    <>
      <button
        type="button"
        onClick={() => p?.url && setOpen(true)}
        aria-label="Open photo"
        className="block w-[min(64vw,280px)] overflow-hidden rounded-[12px]"
        style={{ aspectRatio: String(ratio), background: p?.color ?? "var(--chat-action)" }}
      >
        {src && <img src={src} alt="" className="size-full object-cover" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={m.body || "Photo"} wide>
        {p?.url && <img src={p.url} alt="" className="max-h-[75vh] w-full rounded-[12px] object-contain" />}
      </Dialog>
    </>
  );
}

export function StickerMessage({ m }: { m: ChatMessage }) {
  const d = m.data ?? {};
  const uploaded = useUploadedStickers();
  const src = d.sticker ? stickerURL(d.sticker) : uploaded.data?.find((s) => s.id === d.sticker_id)?.url ?? null;
  if (!src) return <p className="text-sm italic opacity-60">Sticker removed</p>;
  return <img src={src} alt="Sticker" className={cn("size-32", d.sticker && "[image-rendering:pixelated]")} />;
}

export function StickerButton({ replyTo, onSent }: { replyTo: string | null; onSent: () => void }) {
  const uploaded = useUploadedStickers();
  const [open, setOpen] = useState(false);
  const send = (data: ChatData) => {
    sendMessage("sticker", "", data, replyTo);
    setOpen(false);
    onSent();
  };
  return (
    <Menu open={open} onOpenChange={setOpen} modal={false}>
      <MenuTrigger aria-label="Send a sticker" className="grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft/50 hover:text-ink">
        <Smile className="size-5" />
      </MenuTrigger>
      <MenuContent align="start" side="top" className="w-[min(92vw,360px)] p-2">
        <div className="grid grid-cols-4 gap-1">
          {STICKERS.map((s) => (
            <button key={s.id} type="button" aria-label={s.label} title={s.label} onClick={() => send({ sticker: s.id })} className="grid place-items-center rounded-[10px] p-1 hover:bg-accent-soft/60">
              <img src={stickerURL(s.id) ?? ""} alt="" className="size-16 [image-rendering:pixelated]" />
            </button>
          ))}
          {uploaded.data?.map((s) => (
            <button key={s.id} type="button" aria-label={s.name} title={s.name} onClick={() => send({ sticker_id: s.id })} className="grid place-items-center rounded-[10px] p-1 hover:bg-accent-soft/60">
              <img src={s.url} alt="" className="size-16 object-contain" />
            </button>
          ))}
        </div>
      </MenuContent>
    </Menu>
  );
}
