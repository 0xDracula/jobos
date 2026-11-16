alter table users add column avatar jsonb;

create table favorite_lists (
  user_id uuid primary key references users (id) on delete cascade,
  items jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table song_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  line_index int,
  line_text text,
  line_ms int,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index song_notes_track on song_notes (track_id);
create index song_notes_created on song_notes (created_at desc);

create table scrapbook_clippings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  lines jsonb not null,
  created_at timestamptz not null default now()
);
create index scrapbook_created on scrapbook_clippings (created_at desc);

create table voice_clips (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  original_path text not null,
  asset_id uuid references media_assets (id),
  duration_ms int,
  created_at timestamptz not null default now()
);

create table dedications (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  clip_id uuid not null references voice_clips (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index dedications_track on dedications (track_id);

create table mixtapes (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references users (id) on delete cascade,
  to_user uuid not null references users (id) on delete cascade,
  title text not null,
  color text not null default '#c86b5e',
  note text not null default '',
  intro_clip_id uuid references voice_clips (id) on delete set null,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mixtapes_to on mixtapes (to_user, sent_at desc);

create table mixtape_tracks (
  mixtape_id uuid not null references mixtapes (id) on delete cascade,
  position int not null,
  side text not null check (side in ('A', 'B')),
  track_id uuid not null references tracks (id) on delete cascade,
  note text not null default '',
  primary key (mixtape_id, position)
);

create table recent_searches (
  user_id uuid not null references users (id) on delete cascade,
  query text not null,
  searched_at timestamptz not null default now(),
  primary key (user_id, query)
);
create index recent_searches_user on recent_searches (user_id, searched_at desc);

create table match_checks (
  track_id uuid primary key references tracks (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  verdict text not null check (verdict in ('correct', 'wrong')),
  checked_at timestamptz not null default now()
);
