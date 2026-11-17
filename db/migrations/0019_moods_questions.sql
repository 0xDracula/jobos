create table moods (
  user_id uuid primary key references users (id) on delete cascade,
  mood text not null,
  note text not null default '',
  set_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table daily_questions (
  id uuid primary key,
  author_id uuid not null references users (id) on delete cascade,
  body text not null,
  kind text not null default 'text' check (kind in ('text', 'song')),
  position int not null default 0,
  asked_on date unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index daily_questions_queue on daily_questions (position, created_at) where asked_on is null;

create table daily_answers (
  question_id uuid not null references daily_questions (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  body text not null default '',
  track_id uuid references tracks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, user_id)
);
