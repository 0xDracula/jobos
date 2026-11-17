alter table chat_messages drop constraint chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check
  check (kind in ('text', 'song', 'lyric', 'swap', 'session', 'voice', 'photo', 'sticker'));

alter table chat_messages add column pinned_at timestamptz;
alter table chat_messages add column pinned_by uuid references users (id) on delete set null;
create index chat_messages_pinned on chat_messages (pinned_at desc) where pinned_at is not null;

create table chat_stickers (
  id uuid primary key,
  name text not null,
  path text not null,
  mime text not null,
  position int not null default 0,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table song_swaps add column reaction text not null default '';
alter table song_swaps add column reaction_at timestamptz;

create function chat_fold(t text) returns text language sql immutable parallel safe as $$
  select lower(translate(regexp_replace(t, '[\u064B-\u065F\u0670\u0640]', '', 'g'), 'أإآٱىةؤئ', 'اااايهوي'))
$$;
