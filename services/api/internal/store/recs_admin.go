package store

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PlayStats struct {
	Plays          int     `json:"plays"`
	Skips          int     `json:"skips"`
	Completes      int     `json:"completes"`
	SkipRate       float64 `json:"skip_rate"`
	CompletionRate float64 `json:"completion_rate"`
}

type RecMetrics struct {
	Recommended PlayStats            `json:"recommended"`
	Own         PlayStats            `json:"own"`
	BySource    map[string]PlayStats `json:"by_source"`
}

func RecommendedContext(id string) bool {
	for _, prefix := range []string{"mix:", "similar:", "release:"} {
		if strings.HasPrefix(id, prefix) {
			return true
		}
	}
	return id == "radio" || id == "autoplay" || id == "weather-mix"
}

func (s *Store) RecMetrics(ctx context.Context, userID uuid.UUID, since time.Time) (RecMetrics, error) {
	m := RecMetrics{BySource: map[string]PlayStats{}}
	rows, err := s.pool.Query(ctx, `select coalesce(le.context->>'id', ''), le.event, count(*) from listening_events le
		join tracks t on t.id = le.track_id
		where le.user_id = $1 and le.created_at >= $2 and le.event in ('start', 'skip', 'complete')
			and (le.event <> 'skip' or t.duration_ms is null or coalesce(le.position_ms, 0) < t.duration_ms * 0.9)
		group by 1, 2`, userID, since)
	if err != nil {
		return m, err
	}
	defer rows.Close()
	add := func(p *PlayStats, event string, n int) {
		switch event {
		case "start":
			p.Plays += n
		case "skip":
			p.Skips += n
		case "complete":
			p.Completes += n
		}
	}
	for rows.Next() {
		var id, event string
		var n int
		if err := rows.Scan(&id, &event, &n); err != nil {
			return m, err
		}
		if RecommendedContext(id) {
			add(&m.Recommended, event, n)
			p := m.BySource[id]
			add(&p, event, n)
			m.BySource[id] = p
		} else {
			add(&m.Own, event, n)
		}
	}
	rates := func(p *PlayStats) {
		if p.Plays > 0 {
			p.SkipRate = float64(p.Skips) / float64(p.Plays)
			p.CompletionRate = float64(p.Completes) / float64(p.Plays)
		}
	}
	rates(&m.Recommended)
	rates(&m.Own)
	for k, p := range m.BySource {
		rates(&p)
		m.BySource[k] = p
	}
	return m, rows.Err()
}

type TasteGroupView struct {
	Idx    int     `json:"idx"`
	Weight float64 `json:"weight"`
	Size   int     `json:"size"`
	Top    *string `json:"top"`
}

func (s *Store) TasteGroups(ctx context.Context, userID uuid.UUID) ([]TasteGroupView, error) {
	rows, err := s.pool.Query(ctx, `select g.idx, g.weight, g.size, t.title from taste_groups g
		left join tracks t on t.id = g.top_track_id where g.user_id = $1 order by g.weight desc`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TasteGroupView, error) {
		var g TasteGroupView
		return g, r.Scan(&g.Idx, &g.Weight, &g.Size, &g.Top)
	})
}

func (s *Store) MixPalette(ctx context.Context, ids []uuid.UUID) ([]string, error) {
	if len(ids) > 8 {
		ids = ids[:8]
	}
	rows, err := s.pool.Query(ctx, `select ma.palette from tracks t join media_assets ma on ma.id = t.artwork_asset_id
		where t.id = any($1) and ma.palette is not null order by array_position($1, t.id)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	seen := map[string]bool{}
	for rows.Next() && len(out) < 3 {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var pal []struct {
			Hex string     `json:"hex"`
			Lab [3]float64 `json:"lab"`
		}
		if json.Unmarshal(raw, &pal) != nil {
			continue
		}
		for _, c := range pal {
			l, chroma := c.Lab[0], c.Lab[1]*c.Lab[1]+c.Lab[2]*c.Lab[2]
			if l < 22 || l > 88 || chroma < 64 || seen[c.Hex] {
				continue
			}
			seen[c.Hex] = true
			out = append(out, c.Hex)
			break
		}
	}
	return out, rows.Err()
}
