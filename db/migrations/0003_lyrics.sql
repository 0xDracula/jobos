alter table lyrics add column instrumental boolean not null default false;
alter table lyrics add column duration_ms int;
alter table lyrics add constraint lyrics_source check (source in ('lrclib', 'ytmusic', 'manual'));
