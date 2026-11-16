alter table tracks add column match_status text
  check (match_status in ('pending', 'matched', 'review', 'unmatched', 'chosen'));
update tracks t set match_status = 'chosen'
  where exists (select 1 from track_sources s where s.track_id = t.id and s.status = 'selected');
create index tracks_match_status on tracks (match_status) where match_status in ('pending', 'review', 'unmatched');

create index jobs_dedupe_latest on jobs (dedupe_key, id desc) where dedupe_key is not null;
create index jobs_background_started on jobs (kind, locked_at) where priority <= 0 and locked_at is not null;
