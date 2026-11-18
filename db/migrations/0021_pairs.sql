do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'jobbos_app') then
    create role jobbos_app nologin;
  end if;
end $$;
grant jobbos_app to current_user;
grant usage on schema public to jobbos_app;
grant all privileges on all tables in schema public to jobbos_app;
grant all privileges on all sequences in schema public to jobbos_app;
alter default privileges in schema public grant all privileges on tables to jobbos_app;
alter default privileges in schema public grant all privileges on sequences to jobbos_app;

create function jobbos_pair() returns uuid language sql stable as $$
  select case when current_setting('jobbos.pair', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then current_setting('jobbos.pair', true)::uuid end
$$;

create function jobbos_any_pair() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('jobbos.pair', true), ''), 'any') = 'any'
$$;

create table pairs (
  id uuid primary key,
  kind text not null check (kind in ('partner', 'friend')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references users(id) on delete set null
);

create table pair_members (
  pair_id uuid not null references pairs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (pair_id, user_id)
);
create index pair_members_user_idx on pair_members (user_id);

create table pair_settings (
  pair_id uuid not null default jobbos_pair() references pairs(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (pair_id, key)
);

alter table invites add column link_kind text check (link_kind in ('partner', 'friend'));

do $$
declare
  p uuid := gen_random_uuid();
begin
  if (select count(*) from users) = 2 then
    insert into pairs (id, kind) values (p, 'partner');
    insert into pair_members (pair_id, user_id) select p, id from users;
  end if;
end $$;

insert into pair_settings (pair_id, key, value)
select (select id from pairs order by created_at limit 1), key, value from app_settings
where exists (select 1 from pairs)
  and (key in ('our_song', 'milestones', 'visibility', 'gift.her_playlist', 'dates.member_birthdays', 'swaps.revealed') or key like 'placeholders.%');
delete from app_settings
where exists (select 1 from pairs)
  and (key in ('our_song', 'milestones', 'visibility', 'gift.her_playlist', 'dates.member_birthdays', 'swaps.revealed') or key like 'placeholders.%');

do $$
declare
  t text;
  first_pair uuid := (select id from pairs order by created_at limit 1);
begin
  foreach t in array array[
    'chat_messages', 'chat_reactions', 'chat_reads', 'chat_stickers', 'signals', 'song_swaps',
    'listening_sessions', 'listening_session_items', 'daily_questions', 'daily_answers',
    'letters', 'notes', 'hidden_notes', 'found_notes', 'picks', 'songs_of_the_day', 'promises',
    'recap_notes', 'song_notes', 'memories', 'photo_albums', 'photos', 'places', 'story_chapters',
    'story_chapter_photos', 'collection_items', 'glossary_entries', 'important_dates',
    'calendar_reminders', 'dedications', 'voice_clips', 'mixtapes', 'mixtape_tracks',
    'scrapbook_clippings', 'favorite_lists'
  ] loop
    execute format('alter table %I add column pair_id uuid default jobbos_pair() references pairs(id) on delete cascade', t);
    execute format('update %I set pair_id = $1', t) using first_pair;
    execute format('create index %I on %I (pair_id)', t || '_pair_idx', t);
  end loop;
  foreach t in array array[
    'pair_settings', 'chat_messages', 'chat_reactions', 'chat_reads', 'chat_stickers', 'signals',
    'song_swaps', 'listening_sessions', 'listening_session_items', 'daily_questions',
    'daily_answers', 'letters', 'notes', 'hidden_notes', 'found_notes', 'picks',
    'songs_of_the_day', 'promises', 'recap_notes', 'song_notes', 'memories', 'photo_albums',
    'photos', 'places', 'story_chapters', 'story_chapter_photos', 'collection_items',
    'glossary_entries', 'important_dates', 'calendar_reminders', 'dedications', 'voice_clips',
    'mixtapes', 'mixtape_tracks', 'scrapbook_clippings', 'favorite_lists'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy pair_rows on %I using (jobbos_any_pair() or pair_id = jobbos_pair()) '
      'with check (jobbos_any_pair() or pair_id = jobbos_pair())', t);
  end loop;
end $$;

grant all privileges on pairs, pair_members, pair_settings to jobbos_app;

alter table daily_questions drop constraint daily_questions_asked_on_key;
create unique index daily_questions_pair_day on daily_questions (pair_id, asked_on);
drop index listening_sessions_one_live;
create unique index listening_sessions_one_live on listening_sessions (pair_id) where status = 'live';
drop index letters_welcome;
create unique index letters_welcome on letters (pair_id, author_id) where kind = 'welcome';
drop index notes_daily_day;
create unique index notes_daily_day on notes (pair_id, recipient_id, available_on) where kind = 'daily' and available_on is not null;
alter table recap_notes drop constraint recap_notes_author_id_period_starts_on_key;
create unique index recap_notes_pair_period on recap_notes (pair_id, author_id, period, starts_on);
alter table song_swaps drop constraint song_swaps_week_user_id_key;
create unique index song_swaps_pair_week on song_swaps (pair_id, week, user_id);
alter table collection_items drop constraint collection_items_user_id_track_id_key;
create unique index collection_items_pair_track on collection_items (pair_id, user_id, track_id);
delete from chat_reads where pair_id is null;
alter table chat_reads alter column pair_id set not null, drop constraint chat_reads_pkey, add primary key (pair_id, user_id);
delete from favorite_lists where pair_id is null;
alter table favorite_lists alter column pair_id set not null, drop constraint favorite_lists_pkey, add primary key (pair_id, user_id);
delete from songs_of_the_day where pair_id is null;
alter table songs_of_the_day alter column pair_id set not null, drop constraint songs_of_the_day_pkey, add primary key (pair_id, author_id, date);

create function jobbos_people() returns setof uuid language sql stable as $$
  select u.id from users u
  where jobbos_any_pair()
     or u.id in (select m.user_id from pair_members m where m.pair_id = jobbos_pair())
     or u.id::text = current_setting('jobbos.user', true)
$$;
