create table sessions (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id, last_used_at desc);

create table invites (
  id uuid primary key,
  token_hash bytea not null unique,
  display_name text not null default '',
  username text not null default 'partner',
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  user_id uuid references users (id) on delete set null
);

create table password_resets (
  id uuid primary key,
  user_id uuid not null references users (id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table audit_log (
  id uuid primary key,
  actor_id uuid references users (id) on delete set null,
  action text not null,
  subject text not null default '',
  detail jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_time on audit_log (created_at desc);

alter table users add column last_seen_at timestamptz;
