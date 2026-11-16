package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type ImportArtist struct {
	Name      string
	SpotifyID string
}

type ImportTrack struct {
	SpotifyID      string
	Title          string
	Artists        []ImportArtist
	Album          string
	AlbumSpotifyID string
	ArtworkURL     string
	DurationMs     int32
	ISRC           string
	Explicit       bool
	AddedAt        time.Time
}

type PlaylistImport struct {
	Provider   string
	ExternalID string
	URL        string
	Name       string
	Tracks     []ImportTrack
}

type ImportSummary struct {
	PlaylistID uuid.UUID `json:"playlist_id"`
	Created    bool      `json:"created"`
	Tracks     int       `json:"tracks"`
	Added      int       `json:"added"`
	NewTracks  int       `json:"new_tracks"`
	Queued     int       `json:"queued"`
	Skipped    int       `json:"skipped"`
}

type MatchPayload struct {
	TrackID    uuid.UUID `json:"track_id"`
	Title      string    `json:"title"`
	Artists    []string  `json:"artists"`
	Album      string    `json:"album,omitempty"`
	DurationMs int32     `json:"duration_ms,omitempty"`
	ISRC       string    `json:"isrc,omitempty"`
}

func MatchKey(trackID uuid.UUID) string {
	return "match:" + trackID.String()
}

type MatchCandidate struct {
	SourceTrack
	Score    float64 `json:"score"`
	Official bool    `json:"official"`
}

type MatchResult struct {
	Verdict    string           `json:"verdict"`
	Candidates []MatchCandidate `json:"candidates"`
}

var matchStatusFor = map[string]string{"accepted": "matched", "review": "review", "unmatched": "unmatched"}

func (r MatchResult) Validate() error {
	if _, ok := matchStatusFor[r.Verdict]; !ok {
		return fmt.Errorf("unknown verdict %q", r.Verdict)
	}
	if r.Verdict != "unmatched" && len(r.Candidates) == 0 {
		return errors.New("a match needs a candidate")
	}
	if len(r.Candidates) > 10 {
		return errors.New("too many candidates")
	}
	for i, c := range r.Candidates {
		if err := c.Validate(); err != nil {
			return fmt.Errorf("candidate %d: %w", i, err)
		}
	}
	return nil
}

func (s *Store) ImportPlaylist(ctx context.Context, in PlaylistImport) (ImportSummary, error) {
	sum := ImportSummary{Tracks: len(in.Tracks)}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sum, err
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `insert into playlists (id, name, kind, source_provider, source_external_id, source_url)
		values ($1, $2, 'imported', $3, $4, $5)
		on conflict (source_provider, source_external_id) where source_external_id is not null
		do update set name = excluded.name, source_url = excluded.source_url, updated_at = now()
		returning id, xmax = 0`, newID(), in.Name, in.Provider, in.ExternalID, in.URL).Scan(&sum.PlaylistID, &sum.Created); err != nil {
		return sum, err
	}
	rows, err := tx.Query(ctx, `select track_id from playlist_items where playlist_id = $1`, sum.PlaylistID)
	if err != nil {
		return sum, err
	}
	existing, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return sum, err
	}
	present := make(map[uuid.UUID]bool, len(existing))
	for _, id := range existing {
		present[id] = true
	}
	var next int
	if err := tx.QueryRow(ctx, `select coalesce(max(position) + 1, 0) from playlist_items where playlist_id = $1`,
		sum.PlaylistID).Scan(&next); err != nil {
		return sum, err
	}

	for _, t := range in.Tracks {
		trackID, created, err := importTrack(ctx, tx, t)
		if err != nil {
			return sum, fmt.Errorf("track %q: %w", t.Title, err)
		}
		if created {
			sum.NewTracks++
			_, added, err := enqueue(ctx, tx, JobSpec{Kind: KindMatchTrack, Payload: matchPayload(trackID, t),
				DedupeKey: MatchKey(trackID), Priority: PriorityMatch})
			if err != nil {
				return sum, err
			}
			if added {
				sum.Queued++
			}
		}
		if present[trackID] {
			continue
		}
		present[trackID] = true
		addedAt := t.AddedAt
		if addedAt.IsZero() {
			addedAt = time.Now()
		}
		if _, err := tx.Exec(ctx, `insert into playlist_items (playlist_id, position, track_id, added_at) values ($1, $2, $3, $4)`,
			sum.PlaylistID, next, trackID, addedAt); err != nil {
			return sum, err
		}
		next++
		sum.Added++
	}
	return sum, tx.Commit(ctx)
}

