create extension if not exists vector;

create table users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'member')),
  username text not null unique,
  display_name text not null,
  nickname text,
  password_hash text,
  timezone text,
  city_name text,
  city_lat double precision,
  city_lon double precision,
  city_source text check (city_source in ('auto', 'manual')),
  locale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_latin text,
  mbid text,
  deezer_id text,
  spotify_id text,
  ytmusic_id text,
  image_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index artists_ytmusic_id on artists (ytmusic_id) where ytmusic_id is not null;
create unique index artists_spotify_id on artists (spotify_id) where spotify_id is not null;

create table albums (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mbid text,
  ytmusic_id text,
  spotify_id text,
  year int,
  artwork_url text,
  palette jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index albums_ytmusic_id on albums (ytmusic_id) where ytmusic_id is not null;
create unique index albums_spotify_id on albums (spotify_id) where spotify_id is not null;

create table tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  title_latin text,
  album_id uuid references albums (id) on delete set null,
  duration_ms int,
  isrc text,
  spotify_id text,
  language text,
  explicit boolean not null default false,
  artwork_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tracks_isrc on tracks (isrc) where isrc is not null;
create unique index tracks_spotify_id on tracks (spotify_id) where spotify_id is not null;

create table track_artists (
  track_id uuid not null references tracks (id) on delete cascade,
  artist_id uuid not null references artists (id) on delete cascade,
  position int not null,
  primary key (track_id, position)
);
create index track_artists_artist on track_artists (artist_id);

create table track_sources (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references tracks (id) on delete cascade,
  provider text not null check (provider in ('ytmusic', 'youtube', 'soundcloud', 'upload', 'other')),
  external_id text not null,
  url text,
  raw_title text,
  uploader text,
  duration_ms int,
  match_score real,
  status text not null default 'candidate' check (status in ('candidate', 'selected', 'rejected')),
  selected_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, provider, external_id)
);
create unique index track_sources_one_selected on track_sources (track_id) where status = 'selected';
create index track_sources_external on track_sources (provider, external_id);

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique check (sha256 ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('audio', 'artwork', 'photo', 'voice', 'stem', 'image')),
  path text not null,
  mime text not null,
  bytes bigint not null,
  duration_ms int,
  bitrate int,
  loudness_lufs real,
  true_peak_db real,
  gain_db real,
  waveform jsonb,
  created_at timestamptz not null default now()
);

create table track_media (
  track_id uuid not null references tracks (id) on delete cascade,
  variant text not null default 'main' check (variant in ('main', 'instrumental', 'vocals', 'guide')),
  track_source_id uuid references track_sources (id) on delete set null,
  asset_id uuid not null references media_assets (id),
  created_at timestamptz not null default now(),
  primary key (track_id, variant)
);

create table lyrics (
  track_id uuid primary key references tracks (id) on delete cascade,
  synced_lrc text,
  plain text,
  source text,
  offset_ms int not null default 0,
  word_timings jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table track_tags (
  track_id uuid not null references tracks (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  source text not null,
  weight real not null default 1,
  primary key (track_id, tag_id, source)
);

create table playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users (id) on delete cascade,
  name text not null,
  description text,
  cover_url text,
  kind text not null default 'standard'
    check (kind in ('standard', 'imported', 'collection', 'mixtape', 'mix', 'blend', 'smart')),
  source_provider text,
  source_external_id text,
  source_url text,
  sync_enabled boolean not null default false,
  rules jsonb,
  label text,
  recipient_id uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index playlists_source on playlists (source_provider, source_external_id)
  where source_external_id is not null;

create table playlist_items (
  playlist_id uuid not null references playlists (id) on delete cascade,
  position int not null,
  track_id uuid not null references tracks (id) on delete cascade,
  added_by uuid references users (id) on delete set null,
  note text,
  side text check (side in ('A', 'B')),
  added_at timestamptz not null default now(),
  primary key (playlist_id, position)
);

create table jobs (
  id bigserial primary key,
  queue text not null default 'default' check (queue in ('default', 'heavy')),
  kind text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  priority int not null default 0,
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  dedupe_key text,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_ready on jobs (queue, priority desc, id) where status = 'queued';
create unique index jobs_dedupe on jobs (dedupe_key)
  where dedupe_key is not null and status in ('queued', 'running');

create table source_status (
  provider text primary key,
  last_ok_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  tool_version text,
  updated_at timestamptz not null default now()
);
