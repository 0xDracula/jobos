create table photo_albums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  cover_photo_id uuid,
  track_id uuid references tracks (id) on delete set null,
  created_by uuid not null references users (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid references photo_albums (id) on delete cascade,
  position int not null default 0,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  original_path text,
  asset_id uuid references media_assets (id),
  thumb_asset_id uuid references media_assets (id),
  original_asset_id uuid references media_assets (id),
  width int,
  height int,
  caption text not null default '',
  taken_on date,
  uploaded_by uuid not null references users (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index photos_album on photos (album_id, position, created_at);
create index photos_created on photos (created_at);

alter table photo_albums add constraint photo_albums_cover_photo
  foreign key (cover_photo_id) references photos (id) on delete set null;

create table memories (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users (id) on delete cascade,
  date date not null,
  title text not null default '',
  caption text not null default '',
  photo_id uuid references photos (id) on delete set null,
  track_id uuid references tracks (id) on delete set null,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_date on memories (date desc, created_at desc);
create index memories_track on memories (track_id);

create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  date date,
  note text not null default '',
  photo_id uuid references photos (id) on delete set null,
  track_id uuid references tracks (id) on delete set null,
  created_by uuid not null references users (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table story_chapters (
  id uuid primary key default gen_random_uuid(),
  position int not null,
  title text not null,
  date_from date,
  date_to date,
  body text not null default '',
  track_id uuid references tracks (id) on delete set null,
  created_by uuid not null references users (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index story_chapters_position on story_chapters (position, created_at);

create table story_chapter_photos (
  chapter_id uuid not null references story_chapters (id) on delete cascade,
  photo_id uuid not null references photos (id) on delete cascade,
  position int not null,
  primary key (chapter_id, photo_id)
);
create index story_chapter_photos_photo on story_chapter_photos (photo_id);

create table collection_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  reason text not null default '',
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create table glossary_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'joke' check (kind in ('joke', 'nickname')),
  term text not null,
  body text not null default '',
  started_on date,
  photo_id uuid references photos (id) on delete set null,
  track_id uuid references tracks (id) on delete set null,
  created_by uuid not null references users (id) on delete cascade,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