func importTrack(ctx context.Context, tx pgx.Tx, t ImportTrack) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `select id from tracks where spotify_id = $1`, t.SpotifyID).Scan(&id)
	if err == nil || !errors.Is(err, pgx.ErrNoRows) {
		return id, false, err
	}
	var albumID *uuid.UUID
	if t.Album != "" {
		aid, err := upsertAlbum(ctx, tx, "spotify_id", t.AlbumSpotifyID, t.Album, nonEmpty(t.ArtworkURL))
		if err != nil {
			return id, false, err
		}
		albumID = &aid
	}
	var duration *int32
	if t.DurationMs > 0 {
		duration = &t.DurationMs
	}
	id = newID()
	if _, err := tx.Exec(ctx, `insert into tracks (id, title, album_id, duration_ms, isrc, spotify_id, explicit, artwork_url, match_status)
		values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
		id, t.Title, albumID, duration, nonEmpty(t.ISRC), t.SpotifyID, t.Explicit, nonEmpty(t.ArtworkURL)); err != nil {
		return id, false, err
	}
	for i, a := range t.Artists {
		artistID, err := upsertArtist(ctx, tx, "spotify_id", a.SpotifyID, a.Name)
		if err != nil {
			return id, false, err
		}
		if _, err := tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3)`,
			id, artistID, i); err != nil {
			return id, false, err
		}
	}
	return id, true, nil
}

func matchPayload(trackID uuid.UUID, t ImportTrack) MatchPayload {
	p := MatchPayload{TrackID: trackID, Title: t.Title, Album: t.Album, DurationMs: t.DurationMs, ISRC: t.ISRC}
	for _, a := range t.Artists {
		p.Artists = append(p.Artists, a.Name)
	}
	return p
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

var RematchStatuses = map[string]bool{"pending": true, "matched": true, "review": true, "unmatched": true}

func (s *Store) RematchPlaylist(ctx context.Context, playlistID uuid.UUID, statuses []string) (int, error) {
	rows, err := s.pool.Query(ctx, `select t.id from playlist_items pi join tracks t on t.id = pi.track_id
		where pi.playlist_id = $1 and t.match_status = any($2) and t.match_status <> 'chosen'
		order by pi.position`, playlistID, statuses)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return 0, err
	}
	for i, id := range ids {
		if err := s.EnqueueMatch(ctx, id, PriorityMatch); err != nil {
			return i, err
		}
	}
	return len(ids), nil
}

func (s *Store) ChooseSource(ctx context.Context, trackID uuid.UUID, in SourceTrack) (sourceID uuid.UUID, download bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `update tracks set match_status = 'chosen', updated_at = now() where id = $1`, trackID)
	if err != nil {
		return
	}
	if tag.RowsAffected() == 0 {
		return sourceID, false, ErrNotFound
	}
	if err = tx.QueryRow(ctx, `insert into track_sources (id, track_id, provider, external_id, raw_title, uploader, duration_ms, status)
		values ($1, $2, $3, $4, $5, $6, $7, 'candidate')
		on conflict (track_id, provider, external_id) do update set raw_title = excluded.raw_title,
			uploader = coalesce(excluded.uploader, track_sources.uploader),
			duration_ms = coalesce(excluded.duration_ms, track_sources.duration_ms), updated_at = now()
		returning id`, newID(), trackID, in.Provider, in.ExternalID, in.Title, artistNames(in.Artists), in.DurationMs).Scan(&sourceID); err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `update track_sources set status = 'candidate', updated_at = now()
		where track_id = $1 and status = 'selected' and id <> $2`, trackID, sourceID); err != nil {
		return
	}
	if _, err = tx.Exec(ctx, `update track_sources set status = 'selected', updated_at = now() where id = $1`, sourceID); err != nil {
		return
	}
	if err = dropQueuedDownloads(ctx, tx, trackID, sourceID); err != nil {
		return
	}
	if err = tx.QueryRow(ctx, `select not exists (select 1 from track_media
		where track_id = $1 and variant = 'main' and track_source_id = $2)`, trackID, sourceID).Scan(&download); err != nil {
		return
	}
	return sourceID, download, tx.Commit(ctx)
}

