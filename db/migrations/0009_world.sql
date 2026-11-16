alter table media_assets add column tempo_bpm real, add column beats jsonb;

create table hidden_notes (
  id uuid primary key,
  spot text not null check (spot in ('moon', 'drawer', 'shooting_star', 'pet_bed', 'frame')),
  title text not null default '',
  body text not null,
  for_user_id uuid references users (id) on delete cascade,
  author_id uuid references users (id) on delete set null,
  unlock_at timestamptz,
  after_note_id uuid references hidden_notes (id) on delete set null,
  created_at timestamptz not null default now()
);

create table found_notes (
  user_id uuid not null references users (id) on delete cascade,
  note_id uuid not null references hidden_notes (id) on delete cascade,
  found_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
