alter table media_assets add column width int;
alter table media_assets add column height int;
alter table media_assets add column palette jsonb;
alter table albums add column artwork_asset_id uuid references media_assets (id);
alter table tracks add column artwork_asset_id uuid references media_assets (id);
alter table artists add column image_asset_id uuid references media_assets (id);
