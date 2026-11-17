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
	ID        uuid.UUID       `json:"id"`
	Name      string          `json:"name"`
	ImageURL  *string         `json:"image_url"`
	Bio       *string         `json:"bio"`
	BioSource *string         `json:"bio_source"`
	BioURL    *string         `json:"bio_url"`
	Tags      []string        `json:"tags"`
	TopTracks []TopTrack      `json:"top_tracks"`
	Tracks    []TrackView     `json:"tracks"`
	Albums    []AlbumSummary  `json:"albums"`
	Similar   []SimilarArtist `json:"similar"`
	Enriched  bool            `json:"enriched"`
}

type TopTrack struct {
	Rank       int        `json:"rank"`
	Title      string     `json:"title"`
	Album      *string    `json:"album"`
	DurationMs *int32     `json:"duration_ms"`
	ArtworkURL *string    `json:"artwork_url"`
	Track      *TrackView `json:"track"`
}

type SimilarArtist struct {
	Name     string     `json:"name"`
	ImageURL *string    `json:"image_url"`
	ArtistID *uuid.UUID `json:"artist_id"`
}

const sameArtistSQL = `select x.id from artists x where x.id = $1 or lower(x.name) = lower((select name from artists where id = $1))`

func titleKeySQL(expr string) string {
	return `lower(trim(regexp_replace(` + expr + `, '\s*[\(\[].*$', '')))`
}

func (s *Store) Artist(ctx context.Context, userID, id uuid.UUID) (*ArtistView, error) {
	a := ArtistView{ID: id}
	err := s.pool.QueryRow(ctx, `select a.name, coalesce(`+imageURLSQL("img")+`, a.image_url), a.bio, a.bio_source, a.bio_url,
			a.enriched_at is not null
		from artists a left join media_assets img on img.id = a.image_asset_id where a.id = $1`, id).
		Scan(&a.Name, &a.ImageURL, &a.Bio, &a.BioSource, &a.BioURL, &a.Enriched)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := s.artistExtras(ctx, &a); err != nil {
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

func (s *Store) artistExtras(ctx context.Context, a *ArtistView) error {
	rows, err := s.pool.Query(ctx, `select t.name from artist_tags x join tags t on t.id = x.tag_id where x.artist_id = $1
		group by t.name order by max(x.weight) desc, t.name limit 8`, a.ID)
	if err != nil {
		return err
	}
	if a.Tags, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		return err
	}
	rows, err = s.pool.Query(ctx, `select tt.rank, tt.title, tt.album, tt.duration_ms, tt.artwork_url,
			coalesce(tt.track_id, (select t.id from tracks t join track_artists ta on ta.track_id = t.id
				where ta.artist_id in (`+sameArtistSQL+`) and `+titleKeySQL("t.title")+` = `+titleKeySQL("tt.title")+`
				order by exists (select 1 from track_media tm where tm.track_id = t.id and tm.variant = 'main') desc, t.created_at
				limit 1))
		from artist_top_tracks tt where tt.artist_id = $1 order by tt.rank`, a.ID)
	if err != nil {
		return err
	}
	type top struct {
		TopTrack
		trackID *uuid.UUID
	}
	tops, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (top, error) {
		var t top
		return t, row.Scan(&t.Rank, &t.Title, &t.Album, &t.DurationMs, &t.ArtworkURL, &t.trackID)
	})
	if err != nil {
		return err
	}
	var ids []uuid.UUID
	for _, t := range tops {
		if t.trackID != nil {
			ids = append(ids, *t.trackID)
		}
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return err
	}
	a.TopTracks = make([]TopTrack, len(tops))
	for i, t := range tops {
		a.TopTracks[i] = t.TopTrack
		if t.trackID != nil {
			if v, ok := views[*t.trackID]; ok {
				a.TopTracks[i].Track = &v
			}
		}
	}
	rows, err = s.pool.Query(ctx, `select r.name, coalesce(`+imageURLSQL("img")+`, r.image_url), lib.id
		from artist_related r
		left join lateral (select x.id, x.image_asset_id from artists x
			where x.id = r.related_artist_id or (x.id <> $1 and (x.deezer_id = r.deezer_id or lower(x.name) = lower(r.name)))
			order by x.id = r.related_artist_id desc nulls last, x.deezer_id = r.deezer_id desc nulls last, x.created_at
			limit 1) lib on true
		left join media_assets img on img.id = lib.image_asset_id
		where r.artist_id = $1 order by r.rank`, a.ID)
	if err != nil {
		return err
	}
	a.Similar, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (SimilarArtist, error) {
		var s SimilarArtist
		return s, row.Scan(&s.Name, &s.ImageURL, &s.ArtistID)
	})
	return err
}

