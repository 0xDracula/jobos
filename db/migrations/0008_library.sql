create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  platform text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index devices_user on devices (user_id);

create table user_settings (
  user_id uuid not null references users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table likes (
  user_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
create index likes_user_time on likes (user_id, created_at desc);

create table hidden_items (
  user_id uuid not null references users (id) on delete cascade,
  item_type text not null check (item_type in ('track', 'artist')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

create table playback_states (
  user_id uuid not null references users (id) on delete cascade,
  device_id uuid not null references devices (id) on delete cascade,
  track_id uuid references tracks (id) on delete set null,
  position_ms int not null default 0,
  queue jsonb not null default '[]',
  queue_index int not null default 0,
  shuffle boolean not null default false,
  repeat text not null default 'off' check (repeat in ('off', 'all', 'one')),
  playing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table listening_events (
  id bigserial primary key,
  user_id uuid not null references users (id) on delete cascade,
  device_id uuid references devices (id) on delete set null,
  track_id uuid not null references tracks (id) on delete cascade,
  event text not null check (event in ('start', 'progress', 'complete', 'skip', 'pause', 'resume', 'seek')),
  position_ms int,
  context jsonb,
  created_at timestamptz not null default now()
);
create index listening_events_user_time on listening_events (user_id, created_at desc);
create index listening_events_track on listening_events (track_id, created_at desc);

alter table playlists add column cover_asset_id uuid references media_assets (id);
