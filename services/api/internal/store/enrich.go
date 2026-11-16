package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindEnrichMetadata = "enrich_metadata"

func EnrichKey(trackID uuid.UUID) string {
	return "enrich:" + trackID.String()
}

type EnrichPayload struct {
	TrackID         uuid.UUID `json:"track_id"`
	Title           string    `json:"title"`
	Artists         []string  `json:"artists"`
	Album           string    `json:"album,omitempty"`
	ISRC            string    `json:"isrc,omitempty"`
	DurationMs      int32     `json:"duration_ms,omitempty"`
	ArtworkURL      string    `json:"artwork_url,omitempty"`
	NeedArtwork     bool      `json:"need_artwork"`
	NeedArtistImage bool      `json:"need_artist_image"`
}

type EnrichResult struct {
	Artwork        *AssetResult `json:"artwork"`
	ArtworkSource  *string      `json:"artwork_source"`
	ArtistImage    *AssetResult `json:"artist_image"`
	DeezerArtistID *string      `json:"deezer_artist_id"`
}

var (
	imageMimes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}
	digitsRE   = regexp.MustCompile(`^[0-9]{1,20}$`)
)

func validateImage(a *AssetResult, kind string) error {
	if a.Kind != kind {
		return fmt.Errorf("%s has kind %q", kind, a.Kind)
	}
	if err := a.Validate(); err != nil {
		return err
	}
	switch {
	case !imageMimes[a.Mime]:
		return fmt.Errorf("unsupported image type %q", a.Mime)
	case a.Width == nil || a.Height == nil || *a.Width < 1 || *a.Height < 1 || *a.Width > 20000 || *a.Height > 20000:
		return errors.New("image size out of range")
	}
	if len(a.Palette) > 0 && string(a.Palette) != "null" {
		var colors []struct {
			Hex    string  `json:"hex"`
			Weight float64 `json:"weight"`
		}
		if err := json.Unmarshal(a.Palette, &colors); err != nil || len(colors) > 10 {
			return errors.New("invalid palette")
		}
	}
	return nil
}

func (r EnrichResult) Validate() error {
	if r.Artwork != nil {
		if err := validateImage(r.Artwork, "artwork"); err != nil {
			return err
		}
	}
	if r.ArtistImage != nil {
		if err := validateImage(r.ArtistImage, "image"); err != nil {
			return err
		}
	}
	if r.DeezerArtistID != nil && !digitsRE.MatchString(*r.DeezerArtistID) {
		return errors.New("invalid Deezer artist ID")
	}
	return nil
}

func enqueueEnrich(ctx context.Context, q querier, trackID uuid.UUID, priority int) (bool, error) {
	p := EnrichPayload{TrackID: trackID}
	var album, isrc, artworkURL *string
	var duration *int32
	var enriched bool
	err := q.QueryRow(ctx, `select t.title, al.title, t.isrc, t.duration_ms, coalesce(t.artwork_url, al.artwork_url),
			coalesce((select array_agg(a.name order by ta.position) from track_artists ta
				join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}'),
			coalesce(t.artwork_asset_id, al.artwork_asset_id) is null,
			coalesce((select a.image_asset_id is null from track_artists ta join artists a on a.id = ta.artist_id
				where ta.track_id = t.id order by ta.position limit 1), false),
			exists (select 1 from jobs j where j.dedupe_key = $2)
		from tracks t left join albums al on al.id = t.album_id where t.id = $1`, trackID, EnrichKey(trackID)).
		Scan(&p.Title, &album, &isrc, &duration, &artworkURL, &p.Artists, &p.NeedArtwork, &p.NeedArtistImage, &enriched)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil || enriched || (!p.NeedArtwork && !p.NeedArtistImage) {
		return false, err
	}
	if album != nil {
		p.Album = *album
	}
	if isrc != nil {
		p.ISRC = *isrc
	}
	if duration != nil {
		p.DurationMs = *duration
	}
	if artworkURL != nil {
		p.ArtworkURL = *artworkURL
	}
	_, added, err := enqueue(ctx, q, JobSpec{Kind: KindEnrichMetadata, Payload: p, DedupeKey: EnrichKey(trackID), Priority: priority})
	return added, err
}

func completeEnrich(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p EnrichPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r EnrichResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	var albumID *uuid.UUID
	err := tx.QueryRow(ctx, `select album_id from tracks where id = $1`, p.TrackID).Scan(&albumID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if r.Artwork != nil {
		assetID, err := insertAsset(ctx, tx, *r.Artwork)
		if err != nil {
			return err
		}
		if albumID != nil {
			_, err = tx.Exec(ctx, `update albums set artwork_asset_id = $2, updated_at = now() where id = $1`, *albumID, assetID)
		} else {
			_, err = tx.Exec(ctx, `update tracks set artwork_asset_id = $2, updated_at = now() where id = $1`, p.TrackID, assetID)
		}
		if err != nil {
			return err
		}
	}
	if r.ArtistImage != nil {
		assetID, err := insertAsset(ctx, tx, *r.ArtistImage)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update artists set image_asset_id = $2, deezer_id = coalesce(deezer_id, $3), updated_at = now()
			where id = (select artist_id from track_artists where track_id = $1 order by position limit 1)`,
			p.TrackID, assetID, r.DeezerArtistID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) BackfillEnrich(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select t.id from tracks t
		where exists (select 1 from track_media tm where tm.track_id = t.id and tm.variant = 'main')
		order by t.created_at`)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		added, err := enqueueEnrich(ctx, s.pool, id, PriorityMatch)
		if err != nil {
			return n, err
		}
		if added {
			n++
		}
	}
	return n, nil
}