func (s *Store) AddTopTrack(ctx context.Context, artistID uuid.UUID, rank int) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var title, artistName string
	var album, artworkURL *string
	var duration *int32
	var trackID *uuid.UUID
	err = tx.QueryRow(ctx, `select tt.title, tt.album, tt.duration_ms, tt.artwork_url, a.name,
			coalesce((select t.id from tracks t where t.id = tt.track_id), (select t.id from tracks t join track_artists ta on ta.track_id = t.id
				where ta.artist_id in (`+sameArtistSQL+`) and `+titleKeySQL("t.title")+` = `+titleKeySQL("tt.title")+`
				order by exists (select 1 from track_media tm where tm.track_id = t.id and tm.variant = 'main') desc, t.created_at
				limit 1))
		from artist_top_tracks tt join artists a on a.id = tt.artist_id
		where tt.artist_id = $1 and tt.rank = $2 for update of tt`, artistID, rank).
		Scan(&title, &album, &duration, &artworkURL, &artistName, &trackID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if trackID == nil {
		id := newID()
		trackID = &id
		var albumID *uuid.UUID
		if album != nil && *album != "" {
			err := tx.QueryRow(ctx, `select al.id from albums al join tracks t on t.album_id = al.id
				join track_artists ta on ta.track_id = t.id
				where ta.artist_id in (`+sameArtistSQL+`) and lower(al.title) = lower($2) limit 1`, artistID, *album).Scan(&albumID)
			if errors.Is(err, pgx.ErrNoRows) {
				aid, aerr := upsertAlbum(ctx, tx, "ytmusic_id", "", *album, artworkURL)
				if aerr != nil {
					return uuid.Nil, aerr
				}
				albumID, err = &aid, nil
			}
			if err != nil {
				return uuid.Nil, err
			}
		}
		if _, err := tx.Exec(ctx, `insert into tracks (id, title, album_id, duration_ms, artwork_url, match_status)
			values ($1, $2, $3, $4, $5, 'pending')`, id, title, albumID, duration, artworkURL); err != nil {
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, 0)`, id, artistID); err != nil {
			return uuid.Nil, err
		}
		p := MatchPayload{TrackID: id, Title: title, Artists: []string{artistName}}
		if album != nil {
			p.Album = *album
		}
		if duration != nil {
			p.DurationMs = *duration
		}
		if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindMatchTrack, Payload: p, DedupeKey: MatchKey(id), Priority: PriorityInteractive}); err != nil {
			return uuid.Nil, err
		}
	}
	if _, err := tx.Exec(ctx, `update artist_top_tracks set track_id = $3 where artist_id = $1 and rank = $2`, artistID, rank, *trackID); err != nil {
		return uuid.Nil, err
	}
	return *trackID, tx.Commit(ctx)
}

func (s *Store) SearchLibrary(ctx context.Context, q string, limit int) ([]TrackView, error) {
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.TrimSpace(q)) + "%"
	return s.trackViews(ctx, `left join albums sal on sal.id = t.album_id
		where t.title ilike $1 or sal.title ilike $1
			or exists (select 1 from track_artists ta join artists a on a.id = ta.artist_id where ta.track_id = t.id and a.name ilike $1)
		order by lower(t.title) limit $2`, pattern, limit)
}
