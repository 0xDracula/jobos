alter table media_assets
  add column energy real,
  add column valence real,
  add column danceability real,
  add column musical_key text,
  add column analysis_version int;

alter table artists
  add column bio_source text,
  add column bio_url text,
  add column enriched_at timestamptz;

create table artist_tags (
  artist_id uuid not null references artists (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  source text not null,
  weight real,
  primary key (artist_id, tag_id, source)
);
create index artist_tags_tag on artist_tags (tag_id);

create table artist_related (
  artist_id uuid not null references artists (id) on delete cascade,
  rank int not null,
  name text not null,
  deezer_id text,
  image_url text,
  related_artist_id uuid references artists (id) on delete set null,
  primary key (artist_id, rank)
);

create table artist_top_tracks (
  artist_id uuid not null references artists (id) on delete cascade,
  rank int not null,
  title text not null,
  deezer_id text,
  album text,
  duration_ms int,
  artwork_url text,
  track_id uuid references tracks (id) on delete set null,
  primary key (artist_id, rank)
);

alter table tracks add column tags_fetched_at timestamptz;
