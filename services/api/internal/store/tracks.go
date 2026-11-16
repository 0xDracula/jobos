package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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
		id, aerr := upsertAlbum(ctx, tx, "ytmusic_id", in.Album.ID, in.Album.Name, nil)
		if aerr != nil {
			return trackID, sourceID, false, aerr
		}
		albumID = &id
	}
	trackID = newID()
	if _, err = tx.Exec(ctx, `insert into tracks (id, title, album_id, duration_ms, explicit, artwork_url, match_status)
		values ($1, $2, $3, $4, $5, $6, 'chosen')`,
		trackID, in.Title, albumID, in.DurationMs, in.Explicit, in.Thumbnail); err != nil {
		return
	}
	for i, a := range in.Artists {
		if a.Name == "" {
			continue
		}
		artistID, aerr := upsertArtist(ctx, tx, "ytmusic_id", a.ID, a.Name)
		if aerr != nil {
			return trackID, sourceID, false, aerr
		}
		if _, err = tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3)`,
			trackID, artistID, i); err != nil {
			return
		}
	}
	sourceID = newID()
	if _, err = tx.Exec(ctx, `insert into track_sources (id, track_id, provider, external_id, raw_title, uploader, duration_ms, match_score, status)
		values ($1, $2, $3, $4, $5, $6, $7, 1, 'selected')`,
		sourceID, trackID, in.Provider, in.ExternalID, in.Title, artistNames(in.Artists), in.DurationMs); err != nil {
		return
	}
	return trackID, sourceID, true, tx.Commit(ctx)
}

func artistNames(artists []ArtistRef) *string {
	names := make([]string, 0, len(artists))
	for _, a := range artists {
		if a.Name != "" {
			names = append(names, a.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	s := strings.Join(names, ", ")
	return &s
}

func upsertArtist(ctx context.Context, tx pgx.Tx, column, externalID, name string) (uuid.UUID, error) {
	var id uuid.UUID
	if externalID != "" {
		err := tx.QueryRow(ctx, fmt.Sprintf(`insert into artists (id, name, %[1]s) values ($1, $2, $3)
			on conflict (%[1]s) where %[1]s is not null
			do update set name = excluded.name, updated_at = now()
			returning id`, column), newID(), name, externalID).Scan(&id)
		return id, err
	}
	err := tx.QueryRow(ctx, `select id from artists where lower(name) = lower($1) order by created_at limit 1`, name).Scan(&id)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return id, err
	}
	id = newID()
	_, err = tx.Exec(ctx, `insert into artists (id, name) values ($1, $2)`, id, name)
	return id, err
}

func upsertAlbum(ctx context.Context, tx pgx.Tx, column, externalID, title string, artworkURL *string) (uuid.UUID, error) {
	var id uuid.UUID
	if externalID != "" {
		err := tx.QueryRow(ctx, fmt.Sprintf(`insert into albums (id, title, %[1]s, artwork_url) values ($1, $2, $3, $4)
			on conflict (%[1]s) where %[1]s is not null
			do update set title = excluded.title, artwork_url = coalesce(excluded.artwork_url, albums.artwork_url), updated_at = now()
			returning id`, column), newID(), title, externalID, artworkURL).Scan(&id)
		return id, err
	}
	id = newID()
	_, err := tx.Exec(ctx, `insert into albums (id, title, artwork_url) values ($1, $2, $3)`, id, title, artworkURL)
	return id, err
}

type AudioView struct {
	URL          string          `json:"url"`
	DurationMs   *int32          `json:"duration_ms"`
	LoudnessLUFS *float32        `json:"loudness_lufs"`
	GainDB       *float32        `json:"gain_db"`
	Waveform     json.RawMessage `json:"waveform,omitempty"`
}

type SourceView struct {
	ID         uuid.UUID `json:"id"`
	Provider   string    `json:"provider"`
	ExternalID string    `json:"external_id"`
	Title      *string   `json:"title"`
	Uploader   *string   `json:"uploader"`
	DurationMs *int32    `json:"duration_ms"`
	Score      *float32  `json:"score"`
}

type TrackView struct {
	ID              uuid.UUID       `json:"id"`
	Title           string          `json:"title"`
	Artists         []string        `json:"artists"`
	Album           *string         `json:"album"`
	DurationMs      *int32          `json:"duration_ms"`
	ArtworkURL      *string         `json:"artwork_url"`
	ArtworkThumbURL *string         `json:"artwork_thumb_url"`
	Palette         json.RawMessage `json:"palette,omitempty"`
	MatchStatus     *string         `json:"match_status"`
	Status          string          `json:"status"`
	Error           *string         `json:"error,omitempty"`
	Source          *SourceView     `json:"source,omitempty"`
	Audio           *AudioView      `json:"audio,omitempty"`
}

var ErrNotFound = errors.New("not found")

var MediaExt = map[string]string{"audio/mp4": "m4a", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

const trackViewSQL = `select t.id, t.title, al.title, t.duration_ms, t.artwork_url,
		coalesce((select array_agg(a.name order by ta.position) from track_artists ta
			join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}'),
		t.match_status,
		ma.sha256, ma.duration_ms, ma.loudness_lufs, ma.gain_db, ma.waveform,
		ts.id, ts.provider, ts.external_id, ts.raw_title, ts.uploader, ts.duration_ms, ts.match_score,
		dj.status, dj.last_error,
		art.sha256, art.mime, art.palette
	from tracks t
	left join albums al on al.id = t.album_id
	left join media_assets art on art.id = coalesce(t.artwork_asset_id, al.artwork_asset_id)
	left join track_media tm on tm.track_id = t.id and tm.variant = 'main'
	left join media_assets ma on ma.id = tm.asset_id
	left join track_sources ts on ts.track_id = t.id and ts.status = 'selected'
	left join lateral (select j.status, j.last_error from jobs j
		where ts.id is not null and j.dedupe_key = 'download:' || ts.id::text
		order by j.id desc limit 1) dj on true`

func scanTrackView(row pgx.Row) (*TrackView, error) {
	var (
		v                               TrackView
		sha                             *string
		mDur, sDur                      *int32
		loudness, gain, score           *float32
		waveform                        []byte
		sourceID                        uuid.NullUUID
		provider, externalID, rawTitle  *string
		uploader, jobStatus, jobLastErr *string
		artSHA, artMime                 *string
		palette                         []byte
	)
	if err := row.Scan(&v.ID, &v.Title, &v.Album, &v.DurationMs, &v.ArtworkURL, &v.Artists, &v.MatchStatus,
		&sha, &mDur, &loudness, &gain, &waveform,
		&sourceID, &provider, &externalID, &rawTitle, &uploader, &sDur, &score,
		&jobStatus, &jobLastErr, &artSHA, &artMime, &palette); err != nil {
		return nil, err
	}
	if artSHA != nil && artMime != nil {
		full := "/api/media/" + *artSHA + "." + MediaExt[*artMime]
		thumb := "/api/media/" + *artSHA + ".300.jpg"
		v.ArtworkURL, v.ArtworkThumbURL, v.Palette = &full, &thumb, palette
	} else {
		v.ArtworkThumbURL = v.ArtworkURL
	}
	if sourceID.Valid {
		v.Source = &SourceView{ID: sourceID.UUID, Provider: *provider, ExternalID: *externalID,
			Title: rawTitle, Uploader: uploader, DurationMs: sDur, Score: score}
	}
	switch {
	case sha != nil:
		v.Status = "cached"
		v.Audio = &AudioView{URL: "/api/media/" + *sha + ".m4a", DurationMs: mDur, LoudnessLUFS: loudness, GainDB: gain, Waveform: waveform}
	case jobStatus != nil && *jobStatus != "done":
		v.Status, v.Error = *jobStatus, jobLastErr
	default:
		v.Status = "missing"
	}
	return &v, nil
}

func (s *Store) Track(ctx context.Context, id uuid.UUID) (*TrackView, error) {
	v, err := scanTrackView(s.pool.QueryRow(ctx, trackViewSQL+` where t.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return v, err
}

func (s *Store) trackViews(ctx context.Context, suffix string, args ...any) ([]TrackView, error) {
	rows, err := s.pool.Query(ctx, trackViewSQL+" "+suffix, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrackView{}
	for rows.Next() {
		v, err := scanTrackView(rows)
		if err != nil {
			return nil, err
		}
		if v.Audio != nil {
			v.Audio.Waveform = nil
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (s *Store) ListTracks(ctx context.Context, limit int) ([]TrackView, error) {
	return s.trackViews(ctx, `order by t.created_at desc limit $1`, limit)
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
