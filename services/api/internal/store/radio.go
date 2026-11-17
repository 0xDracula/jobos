package store

import (
	"context"
	"math"
	"math/rand/v2"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MixTrack struct {
	ID        uuid.UUID
	ArtistIDs []uuid.UUID
	Tags      []string
	Energy    *float32
	Valence   *float32
	Tempo     *float32
	Liked     bool
	Playlists int
	Picked    bool
}

func (s *Store) MixCandidates(ctx context.Context, userID uuid.UUID) ([]MixTrack, error) {
	rows, err := s.pool.Query(ctx, `select t.id,
			coalesce((select array_agg(ta.artist_id order by ta.position) from track_artists ta where ta.track_id = t.id), '{}'),
			coalesce((select array_agg(distinct tg.name) from (
					select tt.tag_id from track_tags tt where tt.track_id = t.id
					union select at.tag_id from artist_tags at join track_artists ta on ta.artist_id = at.artist_id where ta.track_id = t.id
				) x join tags tg on tg.id = x.tag_id), '{}'),
			ma.energy, ma.valence, ma.tempo_bpm,
			exists (select 1 from likes l where l.user_id = $1 and l.track_id = t.id),
			(select count(*) from playlist_items pi where pi.track_id = t.id),
			exists (select 1 from picks p where p.track_id = t.id and p.author_id <> $1 and not p.placeholder)
		from tracks t
		join track_media tm on tm.track_id = t.id and tm.variant = 'main'
		join media_assets ma on ma.id = tm.asset_id
		where not exists (select 1 from hidden_items h where h.user_id = $1 and h.item_type = 'track' and h.item_id = t.id)
		  and not exists (select 1 from hidden_items h join track_artists x on x.artist_id = h.item_id
		                  where h.user_id = $1 and h.item_type = 'artist' and x.track_id = t.id)`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (MixTrack, error) {
		var m MixTrack
		return m, r.Scan(&m.ID, &m.ArtistIDs, &m.Tags, &m.Energy, &m.Valence, &m.Tempo, &m.Liked, &m.Playlists, &m.Picked)
	})
}

func (s *Store) RelatedArtists(ctx context.Context, artistIDs []uuid.UUID) (map[uuid.UUID][]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select artist_id, related_artist_id from artist_related
		where artist_id = any($1) and related_artist_id is not null order by artist_id, rank`, artistIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID][]uuid.UUID{}
	for rows.Next() {
		var a, b uuid.UUID
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		out[a] = append(out[a], b)
	}
	return out, rows.Err()
}

func (s *Store) PlaylistTrackIDs(ctx context.Context, playlistID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select track_id from playlist_items where playlist_id = $1 order by position`, playlistID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

type Seed struct {
	Artists map[uuid.UUID]float64
	Tags    map[string]float64
	Energy  *float64
	Valence *float64
}

type Steer struct {
	Skipped map[uuid.UUID]int
	Liked   map[uuid.UUID]int
}

func SeedFrom(tracks []MixTrack, related map[uuid.UUID][]uuid.UUID) Seed {
	seed := Seed{Artists: map[uuid.UUID]float64{}, Tags: map[string]float64{}}
	var e, v float64
	var n int
	for _, t := range tracks {
		for _, a := range t.ArtistIDs {
			seed.Artists[a]++
		}
		for _, tag := range t.Tags {
			seed.Tags[tag]++
		}
		if t.Energy != nil && t.Valence != nil {
			e += float64(*t.Energy)
			v += float64(*t.Valence)
			n++
		}
	}
	normalize(seed.Artists)
	normalize(seed.Tags)
	for a, rel := range related {
		if seed.Artists[a] == 0 {
			continue
		}
		for _, b := range rel {
			if w := 0.6 * seed.Artists[a]; w > seed.Artists[b] {
				seed.Artists[b] = w
			}
		}
	}
	if n > 0 {
		e, v = e/float64(n), v/float64(n)
		seed.Energy, seed.Valence = &e, &v
	}
	return seed
}

func normalize[K comparable](m map[K]float64) {
	top := 0.0
	for _, w := range m {
		top = math.Max(top, w)
	}
	for k, w := range m {
		m[k] = w / top
	}
}

const PickBoost = 1.15

func Score(t MixTrack, seed Seed, steer Steer) float64 {
	artist := 0.0
	for _, a := range t.ArtistIDs {
		artist = math.Max(artist, seed.Artists[a])
	}
	tags := 0.0
	if len(t.Tags) > 0 && len(seed.Tags) > 0 {
		sum := 0.0
		for _, tag := range t.Tags {
			sum += seed.Tags[tag]
		}
		tags = math.Min(1, sum/math.Sqrt(float64(len(t.Tags))*float64(len(seed.Tags))))
	}
	audio := 0.5
	if seed.Energy != nil && seed.Valence != nil && t.Energy != nil && t.Valence != nil {
		d := math.Hypot(float64(*t.Energy)-*seed.Energy, float64(*t.Valence)-*seed.Valence)
		audio = 1 - math.Min(1, d/math.Sqrt2)
	}
	affinity := 0.0
	if t.Liked {
		affinity = 1
	} else if t.Playlists > 0 {
		affinity = 0.5
	}
	score := 0.35*artist + 0.25*tags + 0.25*audio + 0.15*affinity
	if t.Picked {
		score *= PickBoost
	}
	for _, a := range t.ArtistIDs {
		score *= math.Pow(0.5, float64(steer.Skipped[a]))
		score *= math.Pow(1.3, float64(min(steer.Liked[a], 3)))
	}
	return score
}

func Pick(cands []MixTrack, seed Seed, steer Steer, exclude map[uuid.UUID]bool, recentArtists []uuid.UUID, n int, rng *rand.Rand) []uuid.UUID {
	type scored struct {
		t     MixTrack
		score float64
	}
	list := make([]scored, 0, len(cands))
	for _, t := range cands {
		if exclude[t.ID] {
			continue
		}
		list = append(list, scored{t, Score(t, seed, steer) * (0.9 + 0.2*rng.Float64())})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].score > list[j].score })
	recent := append([]uuid.UUID(nil), recentArtists...)
	spaced := func(t MixTrack, window int) bool {
		tail := recent
		if len(tail) > window {
			tail = tail[len(tail)-window:]
		}
		for _, a := range t.ArtistIDs {
			for _, r := range tail {
				if a == r {
					return false
				}
			}
		}
		return true
	}
	var out []uuid.UUID
	used := map[uuid.UUID]bool{}
	for len(out) < n {
		picked := false
		for _, window := range []int{3, 1, 0} {
			for _, c := range list {
				if used[c.t.ID] || !spaced(c.t, window) {
					continue
				}
				used[c.t.ID] = true
				out = append(out, c.t.ID)
				if len(c.t.ArtistIDs) > 0 {
					recent = append(recent, c.t.ArtistIDs[0])
				}
				picked = true
				break
			}
			if picked {
				break
			}
		}
		if !picked {
			break
		}
	}
	return out
}
