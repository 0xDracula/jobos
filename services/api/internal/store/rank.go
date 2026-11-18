package store

import (
	"math"
	"math/rand/v2"
	"sort"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

func KMeans(points [][]float32, weights []float64, k int, seed uint64) []int {
	n := len(points)
	assign := make([]int, n)
	if n == 0 || k <= 1 {
		return assign
	}
	k = min(k, n)
	rng := rand.New(rand.NewPCG(seed, 0x6a6f62626f73))
	centers := make([][]float32, 0, k)
	centers = append(centers, points[rng.IntN(n)])
	dist := make([]float64, n)
	for len(centers) < k {
		total := 0.0
		for i, p := range points {
			d := math.Inf(1)
			for _, c := range centers {
				d = math.Min(d, 1-Dot(p, c))
			}
			dist[i] = math.Max(d, 0) * weights[i]
			total += dist[i]
		}
		if total == 0 {
			break
		}
		r := rng.Float64() * total
		next := n - 1
		for i, d := range dist {
			if r -= d; r <= 0 {
				next = i
				break
			}
		}
		centers = append(centers, points[next])
	}
	k = len(centers)
	dims := len(points[0])
	for iter := 0; iter < 30; iter++ {
		changed := false
		for i, p := range points {
			best, bi := math.Inf(-1), 0
			for c, center := range centers {
				if s := Dot(p, center); s > best {
					best, bi = s, c
				}
			}
			if assign[i] != bi || iter == 0 {
				changed = changed || assign[i] != bi
				assign[i] = bi
			}
		}
		if !changed && iter > 0 {
			break
		}
		sums := make([][]float64, k)
		for c := range sums {
			sums[c] = make([]float64, dims)
		}
		for i, p := range points {
			for d, x := range p {
				sums[assign[i]][d] += float64(x) * weights[i]
			}
		}
		for c := range centers {
			v := make([]float32, dims)
			nonzero := false
			for d, x := range sums[c] {
				v[d] = float32(x)
				nonzero = nonzero || x != 0
			}
			if nonzero {
				centers[c] = unit(v)
			}
		}
	}
	return assign
}

func Silhouette(points [][]float32, assign []int, k int) float64 {
	n := len(points)
	if n < 2 || k < 2 {
		return 0
	}
	total := 0.0
	for i := range points {
		sum := make([]float64, k)
		count := make([]int, k)
		for j := range points {
			if i == j {
				continue
			}
			sum[assign[j]] += 1 - Dot(points[i], points[j])
			count[assign[j]]++
		}
		own := assign[i]
		if count[own] == 0 {
			continue
		}
		a := sum[own] / float64(count[own])
		b := math.Inf(1)
		for c := 0; c < k; c++ {
			if c != own && count[c] > 0 {
				b = math.Min(b, sum[c]/float64(count[c]))
			}
		}
		if math.IsInf(b, 1) {
			continue
		}
		total += (b - a) / math.Max(a, b)
	}
	return total / float64(n)
}

type Cand struct {
	TrackID         uuid.UUID
	Key             string
	Title           string
	Artists         []string
	ArtistIDs       []uuid.UUID
	Tags            []string
	Embedding       []float32
	Audio           MixTrack
	Sources         map[string]float64
	SeedTrack       uuid.UUID
	SeedArtist      string
	Popularity      *float64
	Signal          *TrackSignal
	Picked          bool
	RelatedAffinity float64
	RelatedTo       uuid.UUID
	Language        float64
	Group           int

	VideoID, DeezerID, Album, ArtworkURL string
	ArtistRefs                           []ArtistRef
	DurationMs                           *int32
	TopArtist                            uuid.UUID
	TopRank                              int

	Features Features
	Score    float64
	Reason   Reason
}

func (c *Cand) New() bool { return !c.Signal.Known() }

func (c *Cand) PrimaryArtist() string {
	if len(c.ArtistIDs) > 0 {
		return c.ArtistIDs[0].String()
	}
	if len(c.Artists) > 0 {
		return strings.ToLower(strings.TrimSpace(c.Artists[0]))
	}
	return c.Key
}

type Features struct {
	Taste, Artist, Tag, Agreement, Context, Novelty, Popularity, Penalty float64
}

const (
	WTaste        = 0.35
	WArtist       = 0.20
	WTag          = 0.10
	WAgreement    = 0.10
	WContext      = 0.10
	WNovelty      = 0.10
	WPopularity   = 0.05
	PenaltyRecent = 0.25
	PenaltySkip   = 0.15
)

func RankScore(f Features) float64 {
	return WTaste*f.Taste + WArtist*f.Artist + WTag*f.Tag + WAgreement*f.Agreement + WContext*f.Context +
		WNovelty*f.Novelty + WPopularity*f.Popularity - f.Penalty
}

func PercentileRanks(values []float64) []float64 {
	out := make([]float64, len(values))
	if len(values) < 2 {
		for i := range out {
			out[i] = 1
		}
		return out
	}
	idx := make([]int, len(values))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return values[idx[a]] < values[idx[b]] })
	for r, i := range idx {
		out[i] = float64(r) / float64(len(values)-1)
	}
	return out
}

