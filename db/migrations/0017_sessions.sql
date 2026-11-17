create table listening_sessions (
  id uuid primary key,
  title text not null default '',
  created_by uuid not null references users (id) on delete cascade,
  status text not null default 'planned' check (status in ('planned', 'live', 'ended')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  current_key text,
  position_ms bigint not null default 0,
  together_ms bigint not null default 0,
  members uuid[] not null default '{}',
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index listening_sessions_one_live on listening_sessions (status) where status = 'live';
create index listening_sessions_scheduled on listening_sessions (scheduled_at) where status = 'planned';

create table listening_session_items (
  session_id uuid not null references listening_sessions (id) on delete cascade,
  key text not null,
  position integer not null,
  track_id uuid not null references tracks (id) on delete cascade,
  added_by uuid references users (id) on delete set null,
  note text not null default '',
  played_at timestamptz,
  primary key (session_id, key)
);

create index listening_session_items_order on listening_session_items (session_id, position);

alter table chat_messages drop constraint chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'song', 'lyric', 'swap', 'session'));
