"use client";

import { create } from "zustand";

import type { Track } from "@/lib/types";

import { DedicationDialog } from "./Dedications";
import { NoteDialog } from "./NoteDialog";

const useKeepsakeDialogs = create<{ note: Track | null; dedication: Track | null }>(() => ({ note: null, dedication: null }));

export const openSongNote = (track: Track) => useKeepsakeDialogs.setState({ note: track });
export const openDedication = (track: Track) => useKeepsakeDialogs.setState({ dedication: track });

export function KeepsakeDialogs() {
  const { note, dedication } = useKeepsakeDialogs();
  return (
    <>
      <NoteDialog trackId={note?.id ?? ""} line={null} open={!!note} onClose={() => useKeepsakeDialogs.setState({ note: null })} />
      <DedicationDialog track={dedication} onClose={() => useKeepsakeDialogs.setState({ dedication: null })} />
    </>
  );
}
