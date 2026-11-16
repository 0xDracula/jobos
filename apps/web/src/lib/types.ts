export type PaletteColor = { hex: string; weight: number; lab: [number, number, number] };

export type SourceView = {
  id: string;
  provider: string;
  external_id: string;
  title: string | null;
  uploader: string | null;
  duration_ms: number | null;
  score: number | null;
  status?: "candidate" | "selected";
};

export type AudioView = {
  url: string;
  duration_ms: number | null;
  loudness_lufs: number | null;
  gain_db: number | null;
  waveform?: number[];
  tempo_bpm?: number;
  beats?: number[];
  energy?: number | null;
  valence?: number | null;
  danceability?: number | null;
  key?: string | null;
};

export type Track = {
  id: string;
  title: string;
  artists: string[];
  artist_ids: string[];
  album: string | null;
  album_id: string | null;
  duration_ms: number | null;
  artwork_url: string | null;
  artwork_thumb_url: string | null;
  palette?: PaletteColor[];
  match_status: "pending" | "matched" | "review" | "unmatched" | "chosen" | null;
  note?: string;
  status: "cached" | "queued" | "running" | "failed" | "missing";
  error?: string;
  source?: SourceView;
  audio?: AudioView;
  stream_url?: string;
};

export type PlayedTrack = Track & { plays: number };

export type PlaylistCounts = {
  total: number;
  pending: number;
  matched: number;
  review: number;
  unmatched: number;
  cached: number;
};

export type PlaylistSummary = {
  id: string;
  name: string;
  kind: string;
  source_url: string | null;
  source_provider: string | null;
  sync_enabled: boolean;
  synced_at: string | null;
  description: string | null;
  owner_id: string | null;
  cover_url: string | null;
  collage: string[];
  counts: PlaylistCounts;
};

export type Playlist = PlaylistSummary & { tracks: Track[] };

export type Album = {
  id: string;
  title: string;
  year: number | null;
  artwork_url: string | null;
  palette?: PaletteColor[];
  artists: string[];
  tracks: Track[];
};

export type AlbumSummary = { id: string; title: string; artwork_url: string | null; tracks: number };

export type Artist = {
  id: string;
  name: string;
  image_url: string | null;
  bio: string | null;
  tracks: Track[];
  albums: AlbumSummary[];
};

export type SearchResult = {
  provider: string;
  external_id: string;
  title: string;
  artists: { name: string; id: string | null }[];
  album: { name: string; id: string | null } | null;
  duration_ms: number | null;
  explicit: boolean;
  thumbnail: string | null;
  official: boolean;
};

export type LyricLine = { time_ms: number; text: string };

export type Lyrics = {
  status: "synced" | "plain" | "instrumental" | "none";
  source: string | null;
  lines?: LyricLine[];
  plain: string | null;
  offset_ms: number;
  duration_ms: number | null;
};

export type User = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  avatar?: Record<string, unknown> | null;
};

export type Account = User & { last_seen_at: string | null; sessions: number; created_at: string };

export type InviteStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export type Invite = {
  id: string;
  display_name: string;
  username: string;
  message: string;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
};

export type InviteView = { display_name: string; username: string; message: string; status: "pending" | "declined"; expires_at: string };

export type PlaybackState = {
  device_id: string;
  device_name: string;
  track_id: string | null;
  position_ms: number;
  queue: string[];
  queue_index: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  playing: boolean;
  updated_at: string;
};

export type HiddenArtist = { id: string; name: string; image_url: string | null };

export type ImportSummary = {
  playlist_id: string;
  created: boolean;
  tracks: number;
  added: number;
  new_tracks: number;
  queued: number;
  skipped: number;
};

export type SourceChoice =
  | { url: string }
  | {
      provider: string;
      external_id: string;
      title: string;
      artists: { name: string; id?: string | null }[];
      duration_ms: number | null;
    };

export type ListeningEventKind = "start" | "progress" | "complete" | "skip" | "pause" | "resume" | "seek";

export type ListeningEvent = {
  device_id: string | null;
  track_id: string;
  event: ListeningEventKind;
  position_ms: number | null;
  context: Record<string, unknown> | null;
  at: string;
};

export type City = {
  name: string;
  region?: string;
  country: string;
  lat: number;
  lon: number;
  timezone?: string;
  source?: "manual" | "detected";
  updated_at?: string;
};

export type Weather = {
  condition: "clear" | "clouds" | "fog" | "drizzle" | "rain" | "snow" | "thunderstorm";
  code: number;
  temperature_c: number;
  cloud_cover: number;
  precipitation_mm: number;
  wind_kmh: number;
  is_day: boolean;
  timezone: string;
  utc_offset_s: number;
  fetched_at: string;
};

export type UserCityEntry = { user_id: string; display_name: string; me: boolean; city: City | null };

export type RoomStats = { listening_seconds: number; liked_songs: number; active_days: number; since: string | null };

export type HiddenNoteView = {
  id: string;
  spot: "moon" | "drawer" | "shooting_star" | "pet_bed" | "frame";
  found: boolean;
  found_at?: string;
  title?: string;
  body?: string;
};
