package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type RecordingsImport struct {
	Provider   string
	ExternalID string
	URL        string
	Name       string
	Recordings []SourceTrack
}

func (s *Store) ImportRecordings(ctx context.Context, in RecordingsImport) (ImportSummary, error) {
	sum := ImportSummary{Tracks: len(in.Recordings)}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return sum, err
	}
	defer tx.Rollback(ctx)
	if sum.PlaylistID, sum.Created, err = upsertImportedPlaylist(ctx, tx, in.Provider, in.ExternalID, in.URL, in.Name); err != nil {
		return sum, err
	}
	items, err := newItemAppender(ctx, tx, sum.PlaylistID)
	if err != nil {
		return sum, err
	}
	for _, rec := range in.Recordings {
		if rec.Validate() != nil {
			sum.Skipped++
			continue
		}
		trackID, sourceID, created, err := addTrackFromSourceTx(ctx, tx, rec)
		if err != nil {
			return sum, err
		}
		if created {
			sum.NewTracks++
		}
		var cached bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from track_media where track_id = $1 and variant = 'main')`, trackID).Scan(&cached); err != nil {
			return sum, err
		}
		if !cached {
			_, added, err := enqueue(ctx, tx, JobSpec{Kind: KindDownloadTrack, DedupeKey: DownloadKey(sourceID), Priority: PriorityBackground,
				Payload: DownloadPayload{TrackID: trackID, SourceID: sourceID, Provider: rec.Provider, ExternalID: rec.ExternalID}})
			if err != nil {
				return sum, err
			}
			if added {
				sum.Queued++
			}
		}
		added, err := items.add(ctx, tx, trackID, time.Time{})
		if err != nil {
			return sum, err
		}
		if added {
			sum.Added++
		}
	}
	if _, err := tx.Exec(ctx, `update playlists set synced_at = now() where id = $1`, sum.PlaylistID); err != nil {
		return sum, err
	}
	return sum, tx.Commit(ctx)
}

var ErrNotSyncable = errors.New("only YouTube playlists can sync")

func (s *Store) SetPlaylistSync(ctx context.Context, id uuid.UUID, enabled bool) error {
	var provider *string
	err := s.pool.QueryRow(ctx, `select source_provider from playlists where id = $1`, id).Scan(&provider)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if provider == nil || *provider != "youtube" {
		return ErrNotSyncable
	}
	_, err = s.pool.Exec(ctx, `update playlists set sync_enabled = $2, updated_at = now() where id = $1`, id, enabled)
	return err
}

type SyncTarget struct {
	ID  uuid.UUID
	URL string
}

func (s *Store) PlaylistsToSync(ctx context.Context, every time.Duration) ([]SyncTarget, error) {
	rows, err := s.pool.Query(ctx, `select id, source_url from playlists
		where sync_enabled and source_provider = 'youtube' and source_url is not null
			and (synced_at is null or synced_at < now() - make_interval(secs => $1))`, every.Seconds())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (SyncTarget, error) {
		var t SyncTarget
		return t, row.Scan(&t.ID, &t.URL)
	})
}

func (s *Store) Prefetch(ctx context.Context, ids []uuid.UUID) (int, error) {
	n := 0
	for _, id := range ids {
		v, err := s.Track(ctx, id)
		if errors.Is(err, ErrNotFound) {
			continue
		}
		if err != nil {
			return n, err
		}
		switch {
		case v.Status == "cached":
			continue
		case v.Source != nil:
			_, _, err = s.Enqueue(ctx, JobSpec{Kind: KindDownloadTrack, DedupeKey: DownloadKey(v.Source.ID), Priority: PriorityPrefetch,
				Payload: DownloadPayload{TrackID: id, SourceID: v.Source.ID, Provider: v.Source.Provider, ExternalID: v.Source.ExternalID}})
		case v.MatchStatus != nil && *v.MatchStatus == "pending":
			err = s.EnqueueMatch(ctx, id, PriorityPrefetch)
		default:
			continue
		}
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
