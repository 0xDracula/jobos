package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	KindEnrichArtist = "enrich_artist"
	KindFetchTags    = "fetch_tags"
)

func ArtistEnrichKey(artistID uuid.UUID) string { return "artist:" + artistID.String() }
func TrackTagsKey(trackID uuid.UUID) string     { return "tags:" + trackID.String() }

type ArtistEnrichPayload struct {
	ArtistID  uuid.UUID `json:"artist_id"`
	Name      string    `json:"name"`
	DeezerID  string    `json:"deezer_id,omitempty"`
	MBID      string    `json:"mbid,omitempty"`
	ISRCs     []string  `json:"isrcs"`
	Titles    []string  `json:"titles"`
	NeedImage bool      `json:"need_image"`
}

type TagResult struct {
	Name   string  `json:"name"`
	Source string  `json:"source"`
	Weight float64 `json:"weight"`
}

type RelatedResult struct {
	Name     string  `json:"name"`
	DeezerID *string `json:"deezer_id"`
	ImageURL *string `json:"image_url"`
}

type TopTrackResult struct {
	Title      string  `json:"title"`
	DeezerID   *string `json:"deezer_id"`
	Album      *string `json:"album"`
	DurationMs *int32  `json:"duration_ms"`
	ArtworkURL *string `json:"artwork_url"`
}

type ArtistEnrichResult struct {
	DeezerID  *string          `json:"deezer_id"`
	MBID      *string          `json:"mbid"`
	Image     *AssetResult     `json:"image"`
	Bio       *string          `json:"bio"`
	BioSource *string          `json:"bio_source"`
	BioURL    *string          `json:"bio_url"`
	Tags      []TagResult      `json:"tags"`
	Related   []RelatedResult  `json:"related"`
	TopTracks []TopTrackResult `json:"top_tracks"`
}

var (
	mbidRE      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	tagSources  = map[string]bool{"musicbrainz": true, "lastfm": true}
	bioSources  = map[string]bool{"wikipedia": true, "lastfm": true}
	errBadField = errors.New("invalid enrichment result")
)

func validText(s string, max int) bool {
	return s != "" && utf8.RuneCountInString(s) <= max && !strings.ContainsAny(s, "\x00")
}

func validURL(s *string) bool {
	if s == nil {
		return true
	}
	u, err := url.Parse(*s)
	return err == nil && u.Scheme == "https" && u.Host != "" && len(*s) <= 1000
}

func validDeezerID(s *string) bool { return s == nil || digitsRE.MatchString(*s) }

func validateTags(tags []TagResult) error {
	if len(tags) > 40 {
		return fmt.Errorf("%w: %d tags", errBadField, len(tags))
	}
	for _, t := range tags {
		if !validText(t.Name, 60) || !tagSources[t.Source] || math.IsNaN(t.Weight) || t.Weight < 0 || t.Weight > 1 {
			return fmt.Errorf("%w: tag %q", errBadField, t.Name)
		}
	}
	return nil
}

func (r ArtistEnrichResult) Validate() error {
	switch {
	case !validDeezerID(r.DeezerID):
		return fmt.Errorf("%w: deezer_id", errBadField)
	case r.MBID != nil && !mbidRE.MatchString(*r.MBID):
		return fmt.Errorf("%w: mbid", errBadField)
	case r.Bio != nil && (!validText(*r.Bio, 2000) || r.BioSource == nil || !bioSources[*r.BioSource] || r.BioURL == nil || !validURL(r.BioURL)):
		return fmt.Errorf("%w: bio", errBadField)
	case len(r.Related) > 30 || len(r.TopTracks) > 20:
		return fmt.Errorf("%w: too many entries", errBadField)
	}
	if r.Image != nil {
		if err := validateImage(r.Image, "image"); err != nil {
			return err
		}
	}
	for _, a := range r.Related {
		if !validText(a.Name, 200) || !validDeezerID(a.DeezerID) || !validURL(a.ImageURL) {
			return fmt.Errorf("%w: related %q", errBadField, a.Name)
		}
	}
	for _, t := range r.TopTracks {
		if !validText(t.Title, 300) || !validDeezerID(t.DeezerID) || !validURL(t.ArtworkURL) ||
			(t.Album != nil && utf8.RuneCountInString(*t.Album) > 300) || (t.DurationMs != nil && (*t.DurationMs < 0 || *t.DurationMs > 6*3600*1000)) {
			return fmt.Errorf("%w: top track %q", errBadField, t.Title)
		}
	}
	return validateTags(r.Tags)
}

