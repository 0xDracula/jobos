package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const KindAnalyzeModels = "analyze_models"

const ModelVersion = 1

const EmbeddingModel = "discogs-effnet-bsdynamic-1"

const EmbeddingDims = 1280

const QueueHeavy = "heavy"

type ModelsPayload struct {
	AssetID uuid.UUID `json:"asset_id"`
	Path    string    `json:"path"`
}

type Style struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type ModelsResult struct {
	ModelVersion int32     `json:"model_version"`
	Happy        float64   `json:"happy"`
	Sad          float64   `json:"sad"`
	Relaxed      float64   `json:"relaxed"`
	Aggressive   float64   `json:"aggressive"`
	Voice        float64   `json:"voice"`
	Valence      float64   `json:"valence"`
	Arousal      float64   `json:"arousal"`
	Styles       []Style   `json:"styles"`
	Embedding    []float32 `json:"embedding"`
}

func (r ModelsResult) Validate() error {
	for name, v := range map[string]float64{"happy": r.Happy, "sad": r.Sad, "relaxed": r.Relaxed,
		"aggressive": r.Aggressive, "voice": r.Voice, "valence": r.Valence, "arousal": r.Arousal} {
		if math.IsNaN(v) || v < 0 || v > 1 {
			return fmt.Errorf("%s out of range", name)
		}
	}
	if len(r.Embedding) != EmbeddingDims {
		return fmt.Errorf("embedding has %d values, want %d", len(r.Embedding), EmbeddingDims)
	}
	for _, v := range r.Embedding {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			return errors.New("embedding has a non-finite value")
		}
	}
	if r.ModelVersion < 1 || len(r.Styles) > 20 {
		return errors.New("invalid model version or styles")
	}
	return nil
}

func ModelsKey(assetID uuid.UUID) string { return "models:" + assetID.String() }

func VectorText(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 9)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(x), 'g', 6, 32))
	}
	b.WriteByte(']')
	return b.String()
}

func ParseVector(s string) ([]float32, error) {
	s = strings.TrimSuffix(strings.TrimPrefix(s, "["), "]")
	if s == "" {
		return nil, nil
	}
	parts := strings.Split(s, ",")
	out := make([]float32, len(parts))
	for i, p := range parts {
		f, err := strconv.ParseFloat(p, 32)
		if err != nil {
			return nil, err
		}
		out[i] = float32(f)
	}
	return out, nil
}

func styleTag(style string) string {
	if i := strings.LastIndex(style, "---"); i >= 0 {
		style = style[i+3:]
	}
	return strings.ToLower(strings.TrimSpace(style))
}

const StyleTagMin = 0.1

func completeModels(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p ModelsPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r ModelsResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if err := r.Validate(); err != nil {
		return err
	}
	styles, err := json.Marshal(r.Styles)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update media_assets set mood_happy = $2, mood_sad = $3, mood_relaxed = $4, mood_aggressive = $5,
		voice = $6, model_valence = $7, arousal = $8, styles = $9, model_version = $10 where id = $1`,
		p.AssetID, r.Happy, r.Sad, r.Relaxed, r.Aggressive, r.Voice, r.Valence, r.Arousal, styles, r.ModelVersion); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into track_embeddings (asset_id, model, embedding) values ($1, $2, $3::vector)
		on conflict (asset_id) do update set model = excluded.model, embedding = excluded.embedding, created_at = now()`,
		p.AssetID, EmbeddingModel, VectorText(r.Embedding)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from track_tags where source = 'effnet'
		and track_id in (select track_id from track_media where asset_id = $1)`, p.AssetID); err != nil {
		return err
	}
	for _, s := range r.Styles {
		if s.Score < StyleTagMin {
			continue
		}
		tag := styleTag(s.Name)
		if tag == "" {
			continue
		}
		tagID, err := upsertTag(ctx, tx, tag)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into track_tags (track_id, tag_id, source, weight)
			select tm.track_id, $1, 'effnet', $2 from track_media tm where tm.asset_id = $3
			on conflict do nothing`, tagID, s.Score, p.AssetID); err != nil {
			return err
		}
	}
	return nil
}

