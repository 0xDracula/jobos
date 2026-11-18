"use client";

import {
  CircleArrowDown,
  Disc3,
  Ellipsis,
  EyeOff,
  Heart,
  ListEnd,
  ListPlus,
  ListStart,
  Trash,
  UserRound,
  Eye,
  AudioLines,
  ArrowDownToLine,
  MessageCircleHeart,
  Mic,
  NotebookPen,
  Radio,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useMemo } from "react";

import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/format";
import { downloadTracks, removeDownload, useOfflineStatus } from "@/lib/offline";
import { isHidden, setLiked, useHide, useHiddenIds, useLikedIds } from "@/lib/queries";
import { shareSong } from "@/lib/social";
import { toast } from "@/lib/toast";
import type { Track } from "@/lib/types";
import { addToQueue, playNext, playTracks } from "@/player/controls";
import { startRadio } from "@/player/radio";
import { playable, selectCurrent, usePlayer, type PlayContext } from "@/player/store";

import { DedicationMark } from "./Dedications";
import { openAddToPlaylist, openVersions, providerLabel } from "./dialogs";
import { SessionMenuItems } from "./together/SessionMenu";
import { DateMenuItems } from "./trackMenu/dates";
import { LetterMenuItems } from "./trackMenu/letters";
import { MemoryMenuItems } from "./trackMenu/memories";
import { openDedication, openSongNote } from "./KeepsakeDialogs";
import { Artwork, LevelMeter } from "./media";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, Spinner } from "./ui";

export function unavailableLabel(t: Track): string | null {
  if (playable(t)) return null;
  if (t.match_status === "unmatched") return "Unmatched";
  if (t.match_status === "pending") return "Matching";
  if (t.status === "queued" || t.status === "running") return "Downloading";
  if (t.status === "failed") return "Failed";
  return "Unavailable";
}

