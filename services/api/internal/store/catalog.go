package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AlbumView struct {
	ID         uuid.UUID       `json:"id"`
	Title      string          `json:"title"`
	Year       *int32          `json:"year"`
	ArtworkURL *string         `json:"artwork_url"`
	Palette    json.RawMessage `json:"palette,omitempty"`
	Artists    []string        `json:"artists"`
	Tracks     []TrackView     `json:"tracks"`
}

func (s *Store) Album(ctx context.Context, id uuid.UUID) (*AlbumView, error) {
	a := AlbumView{ID: id}
	var palette []byte
	err := s.pool.QueryRow(ctx, `select al.title, al.year, coalesce(`+imageURLSQL("art")+`, al.artwork_url), art.palette
		from albums al left join media_assets art on art.id = al.artwork_asset_id where al.id = $1`, id).
		Scan(&a.Title, &a.Year, &a.ArtworkURL, &palette)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	a.Palette = palette
	if a.Tracks, err = s.trackViews(ctx, `where t.album_id = $1 order by t.created_at`, id); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	a.Artists = []string{}
	for _, t := range a.Tracks {
		for _, name := range t.Artists {
			if !seen[name] {
				seen[name] = true
				a.Artists = append(a.Artists, name)
			}
		}
	}
	return &a, nil
}

type AlbumSummary struct {
	ID         uuid.UUID `json:"id"`
	Title      string    `json:"title"`
	ArtworkURL *string   `json:"artwork_url"`
	Tracks     int       `json:"tracks"`
}

type ArtistView struct {
	ID       uuid.UUID      `json:"id"`
	Name     string         `json:"name"`
	ImageURL *string        `json:"image_url"`
	Bio      *string        `json:"bio"`
	Tracks   []TrackView    `json:"tracks"`
	Albums   []AlbumSummary `json:"albums"`
}

func (s *Store) Artist(ctx context.Context, userID, id uuid.UUID) (*ArtistView, error) {
	a := ArtistView{ID: id}
	err := s.pool.QueryRow(ctx, `select a.name, coalesce(`+imageURLSQL("img")+`, a.image_url), a.bio
		from artists a left join media_assets img on img.id = a.image_asset_id where a.id = $1`, id).Scan(&a.Name, &a.ImageURL, &a.Bio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if a.Tracks, err = s.trackViews(ctx, `where t.id in (select ta.track_id from track_artists ta join artists x on x.id = ta.artist_id
			where x.id = $1 or lower(x.name) = lower($2))
		order by (select count(*) from listening_events e where e.track_id = t.id and e.user_id = $3 and e.event = 'start') desc,
			lower(t.title)`, id, a.Name, userID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `select al.id, al.title, coalesce(`+imageURLSQL("art")+`, al.artwork_url), count(*)
		from tracks t join albums al on al.id = t.album_id left join media_assets art on art.id = al.artwork_asset_id
		where t.id in (select ta.track_id from track_artists ta join artists x on x.id = ta.artist_id where x.id = $1 or lower(x.name) = lower($2))
		group by al.id, art.sha256, art.mime order by count(*) desc, lower(al.title)`, id, a.Name)
	if err != nil {
		return nil, err
	}
	a.Albums, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (AlbumSummary, error) {
		var al AlbumSummary
		return al, row.Scan(&al.ID, &al.Title, &al.ArtworkURL, &al.Tracks)
	})
	return &a, err
}

func (s *Store) SearchLibrary(ctx context.Context, q string, limit int) ([]TrackView, error) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(q)) + "%"
	return s.trackViews(ctx, `left join albums sal on sal.id = t.album_id
		where t.title ilike $1 or sal.title ilike $1
			or exists (select 1 from track_artists ta join artists a on a.id = ta.artist_id where ta.track_id = t.id and a.name ilike $1)
		order by lower(t.title) limit $2`, pattern, limit)
}
