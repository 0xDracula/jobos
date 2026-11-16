import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "./api";
import { toast } from "./toast";
import type { Playlist, Track } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
      networkMode: "offlineFirst",
    },
    mutations: { networkMode: "offlineFirst" },
  },
});

export const keys = {
  playlists: ["playlists"] as const,
  playlist: (id: string) => ["playlist", id] as const,
  likes: (sort: string) => ["likes", "list", sort] as const,
  likedIds: ["likes", "ids"] as const,
  hidden: ["hidden", "list"] as const,
  hiddenIds: ["hidden", "ids"] as const,
  recent: ["history", "recent"] as const,
  top: ["history", "top"] as const,
  album: (id: string) => ["album", id] as const,
  artist: (id: string) => ["artist", id] as const,
  track: (id: string) => ["track", id] as const,
  lyrics: (id: string) => ["lyrics", id] as const,
  sources: (id: string) => ["sources", id] as const,
  playback: ["playback"] as const,
  librarySearch: (q: string) => ["library-search", q] as const,
  search: (q: string, sources: string) => ["search", q, sources] as const,
};

export const usePlaylists = () =>
  useQuery({ queryKey: keys.playlists, queryFn: async () => (await api.playlists()).playlists });

export const usePlaylist = (id: string | null) =>
  useQuery({ queryKey: keys.playlist(id ?? ""), queryFn: () => api.playlist(id!), enabled: !!id });

export const useAlbum = (id: string | null) =>
  useQuery({ queryKey: keys.album(id ?? ""), queryFn: () => api.album(id!), enabled: !!id });

export const useArtist = (id: string | null) =>
  useQuery({ queryKey: keys.artist(id ?? ""), queryFn: () => api.artist(id!), enabled: !!id });

export type LikeSort = "added" | "title" | "artist";

export const useLikes = (sort: LikeSort) =>
  useQuery({ queryKey: keys.likes(sort), queryFn: async () => (await api.likes(sort)).tracks });

export const useRecent = () => useQuery({ queryKey: keys.recent, queryFn: async () => (await api.recent(50)).tracks });

export const useTop = () => useQuery({ queryKey: keys.top, queryFn: async () => (await api.top(30, 50)).tracks });

export const usePlaybackStates = () =>
  useQuery({ queryKey: keys.playback, queryFn: async () => (await api.playback()).states, staleTime: 0 });

export const useTrackDetail = (id: string | null) =>
  useQuery({
    queryKey: keys.track(id ?? ""),
    queryFn: () => api.track(id!),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && !q.state.data.audio ? 20_000 : false),
  });

const EMPTY_SET: ReadonlySet<string> = new Set();

export function useLikedIds(): ReadonlySet<string> {
  const q = useQuery({
    queryKey: keys.likedIds,
    queryFn: async () => new Set((await api.likedIds()).ids),
    staleTime: 60_000,
  });
  return q.data ?? EMPTY_SET;
}

export const likedSnapshot = (): ReadonlySet<string> =>
  queryClient.getQueryData<ReadonlySet<string>>(keys.likedIds) ?? EMPTY_SET;

export async function setLiked(id: string, on: boolean): Promise<void> {
  await queryClient.cancelQueries({ queryKey: keys.likedIds });
  const prev = queryClient.getQueryData<ReadonlySet<string>>(keys.likedIds);
  const next = new Set(prev);
  if (on) next.add(id);
  else next.delete(id);
  queryClient.setQueryData(keys.likedIds, next);
  try {
    await api.like(id, on);
  } catch {
    queryClient.setQueryData(keys.likedIds, prev);
    toast("Like failed");
  } finally {
    void queryClient.invalidateQueries({ queryKey: ["likes", "list"] });
  }
}

export type HiddenIds = { tracks: ReadonlySet<string>; artists: ReadonlySet<string> };

const EMPTY_HIDDEN: HiddenIds = { tracks: EMPTY_SET, artists: EMPTY_SET };

const fetchHiddenIds = async (): Promise<HiddenIds> => {
  const ids = await api.hiddenIds();
  return { tracks: new Set(ids.tracks), artists: new Set(ids.artists) };
};