func enqueueModels(ctx context.Context, q querier, assetID uuid.UUID, path string) error {
	_, _, err := enqueue(ctx, q, JobSpec{Queue: QueueHeavy, Kind: KindAnalyzeModels, Payload: ModelsPayload{AssetID: assetID, Path: path},
		DedupeKey: ModelsKey(assetID), Priority: PriorityBackground})
	return err
}

func (s *Store) BackfillModels(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select distinct ma.id, ma.path from media_assets ma
		join track_media tm on tm.asset_id = ma.id
		where ma.kind = 'audio' and (ma.model_version is null or ma.model_version < $1
			or not exists (select 1 from track_embeddings e where e.asset_id = ma.id))`, ModelVersion)
	if err != nil {
		return 0, err
	}
	assets, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (ModelsPayload, error) {
		var p ModelsPayload
		return p, row.Scan(&p.AssetID, &p.Path)
	})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, p := range assets {
		_, added, err := enqueue(ctx, s.pool, JobSpec{Queue: QueueHeavy, Kind: KindAnalyzeModels, Payload: p,
			DedupeKey: ModelsKey(p.AssetID), Priority: PriorityBackground})
		if err != nil {
			return n, err
		}
		if added {
			n++
		}
	}
	return n, nil
}

type ModelStatus struct {
	Files    int `json:"files"`
	Analyzed int `json:"analyzed"`
	Queued   int `json:"queued"`
}

func (s *Store) ModelStatus(ctx context.Context) (ModelStatus, error) {
	var st ModelStatus
	err := s.pool.QueryRow(ctx, `select count(distinct ma.id),
			count(distinct ma.id) filter (where ma.model_version >= $1 and e.asset_id is not null),
			(select count(*) from jobs where kind = $2 and status in ('queued', 'running'))
		from media_assets ma join track_media tm on tm.asset_id = ma.id and tm.variant = 'main'
		left join track_embeddings e on e.asset_id = ma.id
		where ma.kind = 'audio'`, ModelVersion, KindAnalyzeModels).Scan(&st.Files, &st.Analyzed, &st.Queued)
	return st, err
}

type SimilarTrack struct {
	ID         uuid.UUID `json:"id"`
	Similarity float64   `json:"similarity"`
}

func (s *Store) SimilarTracks(ctx context.Context, userID, trackID uuid.UUID, limit int) ([]SimilarTrack, error) {
	rows, err := s.pool.Query(ctx, `with seed as (
			select e.embedding from track_media tm join track_embeddings e on e.asset_id = tm.asset_id
			where tm.track_id = $2 and tm.variant = 'main'),
		near as (
			select tm.track_id, 1 - (e.embedding <=> (select embedding from seed)) as sim
			from track_embeddings e join track_media tm on tm.asset_id = e.asset_id and tm.variant = 'main'
			where tm.track_id <> $2
			order by e.embedding <=> (select embedding from seed)
			limit $3 * 4),
		ranked as (
			select n.track_id, n.sim, row_number() over (partition by coalesce(
				(select ta.artist_id from track_artists ta where ta.track_id = n.track_id order by ta.position limit 1), n.track_id)
				order by n.sim desc) as nth
			from near n
			where not exists (select 1 from hidden_items h where h.user_id = $1 and h.item_type = 'track' and h.item_id = n.track_id)
			  and not exists (select 1 from hidden_items h join track_artists x on x.artist_id = h.item_id
			                  where h.user_id = $1 and h.item_type = 'artist' and x.track_id = n.track_id)
			  and not exists (select 1 from track_artists a join track_artists b on b.artist_id = a.artist_id
			                  where a.track_id = $2 and b.track_id = n.track_id))
		select track_id, sim from ranked where nth = 1 order by sim desc limit $3`, userID, trackID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SimilarTrack, error) {
		var t SimilarTrack
		return t, r.Scan(&t.ID, &t.Similarity)
	})
}
