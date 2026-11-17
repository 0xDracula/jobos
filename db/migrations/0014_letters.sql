create table letters (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  recipient_id uuid references users (id) on delete cascade,
  kind text not null check (kind in ('welcome', 'standard', 'open_when', 'time_locked')),
  occasion text not null default '',
  title text not null default '',
  body text not null default '',
  playlist_id uuid references playlists (id) on delete set null,
  track_id uuid references tracks (id) on delete set null,
  unlock_at timestamptz,
  opened_at timestamptz,
  unlock_notified_at timestamptz,
  status text not null default 'published' check (status in ('draft', 'published')),
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letters_unlock check ((kind = 'time_locked') = (unlock_at is not null))
);
create unique index letters_welcome on letters (author_id) where kind = 'welcome';
create index letters_author on letters (author_id, created_at desc);
create index letters_unlock_due on letters (unlock_at) where kind = 'time_locked' and unlock_notified_at is null;

create table notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  recipient_id uuid references users (id) on delete cascade,
  kind text not null check (kind in ('daily', 'morning', 'night')),
  body text not null,
  track_id uuid references tracks (id) on delete set null,
  available_on date,
  opened_at timestamptz,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index notes_daily_day on notes (recipient_id, available_on) where kind = 'daily' and available_on is not null;
create index notes_pool on notes (kind, author_id, created_at) where available_on is null;

create table promises (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users (id) on delete cascade,
  body text not null,
  kept_on date,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index promises_created on promises (created_at);

create table picks (
  author_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (author_id, track_id)
);
create index picks_track on picks (track_id);

create table songs_of_the_day (
  author_id uuid not null references users (id) on delete cascade,
  date date not null,
  track_id uuid not null references tracks (id) on delete cascade,
  note text not null default '',
  auto boolean not null default false,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (author_id, date)
);

create table handwriting_fonts (
  user_id uuid primary key references users (id) on delete cascade,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  original_name text not null,
  original_path text not null,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  path text,
  bytes int,
  family text,
  glyphs int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index handwriting_fonts_sha on handwriting_fonts (sha256);
