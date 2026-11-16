package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func isForeignKey(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23503"
}

func (s *Store) Like(ctx context.Context, userID, trackID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `insert into likes (user_id, track_id) values ($1, $2) on conflict do nothing`, userID, trackID)
	if isForeignKey(err) {
		return ErrNotFound
	}
	return err
}

func (s *Store) Unlike(ctx context.Context, userID, trackID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from likes where user_id = $1 and track_id = $2`, userID, trackID)
	return err
}

func (s *Store) LikedIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select track_id from likes where user_id = $1 order by created_at desc`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

var likeOrders = map[string]string{
	"added":  "l.created_at desc",
	"title":  "lower(t.title), l.created_at desc",
	"artist": "lower(coalesce((select a.name from track_artists ta join artists a on a.id = ta.artist_id where ta.track_id = t.id order by ta.position limit 1), '')), lower(t.title)",
}

func (s *Store) Likes(ctx context.Context, userID uuid.UUID, sort string) ([]TrackView, error) {
	order, ok := likeOrders[sort]
	if !ok {
		return nil, fmt.Errorf("unknown sort %q", sort)
	}
	return s.trackViews(ctx, `join likes l on l.track_id = t.id and l.user_id = $1 order by `+order, userID)
}

var HiddenTypes = map[string]bool{"track": true, "artist": true}

func (s *Store) Hide(ctx context.Context, userID uuid.UUID, itemType string, itemID uuid.UUID) error {
	table := map[string]string{"track": "tracks", "artist": "artists"}[itemType]
	if table == "" {
		return fmt.Errorf("unknown item type %q", itemType)
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, `select exists (select 1 from `+table+` where id = $1)`, itemID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	_, err := s.pool.Exec(ctx, `insert into hidden_items (user_id, item_type, item_id) values ($1, $2, $3) on conflict do nothing`,
		userID, itemType, itemID)
	return err
}

func (s *Store) Unhide(ctx context.Context, userID uuid.UUID, itemType string, itemID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from hidden_items where user_id = $1 and item_type = $2 and item_id = $3`, userID, itemType, itemID)
	return err
}

type HiddenArtist struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	ImageURL *string   `json:"image_url"`
}

func (s *Store) Hidden(ctx context.Context, userID uuid.UUID) ([]TrackView, []HiddenArtist, error) {
	tracks, err := s.trackViews(ctx, `join hidden_items h on h.item_type = 'track' and h.item_id = t.id and h.user_id = $1
		order by h.created_at desc`, userID)
	if err != nil {
		return nil, nil, err
	}
	rows, err := s.pool.Query(ctx, `select a.id, a.name, `+imageURLSQL("img")+` from hidden_items h join artists a on a.id = h.item_id
		left join media_assets img on img.id = a.image_asset_id
		where h.user_id = $1 and h.item_type = 'artist' order by h.created_at desc`, userID)
	if err != nil {
		return nil, nil, err
	}
	artists, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (HiddenArtist, error) {
		var a HiddenArtist
		return a, row.Scan(&a.ID, &a.Name, &a.ImageURL)
	})
	return tracks, artists, err
}

func imageURLSQL(alias string) string {
	return `case when ` + alias + `.sha256 is null then null else '/api/media/' || ` + alias + `.sha256 || '.' ||
		case ` + alias + `.mime when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end end`
}

func (s *Store) HiddenIDs(ctx context.Context, userID uuid.UUID) (tracks, artists []uuid.UUID, err error) {
	rows, err := s.pool.Query(ctx, `select item_type, item_id from hidden_items where user_id = $1`, userID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	tracks, artists = []uuid.UUID{}, []uuid.UUID{}
	for rows.Next() {
		var kind string
		var id uuid.UUID
		if err := rows.Scan(&kind, &id); err != nil {
			return nil, nil, err
		}
		if kind == "track" {
			tracks = append(tracks, id)
		} else {
			artists = append(artists, id)
		}
	}
	return tracks, artists, rows.Err()
}
