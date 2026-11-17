"use client";

import { create } from "zustand";

import type { Track } from "@/lib/types";

export const useWelcomeState = create<{ replay: boolean }>(() => ({ replay: false }));

export const replayWelcome = () => useWelcomeState.setState({ replay: true });

export const useSongDialog = create<{ track: Track | null }>(() => ({ track: null }));

export const openSongOfTheDay = (track: Track) => useSongDialog.setState({ track });
