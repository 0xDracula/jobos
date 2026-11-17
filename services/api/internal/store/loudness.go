package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	TargetLUFS     = -14.0
	TruePeakLimit  = -1.0
	LoudnessMargin = 1.0
)

var (
	offTargetSQL = fmt.Sprintf(`(ma.output_true_peak_db is null or ma.output_true_peak_db > %g
		or abs(ma.output_lufs - (%g)) > %g)`, TruePeakLimit, TargetLUFS, LoudnessMargin)
	offTargetOrder = fmt.Sprintf(`greatest(coalesce(ma.output_true_peak_db, 0) - (%g),
		abs(coalesce(ma.output_lufs, %g) - (%g)) - %g) desc`, TruePeakLimit, TargetLUFS, TargetLUFS, LoudnessMargin)
)

func (s *Store) ReprocessLoudness(ctx context.Context, limit int) (queued, found int, err error) {
	rows, err := s.pool.Query(ctx, `select tm.track_id, ts.id, ts.provider, ts.external_id
		from track_media tm
		join media_assets ma on ma.id = tm.asset_id
		join track_sources ts on ts.id = tm.track_source_id and ts.status = 'selected'
		where tm.variant = 'main' and ma.kind = 'audio' and `+offTargetSQL+`
		order by `+offTargetOrder+`, tm.track_id`)
	if err != nil {
		return 0, 0, err
	}
	type target struct {
		trackID, sourceID    uuid.UUID
		provider, externalID string
	}
	targets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (target, error) {
		var t target
		return t, row.Scan(&t.trackID, &t.sourceID, &t.provider, &t.externalID)
	})
	if err != nil {
		return 0, 0, err
	}
	found = len(targets)
	if limit > 0 && len(targets) > limit {
		targets = targets[:limit]
	}
	for _, t := range targets {
		job := JobSpec{Kind: KindDownloadTrack, DedupeKey: DownloadKey(t.sourceID), Priority: PriorityBackground,
			Payload: DownloadPayload{TrackID: t.trackID, SourceID: t.sourceID, Provider: t.provider, ExternalID: t.externalID}}
		if t.provider == "upload" {
			job = JobSpec{Kind: KindProcessUpload, DedupeKey: "upload:" + t.sourceID.String(), Priority: PriorityBackground,
				Payload: UploadPayload{TrackID: t.trackID, SourceID: t.sourceID, Path: t.externalID}}
		}
		_, added, err := enqueue(ctx, s.pool, job)
		if err != nil {
			return queued, found, err
		}
		if added {
			queued++
		}
	}
	return queued, found, nil
}