export function TrackMenu({
  track,
  onRemove,
  removeLabel = "Remove from playlist",
  className,
}: {
  track: Track;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  const router = useRouter();
  const liked = useLikedIds().has(track.id);
  const hidden = useHiddenIds();
  const hide = useHide();
  const offline = useOfflineStatus(track.id);
  const can = playable(track);
  const artists = track.artists.map((name, i) => ({ name, id: track.artist_ids[i] })).filter((a) => a.id);
  const trackHidden = hidden.tracks.has(track.id);
  return (
    <Menu modal={false}>
      <MenuTrigger
        aria-label={`More for ${track.title}`}
        className={cn(
          "relative z-10 grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-accent-soft/60 hover:text-ink data-[state=open]:bg-accent-soft",
          className,
        )}
      >
        <Ellipsis className="size-5" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={<ListStart />} disabled={!can} onSelect={() => playNext([track])}>
          Play next
        </MenuItem>
        <MenuItem icon={<ListEnd />} disabled={!can} onSelect={() => addToQueue([track])}>
          Add to queue
        </MenuItem>
        <MenuItem icon={<ListPlus />} onSelect={() => openAddToPlaylist([track])}>
          Add to playlist
        </MenuItem>
        <MenuItem icon={<Heart className={cn(liked && "fill-accent text-accent")} />} onSelect={() => void setLiked(track.id, !liked)}>
          {liked ? "Remove from likes" : "Like"}
        </MenuItem>
        <MenuSeparator />
        {track.album_id && (
          <MenuItem icon={<Disc3 />} onSelect={() => router.push(`/album/?id=${track.album_id}`)}>
            Album
          </MenuItem>
        )}
        {artists.length === 1 && (
          <MenuItem icon={<UserRound />} onSelect={() => router.push(`/artist/?id=${artists[0].id}`)}>
            Artist
          </MenuItem>
        )}
        {artists.length > 1 && (
          <MenuSub>
            <MenuSubTrigger icon={<UserRound />}>Artists</MenuSubTrigger>
            <MenuSubContent>
              {artists.map((a) => (
                <MenuItem key={a.id} onSelect={() => router.push(`/artist/?id=${a.id}`)}>
                  <span dir="auto">{a.name}</span>
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        )}
        <MenuItem icon={<Radio />} disabled={!can} onSelect={() => void startRadio({ type: "track", id: track.id, name: track.title })}>
          Radio
        </MenuItem>
        <MenuItem icon={<AudioLines />} onSelect={() => openVersions(track)}>
          Versions
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<MessageCircleHeart />}
          onSelect={() => {
            shareSong(track);
            toast("Sent to chat");
          }}
        >
          Send to chat
        </MenuItem>
        <MenuItem icon={<NotebookPen />} onSelect={() => openSongNote(track)}>
          Note
        </MenuItem>
        <MenuItem icon={<Mic />} onSelect={() => openDedication(track)}>
          Dedication
        </MenuItem>
        <SessionMenuItems track={track} />
        <LetterMenuItems track={track} />
        <MemoryMenuItems track={track} />
        <DateMenuItems track={track} />
        <MenuSeparator />
        {offline === "offline" ? (
          <MenuItem icon={<Trash />} onSelect={() => void removeDownload(track.id)}>
            Remove download
          </MenuItem>
        ) : (
          <MenuItem
            icon={<ArrowDownToLine />}
            disabled={offline === "downloading" || !(track.audio || track.source)}
            onSelect={() => void downloadTracks([track])}
          >
            {offline === "downloading" ? "Downloading" : "Download"}
          </MenuItem>
        )}
        <MenuItem
          icon={trackHidden ? <Eye /> : <EyeOff />}
          onSelect={() => hide("track", track.id, !trackHidden, track.title)}
        >
          {trackHidden ? "Unhide song" : "Hide song"}
        </MenuItem>
        {artists.slice(0, 1).map((a) => (
          <MenuItem
            key={a.id}
            icon={hidden.artists.has(a.id) ? <Eye /> : <EyeOff />}
            onSelect={() => hide("artist", a.id, !hidden.artists.has(a.id), a.name)}
          >
            {hidden.artists.has(a.id) ? "Unhide artist" : "Hide artist"}
          </MenuItem>
        ))}
        {onRemove && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Trash />} onSelect={onRemove} className="text-danger [&_svg]:text-danger">
              {removeLabel}
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

function OfflineIcon({ id }: { id: string }) {
  const status = useOfflineStatus(id);
  if (status === "offline") return <CircleArrowDown aria-label="Downloaded" className="size-4 shrink-0 text-accent-strong" />;
  if (status === "downloading") return <Spinner className="size-4 shrink-0 text-muted" />;
  return null;
}

type RowProps = {
  track: Track;
  index?: number;
  current: boolean;
  playing: boolean;
  liked: boolean;
  hidden: boolean;
  onPlay: () => void;
  onRemove?: () => void;
  showAlbum?: boolean;
  note?: TrackNote;
};

export type TrackNote = { label: string; isNew?: boolean };

export const TrackRow = memo(function TrackRow({ track, index, current, playing, liked, hidden, onPlay, onRemove, showAlbum, note }: RowProps) {
  const unavailable = unavailableLabel(track);
  const source = track.source?.provider;
  return (
    <li
      className={cn(
        "row-auto group relative flex items-center gap-3 rounded-button py-1.5 pe-1 ps-2 transition-colors hover:bg-accent-soft/35",
        current && "bg-accent-soft/45",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play ${track.title}`}
        aria-current={current ? "true" : undefined}
        className="absolute inset-0 rounded-button"
      />
      {index != null && (
        <span className="tabular hidden w-6 shrink-0 text-end text-sm font-bold text-muted sm:block">{index + 1}</span>
      )}
      <div className={cn("pointer-events-none relative size-12 shrink-0", (unavailable || hidden) && "opacity-45")}>
        <Artwork src={track.artwork_thumb_url} className="size-12 rounded-chip" />
        {current && (
          <span className="absolute inset-0 grid place-items-center rounded-chip bg-[#1e1b3a]/40 text-white">
            <LevelMeter playing={playing} />
          </span>
        )}
      </div>
      <div className={cn("pointer-events-none min-w-0 flex-1", (unavailable || hidden) && "opacity-55")}>
        <div dir="auto" className={cn("truncate font-bold leading-snug", current && "text-accent-strong")}>
          {track.title}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-muted">
          {liked && <Heart aria-label="Liked" className="size-3.5 shrink-0 fill-accent text-accent" />}
          {hidden && <EyeOff aria-label="Hidden" className="size-3.5 shrink-0" />}
          <span dir="auto" className="truncate">
            {track.artists.join(", ")}
            {showAlbum && track.album ? ` · ${track.album}` : ""}
          </span>
        </div>
        {note && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-bold">
            {note.isNew && <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[11px] text-accent-strong">New</span>}
            <span dir="auto" className="truncate text-muted">
              {note.label}
            </span>
          </div>
        )}
      </div>
      <DedicationMark track={track} />
      <div className="pointer-events-none flex shrink-0 items-center gap-2">
        {unavailable ? (
          <span className="rounded-full bg-butter/80 px-2 py-0.5 text-xs font-bold text-[#5b4a1f]">{unavailable}</span>
        ) : (
          source && source !== "ytmusic" && (
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-xs font-bold text-muted sm:inline">{providerLabel(source)}</span>
          )
        )}
        <OfflineIcon id={track.id} />
        <span className="tabular hidden w-11 text-end text-sm font-semibold text-muted sm:block">{fmtMs(track.duration_ms)}</span>
      </div>
      <TrackMenu track={track} onRemove={onRemove} />
    </li>
  );
});

export function TrackList({
  tracks,
  context,
  numbered,
  showAlbum,
  onRemove,
  notes,
}: {
  tracks: Track[];
  context: PlayContext;
  numbered?: boolean;
  showAlbum?: boolean;
  onRemove?: (track: Track) => void;
  notes?: Record<string, TrackNote>;
}) {
  const liked = useLikedIds();
  const hidden = useHiddenIds();
  const currentId = usePlayer((s) => selectCurrent(s)?.track.id);
  const playing = usePlayer((s) => s.playing);
  const handlers = useMemo(
    () => tracks.map((_, i) => () => playTracks(tracks, i, context)),
    [tracks, context.type, context.id, context.name],
  );
  return (
    <ul className="grid grid-cols-1 gap-0.5">
      {tracks.map((t, i) => (
        <TrackRow
          key={`${t.id}-${i}`}
          track={t}
          index={numbered ? i : undefined}
          current={t.id === currentId}
          playing={playing && t.id === currentId}
          liked={liked.has(t.id)}
          hidden={isHidden(t, hidden)}
          onPlay={handlers[i]}
          onRemove={onRemove ? () => onRemove(t) : undefined}
          showAlbum={showAlbum}
          note={notes?.[t.id]}
        />
      ))}
    </ul>
  );
}
