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

type UploadInput struct {
	Title     string
	Artists   []string
	Note      string
	Path      string
	CoverPath string
}

type UploadPayload struct {
	TrackID   uuid.UUID `json:"track_id"`
	SourceID  uuid.UUID `json:"source_id"`
	Path      string    `json:"path"`
	CoverPath string    `json:"cover_path,omitempty"`
}

type CoverPayload struct {
	TrackID uuid.UUID `json:"track_id"`
	Path    string    `json:"path"`
}

func (s *Store) CreateUpload(ctx context.Context, in UploadInput) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	trackID, sourceID := newID(), newID()
	if _, err := tx.Exec(ctx, `insert into tracks (id, title, note, match_status) values ($1, $2, nullif($3, ''), 'chosen')`,
		trackID, in.Title, in.Note); err != nil {
		return trackID, err
	}
	if err := setArtists(ctx, tx, trackID, in.Artists); err != nil {
		return trackID, err
	}
	if _, err := tx.Exec(ctx, `insert into track_sources (id, track_id, provider, external_id, raw_title, uploader, status)
		values ($1, $2, 'upload', $3, $4, nullif($5, ''), 'selected')`,
		sourceID, trackID, in.Path, in.Title, strings.Join(in.Artists, ", ")); err != nil {
		return trackID, err
	}
	if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindProcessUpload, DedupeKey: "upload:" + sourceID.String(), Priority: PriorityInteractive,
		Payload: UploadPayload{TrackID: trackID, SourceID: sourceID, Path: in.Path, CoverPath: in.CoverPath}}); err != nil {
		return trackID, err
	}
	return trackID, tx.Commit(ctx)
}

func setArtists(ctx context.Context, tx pgx.Tx, trackID uuid.UUID, names []string) error {
	if _, err := tx.Exec(ctx, `delete from track_artists where track_id = $1`, trackID); err != nil {
		return err
	}
	for i, name := range names {
		artistID, err := upsertArtist(ctx, tx, "ytmusic_id", "", name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3)`, trackID, artistID, i); err != nil {
			return err
		}
	}
	return nil
}

func completeUpload(ctx context.Context, tx pgx.Tx, payload, result []byte, priority int) error {
	var p UploadPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r struct {
		Asset AssetResult  `json:"asset"`
		Cover *AssetResult `json:"cover"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if r.Asset.Kind != "audio" {
		return fmt.Errorf("upload produced kind %q", r.Asset.Kind)
	}
	if err := r.Asset.Validate(); err != nil {
		return err
	}
	if r.Cover != nil {
		if err := validateImage(r.Cover, "artwork"); err != nil {
			return err
		}
	}
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from tracks where id = $1)`, p.TrackID).Scan(&exists); err != nil || !exists {
		return err
	}
	assetID, err := insertAsset(ctx, tx, r.Asset)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into track_media (track_id, variant, track_source_id, asset_id) values ($1, 'main', $2, $3)
		on conflict (track_id, variant) do update set track_source_id = excluded.track_source_id, asset_id = excluded.asset_id`,
		p.TrackID, p.SourceID, assetID); err != nil {
		return err
	}
	if r.Cover != nil {
		if err := setTrackCover(ctx, tx, p.TrackID, *r.Cover); err != nil {
			return err
		}
	}
	_, err = enqueueLyrics(ctx, tx, p.TrackID, priority)
	return err
}

func setTrackCover(ctx context.Context, tx pgx.Tx, trackID uuid.UUID, cover AssetResult) error {
	coverID, err := insertAsset(ctx, tx, cover)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update tracks set artwork_asset_id = $2, updated_at = now() where id = $1`, trackID, coverID)
	return err
}

func (s *Store) EnqueueCover(ctx context.Context, trackID uuid.UUID, path string) error {
	_, _, err := s.Enqueue(ctx, JobSpec{Kind: KindProcessCover, DedupeKey: "cover:" + trackID.String(), Priority: PriorityInteractive,
		Payload: CoverPayload{TrackID: trackID, Path: path}})
	return err
}

func completeCover(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p CoverPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r struct {
		Cover *AssetResult `json:"cover"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if r.Cover == nil {
		return errors.New("cover job returned no image")
	}
	if err := validateImage(r.Cover, "artwork"); err != nil {
		return err
	}
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from tracks where id = $1)`, p.TrackID).Scan(&exists); err != nil || !exists {
		return err
	}
	return setTrackCover(ctx, tx, p.TrackID, *r.Cover)
}

type TrackEdit struct {
	Title   *string  `json:"title"`
	Artists []string `json:"artists"`
	Note    *string  `json:"note"`
}

func (e TrackEdit) Validate() error {
	switch {
	case e.Title != nil && (strings.TrimSpace(*e.Title) == "" || len(*e.Title) > 500):
		return errors.New("title must be 1 to 500 characters")
	case len(e.Artists) > 20:
		return errors.New("20 artists at most")
	case e.Note != nil && len(*e.Note) > 2000:
		return errors.New("note must be 2000 characters at most")
	}
	for _, a := range e.Artists {
		if strings.TrimSpace(a) == "" || len(a) > 200 {
			return errors.New("artist names must be 1 to 200 characters")
		}
	}
	return nil
}

func (s *Store) UpdateTrack(ctx context.Context, id uuid.UUID, e TrackEdit) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `update tracks set title = coalesce($2, title),
		note = case when $3::boolean then nullif($4, '') else note end, updated_at = now() where id = $1`,
		id, e.Title, e.Note != nil, deref(e.Note))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if e.Artists != nil {
		names := make([]string, len(e.Artists))
		for i, a := range e.Artists {
			names[i] = strings.TrimSpace(a)
		}
		if err := setArtists(ctx, tx, id, names); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
