package store

import (
	"context"
	"errors"

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
	ID        uuid.UUID      `json:"id"`
	Name      string         `json:"name"`
	Kind      string         `json:"kind"`
	SourceURL *string        `json:"source_url"`
	Counts    PlaylistCounts `json:"counts"`
}

type PlaylistView struct {
	PlaylistSummary
	Tracks []TrackView `json:"tracks"`
}

const playlistSummarySQL = `select p.id, p.name, p.kind, p.source_url,
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
	err := row.Scan(&p.ID, &p.Name, &p.Kind, &p.SourceURL, &c.Total, &c.Pending, &c.Matched, &c.Review, &c.Unmatched, &c.Cached)
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
