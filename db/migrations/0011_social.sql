create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table chat_messages (
  id uuid primary key,
  sender_id uuid not null references users (id) on delete cascade,
  client_key text not null,
  kind text not null default 'text' check (kind in ('text', 'song', 'lyric', 'swap')),
  body text not null default '',
  data jsonb,
  reply_to uuid references chat_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (sender_id, client_key)
);
create index chat_messages_time on chat_messages (created_at desc);

create table chat_reactions (
  message_id uuid not null references chat_messages (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table chat_reads (
  user_id uuid primary key references users (id) on delete cascade,
  message_id uuid references chat_messages (id) on delete set null,
  read_at timestamptz not null default now()
);

create table signals (
  id uuid primary key,
  from_user uuid not null references users (id) on delete cascade,
  to_user uuid not null references users (id) on delete cascade,
  kind text not null check (kind in ('lamp')),
  on_until timestamptz,
  created_at timestamptz not null default now()
);
create index signals_to on signals (to_user, created_at desc);

create table push_subscriptions (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table song_swaps (
  id uuid primary key,
  week date not null,
  user_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week, user_id)
);
