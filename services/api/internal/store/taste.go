package store

import (
	"context"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	WeightImported    = 3.0
	WeightLike        = 3.0
	WeightPlaylistAdd = 2.0
	WeightShare       = 2.0
	WeightReplay      = 1.5
	WeightComplete    = 1.0
	WeightLateSkip    = -0.5
	WeightEarlySkip   = -2.0
	HalfLifeDays      = 45.0
	EarlySkipMs       = 30_000
)

func Decay(weight, ageDays float64) float64 {
	if ageDays < 0 {
		ageDays = 0
	}
	return weight * math.Pow(0.5, ageDays/HalfLifeDays)
}

func SkipWeight(positionMs, durationMs int32) float64 {
	switch {
	case positionMs < EarlySkipMs:
		return WeightEarlySkip
	case durationMs > 0 && positionMs < durationMs/2:
		return WeightLateSkip
	default:
		return 0
	}
}

type TrackSignal struct {
	Score                float64
	Liked                bool
	LikedInApp, Imported bool
	Plays                int
	LastPlayed           time.Time
	Skips                int
	LastEngaged          time.Time
}

func (t *TrackSignal) Known() bool { return t != nil && (t.Liked || t.Plays > 0 || t.Score > 0) }

func (s *Store) Signals(ctx context.Context, userID uuid.UUID, now time.Time) (map[uuid.UUID]*TrackSignal, error) {
	out := map[uuid.UUID]*TrackSignal{}
	get := func(id uuid.UUID) *TrackSignal {
		t := out[id]
		if t == nil {
			t = &TrackSignal{}
			out[id] = t
		}
		return t
	}
	engaged := func(t *TrackSignal, at time.Time) {
		if at.After(t.LastEngaged) {
			t.LastEngaged = at
		}
	}
	age := func(at time.Time) float64 { return now.Sub(at).Hours() / 24 }
	type row struct {
		id uuid.UUID
		at time.Time
	}
	scan := func(sql string, args ...any) ([]row, error) {
		rows, err := s.pool.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
			var x row
			return x, r.Scan(&x.id, &x.at)
		})
	}
	imported, err := scan(`select pi.track_id, pi.added_at from playlist_items pi join playlists p on p.id = pi.playlist_id
		where p.kind = 'imported' and (p.recipient_id = $1 or (p.recipient_id is null and p.owner_id = $1))`, userID)
	if err != nil {
		return nil, err
	}
	for _, r := range imported {
		t := get(r.id)
		if !t.Imported {
			t.Score += WeightImported
			t.Liked, t.Imported = true, true
		}
		engaged(t, r.at)
	}
	likes, err := scan(`select track_id, created_at from likes where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	for _, r := range likes {
		t := get(r.id)
		t.Score += WeightLike
		t.Liked, t.LikedInApp = true, true
		engaged(t, r.at)
	}
	adds, err := scan(`select pi.track_id, pi.added_at from playlist_items pi join playlists p on p.id = pi.playlist_id
		where pi.added_by = $1 and p.kind <> 'imported'`, userID)
	if err != nil {
		return nil, err
	}
	for _, r := range adds {
		t := get(r.id)
		t.Score += Decay(WeightPlaylistAdd, age(r.at))
		engaged(t, r.at)
	}
	shares, err := scan(`select (data->>'track_id')::uuid, created_at from chat_messages
			where sender_id = $1 and kind = 'song' and deleted_at is null and data->>'track_id' is not null
		union all select track_id, created_at from dedications where author_id = $1
		union all select mt.track_id, coalesce(m.sent_at, m.created_at) from mixtape_tracks mt join mixtapes m on m.id = mt.mixtape_id
			where m.from_user = $1`, userID)
	if err != nil {
		return nil, err
	}
	for _, r := range shares {
		t := get(r.id)
		t.Score += Decay(WeightShare, age(r.at))
		engaged(t, r.at)
	}
	rows, err := s.pool.Query(ctx, `select le.track_id, le.event, coalesce(le.position_ms, 0), coalesce(t.duration_ms, 0), le.created_at
		from listening_events le join tracks t on t.id = le.track_id
		where le.user_id = $1 and le.event in ('start', 'complete', 'skip') order by le.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lastStart := map[uuid.UUID]time.Time{}
	for rows.Next() {
		var id uuid.UUID
		var event string
		var pos, dur int32
		var at time.Time
		if err := rows.Scan(&id, &event, &pos, &dur, &at); err != nil {
			return nil, err
		}
		t := get(id)
		switch event {
		case "start":
			if prev, ok := lastStart[id]; ok && at.Sub(prev) < 24*time.Hour {
				t.Score += Decay(WeightReplay, age(at))
			}
			lastStart[id] = at
			t.Plays++
			if at.After(t.LastPlayed) {
				t.LastPlayed = at
			}
			engaged(t, at)
		case "complete":
			t.Score += Decay(WeightComplete, age(at))
		case "skip":
			w := SkipWeight(pos, dur)
			t.Score += Decay(w, age(at))
			if w == WeightEarlySkip {
				t.Skips++
			}
		}
	}
	return out, rows.Err()
}

type TasteGroup struct {
	Idx      int
	Centroid []float32
	Weight   float64
	Size     int
	Top      uuid.UUID
}

type Embeddings struct {
	byTrack map[uuid.UUID][]float32
}

func (e *Embeddings) Get(id uuid.UUID) []float32 {
	if e == nil {
		return nil
	}
	return e.byTrack[id]
}

func (e *Embeddings) Len() int {
	if e == nil {
		return 0
	}
	return len(e.byTrack)
}

