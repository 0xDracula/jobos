alter table media_assets
  add column mood_happy real,
  add column mood_sad real,
  add column mood_relaxed real,
  add column mood_aggressive real,
  add column voice real,
  add column model_valence real,
  add column arousal real,
  add column styles jsonb,
  add column model_version int;

create table track_embeddings (
  asset_id uuid primary key references media_assets (id) on delete cascade,
  model text not null,
  embedding vector(1280) not null,
  created_at timestamptz not null default now()
);
create index track_embeddings_cosine on track_embeddings using hnsw (embedding vector_cosine_ops);

create table rec_candidates (
  user_id uuid not null references users (id) on delete cascade,
  key text not null,
  title text not null,
  artists jsonb not null default '[]',
  track_id uuid references tracks (id) on delete set null,
  video_id text,
  deezer_id text,
  mbid text,
  album text,
  duration_ms int,
  artwork_url text,
  sources jsonb not null default '{}',
  popularity real,
  refreshed_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index rec_candidates_track on rec_candidates (track_id) where track_id is not null;

create table taste_groups (
  user_id uuid not null references users (id) on delete cascade,
  idx smallint not null,
  centroid vector(1280) not null,
  weight real not null,
  size int not null,
  top_track_id uuid references tracks (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, idx)
);

create table mixes (
  user_id uuid not null references users (id) on delete cascade,
  kind text not null,
  items jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

create table releases (
  deezer_id text primary key,
  artist_id uuid not null references artists (id) on delete cascade,
  title text not null,
  kind text not null,
  release_date date not null,
  artwork_url text,
  tracks jsonb not null default '[]',
  found_at timestamptz not null default now()
);
create index releases_date on releases (release_date desc);
