package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindAnalyzeAudio = "analyze_audio"

type AnalysisPayload struct {
	AssetID uuid.UUID `json:"asset_id"`
	Path    string    `json:"path"`
}

type AnalysisResult struct {
	TempoBPM *float64        `json:"tempo_bpm"`
	Beats    json.RawMessage `json:"beats"`
}

func AnalysisKey(assetID uuid.UUID) string { return "analyze:" + assetID.String() }

func completeAnalysis(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p AnalysisPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r AnalysisResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	beats := r.Beats
	if len(beats) == 0 || string(beats) == "null" {
		beats = json.RawMessage("[]")
	}
	_, err := tx.Exec(ctx, `update media_assets set tempo_bpm = $2, beats = $3 where id = $1`, p.AssetID, r.TempoBPM, []byte(beats))
	return err
}

func (s *Store) BackfillAnalysis(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select distinct ma.id, ma.path from media_assets ma
		join track_media tm on tm.asset_id = ma.id
		where ma.kind = 'audio' and ma.beats is null`)
	if err != nil {
		return 0, err
	}
	type asset struct {
		id   uuid.UUID
		path string
	}
	assets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (asset, error) {
		var a asset
		return a, row.Scan(&a.id, &a.path)
	})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, a := range assets {
		_, added, err := enqueue(ctx, s.pool, JobSpec{
			Kind: KindAnalyzeAudio, Payload: AnalysisPayload{AssetID: a.id, Path: a.path},
			DedupeKey: AnalysisKey(a.id), Priority: PriorityBackground,
		})
		if err != nil {
			return n, err
		}
		if added {
			n++
		}
	}
	return n, nil
}

func (s *Store) trackBeats(ctx context.Context, v *TrackView) error {
	if v.Audio == nil {
		return nil
	}
	var tempo *float32
	var beats []byte
	err := s.pool.QueryRow(ctx, `select ma.tempo_bpm, ma.beats from track_media tm join media_assets ma on ma.id = tm.asset_id
		where tm.track_id = $1 and tm.variant = 'main'`, v.ID).Scan(&tempo, &beats)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	v.Audio.TempoBPM, v.Audio.Beats = tempo, beats
	return nil
}