func (s *Store) LoadEmbeddings(ctx context.Context) (*Embeddings, error) {
	rows, err := s.pool.Query(ctx, `select tm.track_id, e.embedding::text from track_media tm
		join track_embeddings e on e.asset_id = tm.asset_id where tm.variant = 'main'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	raw := map[uuid.UUID][]float32{}
	for rows.Next() {
		var id uuid.UUID
		var text string
		if err := rows.Scan(&id, &text); err != nil {
			return nil, err
		}
		v, err := ParseVector(text)
		if err != nil {
			return nil, err
		}
		if len(v) == EmbeddingDims {
			raw[id] = v
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return NewEmbeddings(raw), nil
}

func NewEmbeddings(raw map[uuid.UUID][]float32) *Embeddings {
	e := &Embeddings{byTrack: make(map[uuid.UUID][]float32, len(raw))}
	if len(raw) == 0 {
		return e
	}
	var dims int
	for _, v := range raw {
		dims = len(v)
		break
	}
	mean := make([]float64, dims)
	for _, v := range raw {
		for i, x := range v {
			mean[i] += float64(x)
		}
	}
	for i := range mean {
		mean[i] /= float64(len(raw))
	}
	for id, v := range raw {
		c := make([]float32, dims)
		for i, x := range v {
			c[i] = float32(float64(x) - mean[i])
		}
		e.byTrack[id] = unit(c)
	}
	return e
}

func unit(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	if n == 0 {
		return v
	}
	n = math.Sqrt(n)
	for i := range v {
		v[i] = float32(float64(v[i]) / n)
	}
	return v
}

func Dot(a, b []float32) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return 0
	}
	var s float64
	for i := range a {
		s += float64(a[i]) * float64(b[i])
	}
	return s
}

type Taste struct {
	Signals map[uuid.UUID]*TrackSignal
	Artists map[uuid.UUID]float64
	Tags    map[string]float64
	Groups  []TasteGroup
}

func BuildTaste(signals map[uuid.UUID]*TrackSignal, tracks map[uuid.UUID]MixTrack, emb *Embeddings, seed uint64) *Taste {
	t := &Taste{Signals: signals, Artists: map[uuid.UUID]float64{}, Tags: map[string]float64{}}
	var members []uuid.UUID
	var weights []float64
	for id, sig := range signals {
		m, ok := tracks[id]
		if !ok {
			continue
		}
		for _, a := range m.ArtistIDs {
			t.Artists[a] += sig.Score
		}
		if sig.Score > 0 {
			for _, tag := range m.Tags {
				t.Tags[tag] += sig.Score
			}
			if v := emb.Get(id); v != nil {
				members = append(members, id)
				weights = append(weights, sig.Score)
			}
		}
	}
	for k, v := range t.Artists {
		if v <= 0 {
			delete(t.Artists, k)
		}
	}
	normalize(t.Artists)
	normalize(t.Tags)
	t.Groups = clusterTaste(members, weights, emb, seed)
	return t
}

func clusterTaste(ids []uuid.UUID, weights []float64, emb *Embeddings, seed uint64) []TasteGroup {
	if len(ids) == 0 {
		return nil
	}
	points := make([][]float32, len(ids))
	for i, id := range ids {
		points[i] = emb.Get(id)
	}
	lo, hi := 4, 8
	if n := len(ids) / 4; n < hi {
		hi = max(1, n)
	}
	if lo > hi {
		lo = hi
	}
	var best []int
	var bestK int
	bestScore := math.Inf(-1)
	for k := lo; k <= hi; k++ {
		assign := KMeans(points, weights, k, seed+uint64(k))
		score := Silhouette(points, assign, k)
		if k == 1 {
			score = 0
		}
		if score > bestScore {
			best, bestK, bestScore = assign, k, score
		}
	}
	total := 0.0
	for _, w := range weights {
		total += w
	}
	groups := make([]TasteGroup, bestK)
	topScore := make([]float64, bestK)
	sums := make([][]float64, bestK)
	for g := range groups {
		groups[g].Idx = g
		sums[g] = make([]float64, len(points[0]))
		topScore[g] = math.Inf(-1)
	}
	for i, g := range best {
		groups[g].Size++
		groups[g].Weight += weights[i] / total
		for d, x := range points[i] {
			sums[g][d] += float64(x) * weights[i]
		}
		if weights[i] > topScore[g] {
			topScore[g], groups[g].Top = weights[i], ids[i]
		}
	}
	out := groups[:0]
	for g := range groups {
		if groups[g].Size == 0 {
			continue
		}
		c := make([]float32, len(sums[g]))
		for d, x := range sums[g] {
			c[d] = float32(x)
		}
		groups[g].Centroid = unit(c)
		out = append(out, groups[g])
	}
	for i := range out {
		out[i].Idx = i
	}
	return out
}

func (t *Taste) TasteSim(v []float32) (float64, int) {
	if len(v) == 0 || len(t.Groups) == 0 {
		return 0, -1
	}
	top := 0.0
	for _, g := range t.Groups {
		top = math.Max(top, g.Weight)
	}
	best, group := math.Inf(-1), -1
	for _, g := range t.Groups {
		s := Dot(v, g.Centroid) * (0.5 + 0.5*g.Weight/top)
		if s > best {
			best, group = s, g.Idx
		}
	}
	return best, group
}

func (s *Store) SaveTasteGroups(ctx context.Context, userID uuid.UUID, groups []TasteGroup) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from taste_groups where user_id = $1`, userID); err != nil {
		return err
	}
	for _, g := range groups {
		var top *uuid.UUID
		if g.Top != uuid.Nil {
			top = &g.Top
		}
		if _, err := tx.Exec(ctx, `insert into taste_groups (user_id, idx, centroid, weight, size, top_track_id)
			values ($1, $2, $3::vector, $4, $5, $6)`, userID, g.Idx, VectorText(g.Centroid), g.Weight, g.Size, top); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
