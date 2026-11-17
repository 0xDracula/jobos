package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PlaylistCounts struct {
	Total     int `json:"total"`
	Pending   int `json:"pending"`
	Matched   int `json:"matched"`
	Review    int `json:"review"`
	Unmatched int `json:"unmatched"`
	Cached    int `json:"cached"`
}

type PlaylistSummary struct {
	ID          uuid.UUID      `json:"id"`
	Name        string         `json:"name"`
	Kind        string         `json:"kind"`
	SourceURL   *string        `json:"source_url"`
	Provider    *string        `json:"source_provider"`
	SyncEnabled bool           `json:"sync_enabled"`
	SyncedAt    *time.Time     `json:"synced_at"`
	Description *string        `json:"description"`
	OwnerID     *uuid.UUID     `json:"owner_id"`
	CoverURL    *string        `json:"cover_url"`
	RecipientID *uuid.UUID     `json:"recipient_id"`
	Collage     []string       `json:"collage"`
	Counts      PlaylistCounts `json:"counts"`
}

type PlaylistView struct {
	PlaylistSummary
	Tracks []TrackView `json:"tracks"`
}

var playlistSummarySQL = `select p.id, p.name, p.kind, p.source_url, p.source_provider, p.sync_enabled, p.synced_at,
		p.description, p.owner_id, p.recipient_id, (select ` + imageURLSQL("pc") + ` from media_assets pc where pc.id = p.cover_asset_id),
		(select coalesce(array_agg(c.u order by c.pos), '{}') from (
			select min(pi2.position) as pos, '/api/media/' || ma2.sha256 || '.300.jpg' as u
			from playlist_items pi2 join tracks t2 on t2.id = pi2.track_id left join albums al2 on al2.id = t2.album_id
			join media_assets ma2 on ma2.id = coalesce(t2.artwork_asset_id, al2.artwork_asset_id)
			where pi2.playlist_id = p.id group by ma2.sha256 order by pos limit 4) c),
		count(t.id),
		count(t.id) filter (where t.match_status = 'pending'),
		count(t.id) filter (where t.match_status in ('matched', 'chosen')),
		count(t.id) filter (where t.match_status = 'review'),
		count(t.id) filter (where t.match_status = 'unmatched'),
		count(tm.track_id)
	from playlists p
	left join playlist_items pi on pi.playlist_id = p.id
	left join tracks t on t.id = pi.track_id
	left join track_media tm on tm.track_id = t.id and tm.variant = 'main'`

func scanPlaylistSummary(row pgx.Row) (PlaylistSummary, error) {
	var p PlaylistSummary
	c := &p.Counts
	err := row.Scan(&p.ID, &p.Name, &p.Kind, &p.SourceURL, &p.Provider, &p.SyncEnabled, &p.SyncedAt,
		&p.Description, &p.OwnerID, &p.RecipientID, &p.CoverURL, &p.Collage, &c.Total, &c.Pending, &c.Matched, &c.Review, &c.Unmatched, &c.Cached)
	return p, err
}

func (s *Store) Playlists(ctx context.Context) ([]PlaylistSummary, error) {
	rows, err := s.pool.Query(ctx, playlistSummarySQL+` group by p.id order by p.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PlaylistSummary{}
	for rows.Next() {
		p, err := scanPlaylistSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) Playlist(ctx context.Context, id uuid.UUID) (*PlaylistView, error) {
	summary, err := scanPlaylistSummary(s.pool.QueryRow(ctx, playlistSummarySQL+` where p.id = $1 group by p.id`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	tracks, err := s.trackViews(ctx, `join playlist_items pi on pi.track_id = t.id
		where pi.playlist_id = $1 order by pi.position`, id)
	if err != nil {
		return nil, err
	}
	return &PlaylistView{PlaylistSummary: summary, Tracks: tracks}, nil
}

func (s *Store) SetPlaylistRecipient(ctx context.Context, playlistID uuid.UUID, recipient *uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `update playlists set recipient_id = $2, updated_at = now() where id = $1`, playlistID, recipient)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