func enqueueArtistEnrich(ctx context.Context, q querier, artistID uuid.UUID, priority int, once bool) (bool, error) {
	p := ArtistEnrichPayload{ArtistID: artistID}
	var deezerID, mbid *string
	var skip bool
	err := q.QueryRow(ctx, `select a.name, a.deezer_id, a.mbid, a.image_asset_id is null,
			coalesce((select array_agg(isrc) from (select t.isrc from track_artists ta join tracks t on t.id = ta.track_id
				where ta.artist_id = a.id and t.isrc is not null order by ta.position, t.created_at limit 3) i), '{}'),
			coalesce((select array_agg(title) from (select t.title from track_artists ta join tracks t on t.id = ta.track_id
				where ta.artist_id = a.id order by ta.position, t.created_at limit 5) s), '{}'),
			a.enriched_at is not null or ($3 and exists (select 1 from jobs j where j.dedupe_key = $2))
		from artists a where a.id = $1`, artistID, ArtistEnrichKey(artistID), once).
		Scan(&p.Name, &deezerID, &mbid, &p.NeedImage, &p.ISRCs, &p.Titles, &skip)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil || skip {
		return false, err
	}
	if deezerID != nil {
		p.DeezerID = *deezerID
	}
	if mbid != nil {
		p.MBID = *mbid
	}
	_, added, err := enqueue(ctx, q, JobSpec{Kind: KindEnrichArtist, Payload: p, DedupeKey: ArtistEnrichKey(artistID), Priority: priority})
	return added, err
}

func upsertTag(ctx context.Context, tx pgx.Tx, name string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `insert into tags (id, name) values ($1, $2) on conflict (name) do update set name = excluded.name
		returning id`, newID(), strings.ToLower(name)).Scan(&id)
	return id, err
}

func completeArtistEnrich(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p ArtistEnrichPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r ArtistEnrichResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	var imageID *uuid.UUID
	if r.Image != nil {
		id, err := insertAsset(ctx, tx, *r.Image)
		if err != nil {
			return err
		}
		imageID = &id
	}
	tag, err := tx.Exec(ctx, `update artists set deezer_id = coalesce(deezer_id, $2), mbid = coalesce(mbid, $3),
			image_asset_id = coalesce(image_asset_id, $4),
			bio = case when bio_source = 'manual' or $5::text is null then bio else $5 end,
			bio_source = case when bio_source = 'manual' or $5::text is null then bio_source else $6 end,
			bio_url = case when bio_source = 'manual' or $5::text is null then bio_url else $7 end,
			enriched_at = now(), updated_at = now()
		where id = $1`, p.ArtistID, r.DeezerID, r.MBID, imageID, r.Bio, r.BioSource, r.BioURL)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	if err := replaceTags(ctx, tx, "artist_tags", "artist_id", p.ArtistID, r.Tags); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from artist_related where artist_id = $1`, p.ArtistID); err != nil {
		return err
	}
	for i, a := range r.Related {
		if _, err := tx.Exec(ctx, `insert into artist_related (artist_id, rank, name, deezer_id, image_url, related_artist_id)
			values ($1, $2, $3, $4, $5, (select x.id from artists x where x.id <> $1 and (x.deezer_id = $4 or lower(x.name) = lower($3))
				order by x.deezer_id = $4 desc nulls last, x.created_at limit 1))`,
			p.ArtistID, i+1, a.Name, a.DeezerID, a.ImageURL); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `delete from artist_top_tracks where artist_id = $1`, p.ArtistID); err != nil {
		return err
	}
	for i, t := range r.TopTracks {
		if _, err := tx.Exec(ctx, `insert into artist_top_tracks (artist_id, rank, title, deezer_id, album, duration_ms, artwork_url)
			values ($1, $2, $3, $4, $5, $6, $7)`, p.ArtistID, i+1, t.Title, t.DeezerID, t.Album, t.DurationMs, t.ArtworkURL); err != nil {
			return err
		}
	}
	return nil
}

func replaceTags(ctx context.Context, tx pgx.Tx, table, column string, id uuid.UUID, tags []TagResult) error {
	sources := map[string]bool{}
	for _, t := range tags {
		sources[t.Source] = true
	}
	for source := range sources {
		if _, err := tx.Exec(ctx, `delete from `+table+` where `+column+` = $1 and source = $2`, id, source); err != nil {
			return err
		}
	}
	for _, t := range tags {
		tagID, err := upsertTag(ctx, tx, t.Name)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into `+table+` (`+column+`, tag_id, source, weight) values ($1, $2, $3, $4)
			on conflict (`+column+`, tag_id, source) do update set weight = greatest(`+table+`.weight, excluded.weight)`,
			id, tagID, t.Source, t.Weight); err != nil {
			return err
		}
	}
	return nil
}

