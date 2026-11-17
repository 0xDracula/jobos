package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindAnalyzeAudio = "analyze_audio"

const AnalyzerVersion = 2

type AnalysisPayload struct {
	AssetID    uuid.UUID `json:"asset_id"`
	Path       string    `json:"path"`
	SourceLUFS *float32  `json:"source_lufs,omitempty"`
}

type AnalysisFields struct {
	TempoBPM        *float64        `json:"tempo_bpm"`
	Beats           json.RawMessage `json:"beats"`
	Energy          *float64        `json:"energy"`
	Valence         *float64        `json:"valence"`
	Danceability    *float64        `json:"danceability"`
	MusicalKey      *string         `json:"musical_key"`
	AnalysisVersion *int32          `json:"analysis_version"`
}

func (f AnalysisFields) Validate() error {
	for name, v := range map[string]*float64{"energy": f.Energy, "valence": f.Valence, "danceability": f.Danceability} {
		if v != nil && (math.IsNaN(*v) || *v < 0 || *v > 1) {
			return fmt.Errorf("%s out of range", name)
		}
	}
	switch {
	case f.TempoBPM != nil && (math.IsNaN(*f.TempoBPM) || *f.TempoBPM <= 0 || *f.TempoBPM > 400):
		return errors.New("tempo out of range")
	case f.MusicalKey != nil && (*f.MusicalKey == "" || len(*f.MusicalKey) > 20):
		return errors.New("invalid key")
	case f.AnalysisVersion != nil && (*f.AnalysisVersion < 1 || *f.AnalysisVersion > 1000):
		return errors.New("invalid analysis version")
	}
	return nil
}

func AnalysisKey(assetID uuid.UUID) string { return "analyze:" + assetID.String() }

func completeAnalysis(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p AnalysisPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r AnalysisFields
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	beats := r.Beats
	if len(beats) == 0 || string(beats) == "null" {
		beats = json.RawMessage("[]")
	}
	_, err := tx.Exec(ctx, `update media_assets set tempo_bpm = $2, beats = $3, energy = $4, valence = $5, danceability = $6,
		musical_key = $7, analysis_version = $8 where id = $1`,
		p.AssetID, r.TempoBPM, []byte(beats), r.Energy, r.Valence, r.Danceability, r.MusicalKey, r.AnalysisVersion)
	return err
}

func (s *Store) BackfillAnalysis(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select distinct ma.id, ma.path, ma.loudness_lufs from media_assets ma
		join track_media tm on tm.asset_id = ma.id
		where ma.kind = 'audio' and (ma.analysis_version is null or ma.analysis_version < $1)`, AnalyzerVersion)
	if err != nil {
		return 0, err
	}
	assets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (AnalysisPayload, error) {
		var p AnalysisPayload
		return p, row.Scan(&p.AssetID, &p.Path, &p.SourceLUFS)
	})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range assets {
		_, added, err := enqueue(ctx, s.pool, JobSpec{
			Kind: KindAnalyzeAudio, Payload: p, DedupeKey: AnalysisKey(p.AssetID), Priority: PriorityBackground,
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

func (s *Store) trackAnalysis(ctx context.Context, v *TrackView) error {
	if v.Audio == nil {
		return nil
	}
	var tempo *float32
	var beats []byte
	a := &AudioAnalysis{}
	err := s.pool.QueryRow(ctx, `select ma.tempo_bpm, ma.beats, ma.energy, ma.valence, ma.danceability, ma.musical_key
		from track_media tm join media_assets ma on ma.id = tm.asset_id
		where tm.track_id = $1 and tm.variant = 'main'`, v.ID).Scan(&tempo, &beats, &a.Energy, &a.Valence, &a.Danceability, &a.Key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	v.Audio.TempoBPM, v.Audio.Beats, v.Audio.AudioAnalysis = tempo, beats, a
	return nil
}
