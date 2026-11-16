import type {
  Account, Album, Artist, Invite, InviteView, City, HiddenArtist, HiddenNoteView, ImportSummary, ListeningEvent, Lyrics, PlaybackState, PlayedTrack,
  Playlist, PlaylistSummary, RoomStats, SearchResult, SourceChoice, SourceView, Track, User, UserCityEntry, Weather,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 202) {
    if (res.status === 401 && typeof window !== "undefined" && !/^\/api\/(auth|invites|resets)\//.test(path)) {
      window.dispatchEvent(new Event("jobbos:signed-out"));
    }
    throw new ApiError(res.status, (body && body.error) || res.statusText);
  }
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  me: () => request<{ user: User }>("/api/me"),
  members: () => request<{ users: User[] }>("/api/members"),
  login: (username: string, password: string) => request<{ user: User }>("/api/auth/login", json("POST", { username, password })),
  logout: () => request<null>("/api/auth/logout", { method: "POST" }),
  invite: (token: string) => request<{ invite: InviteView }>(`/api/invites/${token}`),
  acceptInvite: (token: string, body: { display_name: string; username: string; password: string }) =>
    request<{ user: User }>(`/api/invites/${token}/accept`, json("POST", body)),
  declineInvite: (token: string) => request<null>(`/api/invites/${token}/decline`, { method: "POST" }),
  reset: (token: string) => request<{ username: string }>(`/api/resets/${token}`),
  useReset: (token: string, password: string) => request<{ user: User }>(`/api/resets/${token}`, json("POST", { password })),
  adminAccounts: () => request<{ accounts: Account[] }>("/api/admin/accounts"),
  adminResetLink: (id: string) => request<{ path: string; expires_at: string }>(`/api/admin/accounts/${id}/reset`, { method: "POST" }),
  adminSignOut: (id: string) => request<{ revoked: number }>(`/api/admin/accounts/${id}/signout`, { method: "POST" }),
  adminInvites: () => request<{ invites: Invite[] }>("/api/admin/invites"),
  createInvite: (body: { display_name: string; username: string; message: string }) =>
    request<{ invite: Invite; path: string }>("/api/admin/invites", json("POST", body)),
  revokeInvite: (id: string) => request<null>(`/api/admin/invites/${id}/revoke`, { method: "POST" }),
  regenerateInvite: (id: string) => request<{ invite: Invite; path: string }>(`/api/admin/invites/${id}/regenerate`, { method: "POST" }),
  registerDevice: (id: string | null, name: string, platform: string) =>
    request<{ id: string }>("/api/devices", json("POST", { id, name, platform })),

  search: (q: string, sources: string) =>
    request<{ results: SearchResult[] }>(`/api/search?limit=20&sources=${sources}&q=${encodeURIComponent(q)}`),
  searchLibrary: (q: string) => request<{ tracks: Track[] }>(`/api/library/search?limit=50&q=${encodeURIComponent(q)}`),
  addTrack: (r: SearchResult) => request<Track>("/api/tracks", json("POST", r)),
  importLink: (url: string) =>
    request<{ track?: Track; playlist?: ImportSummary; truncated?: boolean }>("/api/links", json("POST", { url })),

  track: (id: string) => request<Track>(`/api/tracks/${id}`),
  tracks: (ids: string[]) => request<{ tracks: Track[] }>("/api/tracks/batch", json("POST", { ids })),
  cache: (id: string) => request<Track>(`/api/tracks/${id}/cache`, { method: "POST" }),
  prefetch: (ids: string[]) => request<{ queued: number }>("/api/prefetch", json("POST", { track_ids: ids })),
  lyrics: (id: string) => request<Lyrics>(`/api/tracks/${id}/lyrics`),
  sources: (id: string) => request<{ sources: SourceView[] }>(`/api/tracks/${id}/sources`),
  chooseSource: (id: string, body: SourceChoice) => request<Track>(`/api/tracks/${id}/source`, json("PUT", body)),
  events: (events: ListeningEvent[]) => request<null>("/api/events", json("POST", { events })),

  playlists: () => request<{ playlists: PlaylistSummary[] }>("/api/playlists"),
  playlist: (id: string) => request<Playlist>(`/api/playlists/${id}`),
  createPlaylist: (name: string, description = "") => request<Playlist>("/api/playlists", json("POST", { name, description })),
  editPlaylist: (id: string, body: { name?: string; description?: string; sync_enabled?: boolean }) =>
    request<Playlist>(`/api/playlists/${id}`, json("PATCH", body)),
  deletePlaylist: (id: string) => request<null>(`/api/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (id: string, trackIds: string[]) =>
    request<{ added: number }>(`/api/playlists/${id}/items`, json("POST", { track_ids: trackIds })),
  removeFromPlaylist: (id: string, trackId: string) =>
    request<null>(`/api/playlists/${id}/items/${trackId}`, { method: "DELETE" }),
  reorderPlaylist: (id: string, trackIds: string[]) =>
    request<null>(`/api/playlists/${id}/items`, json("PUT", { track_ids: trackIds })),
  setPlaylistCover: (id: string, file: File) => {
    const form = new FormData();
    form.append("cover", file);
    return request<null>(`/api/playlists/${id}/cover`, { method: "POST", body: form });
  },

  album: (id: string) => request<Album>(`/api/albums/${id}`),
  artist: (id: string) => request<Artist>(`/api/artists/${id}`),

  likes: (sort: string) => request<{ tracks: Track[] }>(`/api/likes?sort=${sort}`),
  likedIds: () => request<{ ids: string[] }>("/api/likes/ids"),
  like: (id: string, on: boolean) => request<null>(`/api/likes/${id}`, { method: on ? "PUT" : "DELETE" }),
  hidden: () => request<{ tracks: Track[]; artists: HiddenArtist[] }>("/api/hidden"),
  hiddenIds: () => request<{ tracks: string[]; artists: string[] }>("/api/hidden/ids"),
  hide: (type: "track" | "artist", id: string, on: boolean) =>
    request<null>(`/api/hidden/${type}/${id}`, { method: on ? "PUT" : "DELETE" }),

  recent: (limit = 50) => request<{ tracks: Track[] }>(`/api/history/recent?limit=${limit}`),
  top: (days = 30, limit = 50) => request<{ tracks: PlayedTrack[] }>(`/api/history/top?days=${days}&limit=${limit}`),
  playback: () => request<{ states: PlaybackState[] }>("/api/playback"),
  savePlayback: (state: Omit<PlaybackState, "device_name" | "updated_at">) => request<null>("/api/playback", json("PUT", state)),

  settings: () => request<{ settings: Record<string, unknown> }>("/api/settings"),

  location: () => request<{ city: City | null; detection: boolean }>("/api/location"),
  setLocation: (city: City) => request<{ city: City }>("/api/location", json("PUT", city)),
  clearLocation: () => request<null>("/api/location", { method: "DELETE" }),
  locations: () => request<{ users: UserCityEntry[] }>("/api/locations"),
  cities: (q: string) => request<{ places: City[] }>(`/api/cities?q=${encodeURIComponent(q)}`),
  weather: (lat: number, lon: number) => request<Weather>(`/api/weather?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`),
  roomStats: () => request<RoomStats>("/api/room/stats"),
  hiddenNotes: () => request<{ notes: HiddenNoteView[] }>("/api/notes/hidden"),
  findNote: (id: string) => request<HiddenNoteView>(`/api/notes/hidden/${id}/find`, { method: "POST" }),
  setSetting: (key: string, value: unknown) => request<null>(`/api/settings/${key}`, json("PUT", value)),
};
