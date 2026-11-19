create function jobbos_user() returns uuid language sql stable as $$
  select case when current_setting('jobbos.user', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then current_setting('jobbos.user', true)::uuid end
$$;

alter table users
  add column private boolean not null default false,
  add column searchable boolean not null default true,
  add column activity_audience text not null default 'friends'
    check (activity_audience in ('followers', 'friends', 'partner', 'none')),
  add column messages_from text not null default 'friends' check (messages_from in ('friends', 'everyone')),
  add column jam_invites_from text not null default 'friends' check (jam_invites_from in ('friends', 'everyone')),
  add column private_session_until timestamptz;

create table follows (
  follower_id uuid not null references users (id) on delete cascade,
  followee_id uuid not null references users (id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'requested')),
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id, status);

insert into follows (follower_id, followee_id)
select a.user_id, b.user_id from pair_members a
join pair_members b on b.pair_id = a.pair_id and b.user_id <> a.user_id
join pairs p on p.id = a.pair_id and p.ended_at is null
on conflict do nothing;

create table conversations (
  id uuid primary key,
  kind text not null check (kind in ('direct', 'group')),
  pair_id uuid unique references pairs (id) on delete cascade,
  direct_key text unique,
  title text not null default '',
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table conversation_members (
  conversation_id uuid not null references conversations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  accepted boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on conversation_members (user_id);

create function jobbos_conversation_ok(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select jobbos_any_pair() or exists (
    select 1 from conversations x left join pairs p on p.id = x.pair_id
    where x.id = c and (x.pair_id is null or p.ended_at is null)
      and ((x.pair_id is not null and x.pair_id = jobbos_pair())
        or exists (select 1 from conversation_members m where m.conversation_id = c and m.user_id = jobbos_user())))
$$;

insert into conversations (id, kind, pair_id, created_at, last_message_at)
select gen_random_uuid(), 'direct', p.id, p.created_at, (select max(m.created_at) from chat_messages m where m.pair_id = p.id)
from pairs p;
insert into conversation_members (conversation_id, user_id, joined_at)
select c.id, m.user_id, c.created_at from conversations c join pair_members m on m.pair_id = c.pair_id;

alter table chat_messages add column conversation_id uuid references conversations (id) on delete cascade;
update chat_messages m set conversation_id = c.id from conversations c where c.pair_id = m.pair_id;
delete from chat_messages where conversation_id is null;
alter table chat_messages alter column conversation_id set not null, alter column pair_id drop default;
create index chat_messages_conversation_time on chat_messages (conversation_id, created_at desc, id desc);

alter table chat_reactions add column conversation_id uuid references conversations (id) on delete cascade;
update chat_reactions r set conversation_id = m.conversation_id from chat_messages m where m.id = r.message_id;
delete from chat_reactions where conversation_id is null;
alter table chat_reactions alter column conversation_id set not null, alter column pair_id drop default;

alter table chat_reads add column conversation_id uuid references conversations (id) on delete cascade;
update chat_reads r set conversation_id = c.id from conversations c where c.pair_id = r.pair_id;
delete from chat_reads where conversation_id is null;
alter table chat_reads drop constraint chat_reads_pkey;
alter table chat_reads alter column pair_id drop not null, alter column pair_id drop default,
  alter column conversation_id set not null, add primary key (conversation_id, user_id);

update conversations c set pair_id = null,
  direct_key = (select string_agg(m.user_id::text, ':' order by m.user_id::text) from conversation_members m where m.conversation_id = c.id)
from pairs p where p.id = c.pair_id and p.kind = 'friend';
update pairs set ended_at = now() where kind = 'friend' and ended_at is null;

do $$
declare
  t text;
begin
  foreach t in array array['chat_messages', 'chat_reactions', 'chat_reads'] loop
    execute format('drop policy pair_rows on %I', t);
    execute format('create policy conversation_rows on %I using (jobbos_conversation_ok(conversation_id)) '
      'with check (jobbos_conversation_ok(conversation_id))', t);
  end loop;
end $$;

drop policy pair_rows on chat_stickers;
alter table chat_stickers disable row level security;
alter table chat_stickers alter column pair_id drop default;

alter table photos add column conversation_id uuid references conversations (id) on delete cascade;
alter table voice_clips add column conversation_id uuid references conversations (id) on delete cascade;
do $$
declare
  t text;
begin
  foreach t in array array['photos', 'voice_clips'] loop
    execute format('drop policy pair_rows on %I', t);
    execute format('create policy pair_rows on %I using (jobbos_any_pair() or pair_id = jobbos_pair() '
      'or (conversation_id is not null and jobbos_conversation_ok(conversation_id))) '
      'with check (jobbos_any_pair() or pair_id = jobbos_pair() '
      'or (conversation_id is not null and jobbos_conversation_ok(conversation_id)))', t);
  end loop;
end $$;

alter table listening_sessions
  add column conversation_id uuid references conversations (id) on delete set null,
  add column audience uuid[] not null default '{}',
  add column friends_join boolean not null default true,
  add column anyone_add boolean not null default true,
  add column anyone_skip boolean not null default true,
  add column link_token text unique;
create unique index listening_sessions_one_live_host on listening_sessions (created_by) where status = 'live';

create function jobbos_jam_ok(s_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from listening_sessions s
    where s.id = s_id and s.pair_id is null and (
      s.created_by = jobbos_user()
      or jobbos_user() = any (s.audience)
      or jobbos_user() = any (s.members)
      or (s.conversation_id is not null and exists (
        select 1 from conversation_members m where m.conversation_id = s.conversation_id and m.user_id = jobbos_user()))
      or (s.friends_join and exists (
        select 1 from follows a join follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
        where a.follower_id = jobbos_user() and a.followee_id = s.created_by and a.status = 'accepted' and b.status = 'accepted'))))
$$;

drop policy pair_rows on listening_sessions;
create policy pair_rows on listening_sessions
  using (jobbos_any_pair() or pair_id = jobbos_pair() or (pair_id is null and jobbos_jam_ok(id)))
  with check (jobbos_any_pair() or pair_id = jobbos_pair()
    or (pair_id is null and (created_by = jobbos_user() or jobbos_jam_ok(id))));

drop policy pair_rows on listening_session_items;
alter table listening_session_items alter column pair_id drop default;
create policy session_rows on listening_session_items
  using (exists (select 1 from listening_sessions s where s.id = listening_session_items.session_id))
  with check (exists (select 1 from listening_sessions s where s.id = listening_session_items.session_id));

alter table playlists add column visibility text not null default 'private'
  check (visibility in ('public', 'friends', 'partner', 'private'));

create table track_highlights (
  track_id uuid primary key references tracks (id) on delete cascade,
  start_ms integer not null check (start_ms >= 0),
  source text not null check (source in ('replayed', 'chorus')),
  heat real[],
  updated_at timestamptz not null default now()
);

create table previews (
  user_id uuid not null references users (id) on delete cascade,
  track_id uuid not null references tracks (id) on delete cascade,
  mode text not null check (mode in ('you', 'friends')),
  reason text not null default '',
  from_user uuid references users (id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  reaction text check (reaction in ('like', 'skip', 'add', 'send', 'full')),
  primary key (user_id, mode, track_id)
);
create index previews_feed_idx on previews (user_id, mode, position);