func dropQueuedDownloads(ctx context.Context, tx pgx.Tx, trackID, keep uuid.UUID) error {
	_, err := tx.Exec(ctx, `delete from jobs where kind = $1 and status = 'queued'
		and payload->>'track_id' = $2 and payload->>'source_id' <> $3`, KindDownloadTrack, trackID.String(), keep.String())
	return err
}

func (s *Store) EnqueueMatch(ctx context.Context, trackID uuid.UUID, priority int) error {
	p := MatchPayload{TrackID: trackID}
	var duration *int32
	var album, isrc *string
	err := s.pool.QueryRow(ctx, `select t.title, al.title, t.duration_ms, t.isrc,
			coalesce((select array_agg(a.name order by ta.position) from track_artists ta
				join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}')
		from tracks t left join albums al on al.id = t.album_id where t.id = $1`, trackID).
		Scan(&p.Title, &album, &duration, &isrc, &p.Artists)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if album != nil {
		p.Album = *album
	}
	if duration != nil {
		p.DurationMs = *duration
	}
	if isrc != nil {
		p.ISRC = *isrc
	}
	_, _, err = s.Enqueue(ctx, JobSpec{Kind: KindMatchTrack, Payload: p, DedupeKey: MatchKey(trackID), Priority: priority})
	return err
}

func completeMatch(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p MatchPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r MatchResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	slices.SortStableFunc(r.Candidates, func(a, b MatchCandidate) int {
		switch {
		case a.Score > b.Score:
			return -1
		case a.Score < b.Score:
			return 1
		}
		return 0
	})

	var status *string
	err := tx.QueryRow(ctx, `select match_status from tracks where id = $1 for update`, p.TrackID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	sourceIDs := make([]uuid.UUID, len(r.Candidates))
	for i, c := range r.Candidates {
		if err := tx.QueryRow(ctx, `insert into track_sources (id, track_id, provider, external_id, raw_title, uploader, duration_ms, match_score, status)
			values ($1, $2, $3, $4, $5, $6, $7, $8, 'candidate')
			on conflict (track_id, provider, external_id) do update set raw_title = excluded.raw_title,
				uploader = coalesce(excluded.uploader, track_sources.uploader), duration_ms = excluded.duration_ms,
				match_score = excluded.match_score, updated_at = now()
			returning id`,
			newID(), p.TrackID, c.Provider, c.ExternalID, c.Title, artistNames(c.Artists), c.DurationMs, c.Score).Scan(&sourceIDs[i]); err != nil {
			return err
		}
	}
	if status != nil && *status == "chosen" {
		return nil
	}
	if r.Verdict == "unmatched" {
		if _, err := tx.Exec(ctx, `update track_sources set status = 'candidate', updated_at = now()
			where track_id = $1 and status = 'selected'`, p.TrackID); err != nil {
			return err
		}
		if err := dropQueuedDownloads(ctx, tx, p.TrackID, uuid.Nil); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from track_media where track_id = $1 and variant = 'main'`, p.TrackID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `update tracks set match_status = 'unmatched', updated_at = now() where id = $1`, p.TrackID)
		return err
	}

	best, bestID := r.Candidates[0], sourceIDs[0]
	if _, err := tx.Exec(ctx, `update track_sources set status = 'candidate', updated_at = now()
		where track_id = $1 and status = 'selected' and id <> $2`, p.TrackID, bestID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update track_sources set status = 'selected', updated_at = now() where id = $1`, bestID); err != nil {
		return err
	}
	if err := dropQueuedDownloads(ctx, tx, p.TrackID, bestID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update tracks set match_status = $2, artwork_url = coalesce(artwork_url, $3), updated_at = now()
		where id = $1`, p.TrackID, matchStatusFor[r.Verdict], best.Thumbnail); err != nil {
		return err
	}
	var cached bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from track_media
		where track_id = $1 and variant = 'main' and track_source_id = $2)`, p.TrackID, bestID).Scan(&cached); err != nil || cached {
		return err
	}
	_, _, err = enqueue(ctx, tx, JobSpec{Kind: KindDownloadTrack,
		Payload:   DownloadPayload{TrackID: p.TrackID, SourceID: bestID, Provider: best.Provider, ExternalID: best.ExternalID},
		DedupeKey: DownloadKey(bestID), Priority: PriorityBackground})
	return err
}
