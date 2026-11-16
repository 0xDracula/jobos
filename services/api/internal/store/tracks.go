package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var Providers = map[string]bool{"ytmusic": true, "youtube": true, "soundcloud": true, "other": true}

type ArtistRef struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

type AlbumRef struct {
	Name string `json:"name"`
	ID   string `json:"id"`
}

type SourceTrack struct {
	Provider   string      `json:"provider"`
	ExternalID string      `json:"external_id"`
	Title      string      `json:"title"`
	Artists    []ArtistRef `json:"artists"`
	Album      *AlbumRef   `json:"album"`
	DurationMs *int32      `json:"duration_ms"`
	Thumbnail  *string     `json:"thumbnail"`
	Explicit   bool        `json:"explicit"`
}

func (t SourceTrack) Validate() error {
	switch {
	case !Providers[t.Provider]:
		return fmt.Errorf("unknown provider %q", t.Provider)
	case t.ExternalID == "" || len(t.ExternalID) > 512:
		return errors.New("external_id is required (512 characters at most)")
	case t.Title == "" || len(t.Title) > 500:
		return errors.New("title is required (500 characters at most)")
	}
	return nil
}

func (s *Store) AddTrackFromSource(ctx context.Context, in SourceTrack) (trackID, sourceID uuid.UUID, created bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `select track_id, id from track_sources
		where provider = $1 and external_id = $2 and status = 'selected' limit 1`,
		in.Provider, in.ExternalID).Scan(&trackID, &sourceID)
	if err == nil {
		return trackID, sourceID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return
	}

	var albumID *uuid.UUID
	if in.Album != nil && in.Album.Name != "" {
		id, aerr := upsertAlbum(ctx, tx, *in.Album)
		if aerr != nil {
			return trackID, sourceID, false, aerr
		}
		albumID = &id
	}
	trackID = newID()
	if _, err = tx.Exec(ctx, `insert into tracks (id, title, album_id, duration_ms, explicit, artwork_url)
		values ($1, $2, $3, $4, $5, $6)`,
		trackID, in.Title, albumID, in.DurationMs, in.Explicit, in.Thumbnail); err != nil {
		return
	}
	for i, a := range in.Artists {
		if a.Name == "" {
			continue
		}
		artistID, aerr := upsertArtist(ctx, tx, a)
		if aerr != nil {
			return trackID, sourceID, false, aerr
		}
		if _, err = tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3)`,
			trackID, artistID, i); err != nil {
			return
		}
	}
	sourceID = newID()
	if _, err = tx.Exec(ctx, `insert into track_sources (id, track_id, provider, external_id, raw_title, duration_ms, match_score, status)
		values ($1, $2, $3, $4, $5, $6, 1, 'selected')`,
		sourceID, trackID, in.Provider, in.ExternalID, in.Title, in.DurationMs); err != nil {
		return
	}
	return trackID, sourceID, true, tx.Commit(ctx)
}

func upsertArtist(ctx context.Context, tx pgx.Tx, a ArtistRef) (uuid.UUID, error) {
	var id uuid.UUID
	if a.ID != "" {
		err := tx.QueryRow(ctx, `insert into artists (id, name, ytmusic_id) values ($1, $2, $3)
			on conflict (ytmusic_id) where ytmusic_id is not null
			do update set name = excluded.name, updated_at = now()
			returning id`, newID(), a.Name, a.ID).Scan(&id)
		return id, err
	}
	err := tx.QueryRow(ctx, `select id from artists where lower(name) = lower($1) order by created_at limit 1`, a.Name).Scan(&id)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return id, err
	}
	id = newID()
	_, err = tx.Exec(ctx, `insert into artists (id, name) values ($1, $2)`, id, a.Name)
	return id, err
}

func upsertAlbum(ctx context.Context, tx pgx.Tx, a AlbumRef) (uuid.UUID, error) {
	var id uuid.UUID
	if a.ID != "" {
		err := tx.QueryRow(ctx, `insert into albums (id, title, ytmusic_id) values ($1, $2, $3)
			on conflict (ytmusic_id) where ytmusic_id is not null
			do update set title = excluded.title, updated_at = now()
			returning id`, newID(), a.Name, a.ID).Scan(&id)
		return id, err
	}
	id = newID()
	_, err := tx.Exec(ctx, `insert into albums (id, title) values ($1, $2)`, id, a.Name)
	return id, err
}

type AudioView struct {
	URL          string          `json:"url"`
	DurationMs   *int32          `json:"duration_ms"`
	LoudnessLUFS *float32        `json:"loudness_lufs"`
	GainDB       *float32        `json:"gain_db"`
	Waveform     json.RawMessage `json:"waveform"`
}

type TrackView struct {
	ID         uuid.UUID  `json:"id"`
	Title      string     `json:"title"`
	Artists    []string   `json:"artists"`
	Album      *string    `json:"album"`
	DurationMs *int32     `json:"duration_ms"`
	ArtworkURL *string    `json:"artwork_url"`
	Status     string     `json:"status"`
	Error      *string    `json:"error,omitempty"`
	Audio      *AudioView `json:"audio,omitempty"`
	sourceID   uuid.NullUUID
}

var ErrNotFound = errors.New("not found")

func (s *Store) Track(ctx context.Context, id uuid.UUID) (*TrackView, error) {
	var (
		v        TrackView
		sha      *string
		mDur     *int32
		loudness *float32
		gain     *float32
		waveform []byte
	)
	err := s.pool.QueryRow(ctx, `select t.id, t.title, al.title, t.duration_ms, t.artwork_url,
			coalesce((select array_agg(a.name order by ta.position) from track_artists ta
				join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}'),
			ma.sha256, ma.duration_ms, ma.loudness_lufs, ma.gain_db, ma.waveform,
			(select ts.id from track_sources ts where ts.track_id = t.id and ts.status = 'selected')
		from tracks t
		left join albums al on al.id = t.album_id
		left join track_media tm on tm.track_id = t.id and tm.variant = 'main'
		left join media_assets ma on ma.id = tm.asset_id
		where t.id = $1`, id).Scan(&v.ID, &v.Title, &v.Album, &v.DurationMs, &v.ArtworkURL, &v.Artists,
		&sha, &mDur, &loudness, &gain, &waveform, &v.sourceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if sha != nil {
		v.Status = "cached"
		v.Audio = &AudioView{URL: "/api/media/" + *sha + ".m4a", DurationMs: mDur, LoudnessLUFS: loudness, GainDB: gain, Waveform: waveform}
		return &v, nil
	}
	v.Status = "missing"
	if v.sourceID.Valid {
		var status string
		var lastErr *string
		err := s.pool.QueryRow(ctx, `select status, last_error from jobs where dedupe_key = $1 order by id desc limit 1`,
			DownloadKey(v.sourceID.UUID)).Scan(&status, &lastErr)
		if err == nil {
			v.Status, v.Error = status, lastErr
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return &v, nil
}

func (s *Store) ListTracks(ctx context.Context, limit int) ([]TrackView, error) {
	rows, err := s.pool.Query(ctx, `select id from tracks order by created_at desc limit $1`, limit)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	out := make([]TrackView, 0, len(ids))
	for _, id := range ids {
		v, err := s.Track(ctx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, nil
}

func (s *Store) AssetBySHA(ctx context.Context, sha string) (path, mime string, err error) {
	err = s.pool.QueryRow(ctx, `select path, mime from media_assets where sha256 = $1`, sha).Scan(&path, &mime)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) HasMainMedia(ctx context.Context, trackID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `select exists (select 1 from track_media where track_id = $1 and variant = 'main')`, trackID).Scan(&ok)
	return ok, err
}