type TrackTagsPayload struct {
	TrackID uuid.UUID `json:"track_id"`
	Title   string    `json:"title"`
	Artists []string  `json:"artists"`
	ISRC    string    `json:"isrc,omitempty"`
}

type TrackTagsResult struct {
	RecordingMBID *string     `json:"recording_mbid"`
	Tags          []TagResult `json:"tags"`
}

func enqueueTrackTags(ctx context.Context, q querier, trackID uuid.UUID, priority int) (bool, error) {
	p := TrackTagsPayload{TrackID: trackID}
	var isrc *string
	var done bool
	err := q.QueryRow(ctx, `select t.title, t.isrc,
			coalesce((select array_agg(a.name order by ta.position) from track_artists ta join artists a on a.id = ta.artist_id
				where ta.track_id = t.id), '{}'),
			t.tags_fetched_at is not null
		from tracks t where t.id = $1`, trackID).Scan(&p.Title, &isrc, &p.Artists, &done)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil || done {
		return false, err
	}
	if isrc != nil {
		p.ISRC = *isrc
	}
	_, added, err := enqueue(ctx, q, JobSpec{Kind: KindFetchTags, Payload: p, DedupeKey: TrackTagsKey(trackID), Priority: priority})
	return added, err
}

func completeTrackTags(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p TrackTagsPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r TrackTagsResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := validateTags(r.Tags); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `update tracks set tags_fetched_at = now() where id = $1`, p.TrackID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return replaceTags(ctx, tx, "track_tags", "track_id", p.TrackID, r.Tags)
}

func enqueueTrackEnrichment(ctx context.Context, tx pgx.Tx, trackID uuid.UUID) error {
	if _, err := enqueueTrackTags(ctx, tx, trackID, PriorityBackground); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `select ta.artist_id from track_artists ta join artists a on a.id = ta.artist_id
		where ta.track_id = $1 and a.enriched_at is null order by ta.position`, trackID)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := enqueueArtistEnrich(ctx, tx, id, PriorityBackground, true); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) BackfillEnrichment(ctx context.Context) (artists, tracks int, err error) {
	rows, err := s.pool.Query(ctx, `select distinct ta.artist_id from track_artists ta join artists a on a.id = ta.artist_id
		where a.enriched_at is null and exists (select 1 from track_media tm where tm.track_id = ta.track_id and tm.variant = 'main')`)
	if err != nil {
		return 0, 0, err
	}
	artistIDs, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, 0, err
	}
	for _, id := range artistIDs {
		added, err := enqueueArtistEnrich(ctx, s.pool, id, PriorityBackground, false)
		if err != nil {
			return artists, tracks, err
		}
		if added {
			artists++
		}
	}
	rows, err = s.pool.Query(ctx, `select t.id from tracks t where t.tags_fetched_at is null
		and exists (select 1 from track_media tm where tm.track_id = t.id and tm.variant = 'main') order by t.created_at`)
	if err != nil {
		return artists, 0, err
	}
	trackIDs, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return artists, 0, err
	}
	for _, id := range trackIDs {
		added, err := enqueueTrackTags(ctx, s.pool, id, PriorityBackground)
		if err != nil {
			return artists, tracks, err
		}
		if added {
			tracks++
		}
	}
	return artists, tracks, nil
}
