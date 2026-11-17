create table important_dates (
  id uuid primary key,
  kind text not null check (kind in ('birthday', 'anniversary', 'holiday', 'countdown', 'milestone', 'plan', 'other')),
  label text not null,
  date date not null,
  time time,
  note text not null default '',
  recurring boolean not null default false,
  surprise boolean not null default false,
  user_id uuid references users (id) on delete set null,
  author_id uuid references users (id) on delete set null,
  playlist_id uuid references playlists (id) on delete set null,
  decorations text[] not null default '{}',
  remind_minutes int check (remind_minutes between 0 and 43200),
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index important_dates_date on important_dates (date);

create table calendar_reminders (
  event_id text not null,
  occurs_on date not null,
  user_id uuid not null references users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (event_id, occurs_on, user_id)
);

create table recap_notes (
  id uuid primary key,
  author_id uuid not null references users (id) on delete cascade,
  period text not null check (period in ('month', 'year')),
  starts_on date not null,
  body text not null,
  placeholder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, period, starts_on)
);

create table recap_views (
  user_id uuid not null references users (id) on delete cascade,
  period text not null check (period in ('month', 'year')),
  starts_on date not null,
  opened_at timestamptz not null default now(),
  primary key (user_id, period, starts_on)
);

create index listening_events_together on listening_events (created_at)
  where event = 'progress' and context->>'id' = 'together';