export function useHiddenIds(): HiddenIds {
  const q = useQuery({ queryKey: keys.hiddenIds, queryFn: fetchHiddenIds, staleTime: 60_000 });
  return q.data ?? EMPTY_HIDDEN;
}

export const hiddenSnapshot = (): HiddenIds => queryClient.getQueryData<HiddenIds>(keys.hiddenIds) ?? EMPTY_HIDDEN;

export const prefetchHidden = () =>
  queryClient.query({ queryKey: keys.hiddenIds, queryFn: fetchHiddenIds, staleTime: 60_000 }).catch(() => EMPTY_HIDDEN);

export const isHidden = (t: Pick<Track, "id" | "artist_ids">, hidden: HiddenIds) =>
  hidden.tracks.has(t.id) || t.artist_ids.some((a) => hidden.artists.has(a));

export function useHide() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ type, id, on }: { type: "track" | "artist"; id: string; on: boolean; label: string }) =>
      api.hide(type, id, on),
    onSuccess: (_res, { type, id, on, label }) => {
      qc.invalidateQueries({ queryKey: ["hidden"] });
      if (on) toast(`Hidden: ${label}`, { label: "Undo", run: () => m.mutate({ type, id, on: false, label }) });
    },
    onError: () => toast("Hide failed"),
  });
  return (type: "track" | "artist", id: string, on: boolean, label: string) => m.mutate({ type, id, on, label });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string; trackIds?: string[] }) =>
      api.createPlaylist(name, description),
    onSuccess: async (playlist, { trackIds }) => {
      if (trackIds?.length) await api.addToPlaylist(playlist.id, trackIds);
      qc.invalidateQueries({ queryKey: keys.playlists });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : "Create failed"),
  });
}

export function useEditPlaylist(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; description?: string; sync_enabled?: boolean }) => api.editPlaylist(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.playlist(id) });
      qc.invalidateQueries({ queryKey: keys.playlists });
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : "Save failed"),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePlaylist(id),
    onSuccess: (_res, id) => {
      qc.removeQueries({ queryKey: keys.playlist(id) });
      qc.invalidateQueries({ queryKey: keys.playlists });
    },
    onError: () => toast("Delete failed"),
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackIds }: { id: string; name: string; trackIds: string[] }) => api.addToPlaylist(id, trackIds),
    onSuccess: ({ added }, { id, name, trackIds }) => {
      qc.invalidateQueries({ queryKey: keys.playlist(id) });
      qc.invalidateQueries({ queryKey: keys.playlists });
      toast(added === 0 && trackIds.length ? `Already in ${name}` : `Added to ${name}`);
    },
    onError: () => toast("Add failed"),
  });
}

export function useRemoveFromPlaylist(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => api.removeFromPlaylist(id, trackId),
    onMutate: async (trackId) => {
      await qc.cancelQueries({ queryKey: keys.playlist(id) });
      const prev = qc.getQueryData<Playlist>(keys.playlist(id));
      if (prev) qc.setQueryData(keys.playlist(id), { ...prev, tracks: prev.tracks.filter((t) => t.id !== trackId) });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.playlist(id), ctx.prev);
      toast("Remove failed");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.playlist(id) });
      qc.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useReorderPlaylist(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tracks: Track[]) => api.reorderPlaylist(id, tracks.map((t) => t.id)),
    onMutate: async (tracks) => {
      await qc.cancelQueries({ queryKey: keys.playlist(id) });
      const prev = qc.getQueryData<Playlist>(keys.playlist(id));
      if (prev) qc.setQueryData(keys.playlist(id), { ...prev, tracks });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.playlist(id), ctx.prev);
      toast("Reorder failed");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useSetPlaylistCover(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.setPlaylistCover(id, file),
    onSuccess: () => {
      toast("Cover processing");
      for (const delay of [3_000, 10_000]) {
        setTimeout(() => {
          qc.invalidateQueries({ queryKey: keys.playlist(id) });
          qc.invalidateQueries({ queryKey: keys.playlists });
        }, delay);
      }
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : "Upload failed"),
  });
}