func TagAffinity(tags []string, aff map[string]float64) float64 {
	var vals []float64
	for _, t := range tags {
		if v := aff[t]; v > 0 {
			vals = append(vals, v)
		}
	}
	if len(vals) == 0 {
		return 0
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(vals)))
	vals = vals[:min(3, len(vals))]
	sum := 0.0
	for _, v := range vals {
		sum += v
	}
	return sum / 3
}

var otherLanguageTags = map[string]bool{
	"french": true, "chanson": true, "k-pop": true, "kpop": true, "j-pop": true, "jpop": true, "turkish": true,
	"spanish": true, "latin": true, "reggaeton": true, "german": true, "russian": true, "hindi": true,
	"bollywood": true, "persian": true, "iranian": true, "italian": true, "portuguese": true, "brazilian": true,
	"mpb": true, "greek": true, "hebrew": true, "israeli": true, "chinese": true, "mandopop": true,
	"cantopop": true, "japanese": true, "korean": true, "kurdish": true, "armenian": true,
}

func LanguageFactor(title string, artists []string, tags []string, known bool) float64 {
	if known {
		return 1
	}
	text := title + " " + strings.Join(artists, " ")
	latin, other := false, false
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Arabic, r):
			return 1
		case unicode.Is(unicode.Latin, r):
			latin = true
		case unicode.IsLetter(r):
			other = true
		}
	}
	for _, t := range tags {
		if otherLanguageTags[t] {
			return 0.5
		}
	}
	if other && !latin {
		return 0.4
	}
	return 0.9
}

type Reason struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
}

const (
	MMRLambda      = 0.7
	MaxPerArtist   = 2
	ArtistWindowOf = 25
)

func candSimilarity(a, b *Cand) float64 {
	if a.PrimaryArtist() == b.PrimaryArtist() {
		return 1
	}
	if len(a.Embedding) > 0 && len(b.Embedding) > 0 {
		return math.Max(0, Dot(a.Embedding, b.Embedding))
	}
	return 0
}

func Rerank(cands []*Cand, n int, discovery float64) []*Cand {
	wantNew := int(math.Round(discovery * float64(n)))
	var fresh, known []*Cand
	for _, c := range cands {
		if c.New() {
			fresh = append(fresh, c)
		} else {
			known = append(known, c)
		}
	}
	perArtist := map[string]int{}
	var picked []*Cand
	pick := func(pool []*Cand, want int) {
		used := map[*Cand]bool{}
		for taken := 0; taken < want; taken++ {
			var best *Cand
			bestScore := math.Inf(-1)
			for _, c := range pool {
				if used[c] || perArtist[c.PrimaryArtist()] >= MaxPerArtist {
					continue
				}
				maxSim := 0.0
				for _, p := range picked {
					maxSim = math.Max(maxSim, candSimilarity(c, p))
				}
				if s := MMRLambda*c.Score - (1-MMRLambda)*maxSim; s > bestScore {
					best, bestScore = c, s
				}
			}
			if best == nil {
				return
			}
			used[best] = true
			perArtist[best.PrimaryArtist()]++
			picked = append(picked, best)
		}
	}
	pick(fresh, wantNew)
	pick(known, n-len(picked))
	if len(picked) < n {
		pick(fresh, n-len(picked))
	}
	return order(picked)
}

func order(list []*Cand) []*Cand {
	sort.SliceStable(list, func(i, j int) bool { return list[i].Score > list[j].Score })
	var fresh, known []*Cand
	for _, c := range list {
		if c.New() {
			fresh = append(fresh, c)
		} else {
			known = append(known, c)
		}
	}
	merged := make([]*Cand, 0, len(list))
	if len(fresh) > 0 {
		every := float64(len(list)) / float64(len(fresh))
		next := every / 2
		for i := 0; i < len(list); i++ {
			if len(fresh) > 0 && (float64(i) >= next || len(known) == 0) {
				merged = append(merged, fresh[0])
				fresh = fresh[1:]
				next += every
			} else if len(known) > 0 {
				merged = append(merged, known[0])
				known = known[1:]
			}
		}
	} else {
		merged = append(merged, known...)
	}
	for i := 1; i < len(merged); i++ {
		if merged[i].PrimaryArtist() != merged[i-1].PrimaryArtist() {
			continue
		}
		for j := i + 1; j < len(merged); j++ {
			if merged[j].PrimaryArtist() != merged[i-1].PrimaryArtist() &&
				(j+1 >= len(merged) || merged[i].PrimaryArtist() != merged[j+1].PrimaryArtist()) {
				merged[i], merged[j] = merged[j], merged[i]
				break
			}
		}
	}
	return merged
}
