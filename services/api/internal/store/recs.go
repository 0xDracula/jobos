package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	MixDaily      = "daily"
	MixYourSong   = "your_song"
	MixMorning    = "morning"
	MixAfternoon  = "afternoon"
	MixEvening    = "evening"
	MixLateNight  = "late_night"
	MixHappy      = "happy"
	MixCalm       = "calm"
	MixSad        = "sad"
	MixEnergetic  = "energetic"
	MixRediscover = "rediscover"
)

var (
	DailyMixes  = []string{MixDaily, MixMorning, MixAfternoon, MixEvening, MixLateNight, MixHappy, MixCalm, MixSad, MixEnergetic}
	WeeklyMixes = []string{MixYourSong, MixRediscover}
	AllMixes    = append(append([]string{}, DailyMixes...), WeeklyMixes...)
)

type mixSpec struct {
	Size      int
	Discovery float64
	Min       int
}

var mixSpecs = map[string]mixSpec{
	MixDaily:      {25, 0.20, 10},
	MixYourSong:   {30, 0.40, 10},
	MixMorning:    {25, 0.20, 10},
	MixAfternoon:  {25, 0.20, 10},
	MixEvening:    {25, 0.20, 10},
	MixLateNight:  {25, 0.20, 10},
	MixHappy:      {25, 0.10, 10},
	MixCalm:       {25, 0.10, 10},
	MixSad:        {25, 0.10, 10},
	MixEnergetic:  {25, 0.10, 10},
	MixRediscover: {20, 0, 8},
}

func PeriodOf(hour int) string {
	switch {
	case hour >= 5 && hour < 12:
		return MixMorning
	case hour >= 12 && hour < 17:
		return MixAfternoon
	case hour >= 17 && hour < 22:
		return MixEvening
	default:
		return MixLateNight
	}
}

var periodTargets = map[string][2]float64{
	MixMorning:   {0.55, 0.65},
	MixAfternoon: {0.70, 0.70},
	MixEvening:   {0.45, 0.50},
	MixLateNight: {0.30, 0.40},
}

const PeriodLearnedAt = 20

const RediscoverAfter = 60 * 24 * time.Hour

type MixItem struct {
	TrackID uuid.UUID `json:"track_id"`
	Reason  Reason    `json:"reason"`
	New     bool      `json:"new"`
}

type RecData struct {
	UserID       uuid.UUID
	Now          time.Time
	Taste        *Taste
	Emb          *Embeddings
	Cands        []*Cand
	byTrack      map[uuid.UUID]*Cand
	names        map[uuid.UUID]trackName
	artists      map[uuid.UUID]string
	OurSong      uuid.UUID
	OtherName    string
	periodGroups map[string]map[int]float64
	periodPlays  map[string]int
}

type trackName struct {
	Title   string
	Artists []string
}

func (s *Store) libraryNames(ctx context.Context) (map[uuid.UUID]trackName, map[uuid.UUID]string, error) {
	rows, err := s.pool.Query(ctx, `select t.id, t.title, coalesce((select array_agg(a.name order by ta.position)
		from track_artists ta join artists a on a.id = ta.artist_id where ta.track_id = t.id), '{}') from tracks t`)
	if err != nil {
		return nil, nil, err
	}
	names := map[uuid.UUID]trackName{}
	for rows.Next() {
		var id uuid.UUID
		var n trackName
		if err := rows.Scan(&id, &n.Title, &n.Artists); err != nil {
			rows.Close()
			return nil, nil, err
		}
		names[id] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	arows, err := s.pool.Query(ctx, `select id, name from artists`)
	if err != nil {
		return nil, nil, err
	}
	artists := map[uuid.UUID]string{}
	for arows.Next() {
		var id uuid.UUID
		var name string
		if err := arows.Scan(&id, &name); err != nil {
			arows.Close()
			return nil, nil, err
		}
		artists[id] = name
	}
	arows.Close()
	return names, artists, arows.Err()
}

func foldName(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}

func songKey(artist, title string) string {
	if i := strings.IndexAny(title, "(["); i > 0 {
		title = title[:i]
	}
	return foldName(artist) + "|" + foldName(title)
}

func (s *Store) LoadRecs(ctx context.Context, userID uuid.UUID, now time.Time, loc *time.Location) (*RecData, error) {
	lib, err := s.MixCandidates(ctx, userID)
	if err != nil {
		return nil, err
	}
	signals, err := s.Signals(ctx, userID, now)
	if err != nil {
		return nil, err
	}
	emb, err := s.LoadEmbeddings(ctx)
	if err != nil {
		return nil, err
	}
	names, artistNames, err := s.libraryNames(ctx)
	if err != nil {
		return nil, err
	}
	libMap := make(map[uuid.UUID]MixTrack, len(lib))
	for _, m := range lib {
		libMap[m.ID] = m
	}
	h := fnv.New64a()
	_, _ = h.Write(userID[:])
	d := &RecData{UserID: userID, Now: now, Emb: emb, byTrack: map[uuid.UUID]*Cand{}, names: names, artists: artistNames}
	d.Taste = BuildTaste(signals, libMap, emb, h.Sum64())

	wrong, err := s.wrongMatches(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, m := range lib {
		if wrong[m.ID] {
			continue
		}
		n := names[m.ID]
		c := &Cand{TrackID: m.ID, Title: n.Title, Artists: n.Artists, ArtistIDs: m.ArtistIDs, Tags: m.Tags,
			Embedding: emb.Get(m.ID), Audio: m, Sources: map[string]float64{}, Signal: signals[m.ID], Picked: m.Picked}
		if m.Picked {
			c.Sources["pick"] = 1
		}
		d.Cands = append(d.Cands, c)
		d.byTrack[m.ID] = c
	}
	d.dedupeLibrary()
	if err := s.loadOutside(ctx, d); err != nil {
		return nil, err
	}
	if err := s.loadLikedArtistTracks(ctx, d); err != nil {
		return nil, err
	}
	for _, c := range d.Cands {
		known := c.Signal.Known() || len(c.ArtistIDs) > 0 && d.Taste.Artists[c.ArtistIDs[0]] > 0
		c.Language = LanguageFactor(c.Title, c.Artists, c.Tags, known)
		if c.Embedding != nil {
			_, c.Group = d.Taste.TasteSim(c.Embedding)
		} else {
			c.Group = -1
		}
	}
	var raw json.RawMessage
	if err := s.pool.QueryRow(ctx, `select value from app_settings where key = 'our_song'`).Scan(&raw); err == nil {
		var v struct {
			TrackID *uuid.UUID `json:"track_id"`
		}
		if json.Unmarshal(raw, &v) == nil && v.TrackID != nil {
			d.OurSong = *v.TrackID
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `select display_name from users where id <> $1 order by role = 'admin' desc limit 1`, userID).
		Scan(&d.OtherName); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return d, s.loadPeriods(ctx, d, loc)
}

func (d *RecData) dedupeLibrary() {
	best := map[string]*Cand{}
	rank := func(c *Cand) float64 {
		if c.Signal == nil {
			return -100
		}
		return c.Signal.Score + float64(c.Signal.Plays)
	}
	for _, c := range d.Cands {
		if len(c.Artists) == 0 {
			continue
		}
		k := songKey(c.Artists[0], c.Title)
		if b, ok := best[k]; !ok || rank(c) > rank(b) {
			best[k] = c
		}
	}
	kept := d.Cands[:0]
	for _, c := range d.Cands {
		if len(c.Artists) == 0 || best[songKey(c.Artists[0], c.Title)] == c {
			kept = append(kept, c)
		} else {
			delete(d.byTrack, c.TrackID)
		}
	}
	d.Cands = kept
}

func (s *Store) wrongMatches(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := s.pool.Query(ctx, `select track_id from match_checks where verdict = 'wrong'`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	out := map[uuid.UUID]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out, err
}

type candSource struct {
	Score      float64    `json:"score"`
	SeedTrack  *uuid.UUID `json:"seed_track,omitempty"`
	SeedArtist string     `json:"seed_artist,omitempty"`
}

func (s *Store) loadOutside(ctx context.Context, d *RecData) error {
	byName := map[string][]uuid.UUID{}
	rows, err := s.pool.Query(ctx, `select id, name, name_latin from artists`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id uuid.UUID
		var name string
		var latin *string
		if err := rows.Scan(&id, &name, &latin); err != nil {
			rows.Close()
			return err
		}
		byName[foldName(name)] = append(byName[foldName(name)], id)
		if latin != nil {
			byName[foldName(*latin)] = append(byName[foldName(*latin)], id)
		}
	}
	rows.Close()
	related := map[string]struct {
		aff float64
		to  uuid.UUID
	}{}
	rrows, err := s.pool.Query(ctx, `select artist_id, name from artist_related`)
	if err != nil {
		return err
	}
	for rrows.Next() {
		var a uuid.UUID
		var name string
		if err := rrows.Scan(&a, &name); err != nil {
			rrows.Close()
			return err
		}
		if aff := 0.6 * d.Taste.Artists[a]; aff > related[foldName(name)].aff {
			related[foldName(name)] = struct {
				aff float64
				to  uuid.UUID
			}{aff, a}
		}
	}
	rrows.Close()
	artistTags := map[uuid.UUID][]string{}
	trows, err := s.pool.Query(ctx, `select at.artist_id, t.name from artist_tags at join tags t on t.id = at.tag_id`)
	if err != nil {
		return err
	}
	for trows.Next() {
		var a uuid.UUID
		var tag string
		if err := trows.Scan(&a, &tag); err != nil {
			trows.Close()
			return err
		}
		artistTags[a] = append(artistTags[a], tag)
	}
	trows.Close()
	hiddenArtists := map[uuid.UUID]bool{}
	hrows, err := s.pool.Query(ctx, `select item_id from hidden_items where user_id = $1 and item_type = 'artist'`, d.UserID)
	if err != nil {
		return err
	}
	hidden, err := pgx.CollectRows(hrows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	for _, id := range hidden {
		hiddenArtists[id] = true
	}

	librarySongs := map[string]bool{}
	for _, c := range d.Cands {
		for _, a := range c.Artists {
			librarySongs[songKey(a, c.Title)] = true
		}
	}
	crows, err := s.pool.Query(ctx, `select key, title, artists, track_id, video_id, deezer_id, album, duration_ms, artwork_url,
		sources, popularity from rec_candidates where user_id = $1`, d.UserID)
	if err != nil {
		return err
	}
	defer crows.Close()
	for crows.Next() {
		c := &Cand{Sources: map[string]float64{}, Group: -1}
		var artists []byte
		var trackID *uuid.UUID
		var video, deezer, album, artwork *string
		var sources []byte
		var pop *float32
		if err := crows.Scan(&c.Key, &c.Title, &artists, &trackID, &video, &deezer, &album, &c.DurationMs, &artwork, &sources, &pop); err != nil {
			return err
		}
		var refs []struct {
			Name      string `json:"name"`
			YtmusicID string `json:"ytmusic_id"`
		}
		_ = json.Unmarshal(artists, &refs)
		var srcs map[string]candSource
		_ = json.Unmarshal(sources, &srcs)
		bestSeed := -1.0
		for name, src := range srcs {
			c.Sources[name] = src.Score
			if src.Score > bestSeed {
				bestSeed = src.Score
				c.SeedArtist = src.SeedArtist
				if src.SeedTrack != nil {
					c.SeedTrack = *src.SeedTrack
				} else {
					c.SeedTrack = uuid.Nil
				}
			}
		}
		if trackID != nil {
			if lc := d.byTrack[*trackID]; lc != nil {
				for k, v := range c.Sources {
					lc.Sources[k] = v
				}
				if lc.SeedTrack == uuid.Nil {
					lc.SeedTrack, lc.SeedArtist = c.SeedTrack, c.SeedArtist
				}
				continue
			}
			c.TrackID = *trackID
		}
		hiddenArtist := false
		for _, r := range refs {
			c.Artists = append(c.Artists, r.Name)
			c.ArtistRefs = append(c.ArtistRefs, ArtistRef{Name: r.Name, ID: r.YtmusicID})
			for _, id := range byName[foldName(r.Name)] {
				c.ArtistIDs = append(c.ArtistIDs, id)
				c.Tags = append(c.Tags, artistTags[id]...)
				hiddenArtist = hiddenArtist || hiddenArtists[id]
			}
		}
		if hiddenArtist || len(c.Artists) > 0 && librarySongs[songKey(c.Artists[0], c.Title)] {
			continue
		}
		if len(c.Artists) > 0 {
			if rel, ok := related[foldName(c.Artists[0])]; ok {
				c.RelatedAffinity, c.RelatedTo = rel.aff, rel.to
			}
		}
		if pop != nil {
			p := float64(*pop)
			c.Popularity = &p
		}
		c.VideoID, c.DeezerID, c.Album, c.ArtworkURL = deref(video), deref(deezer), deref(album), deref(artwork)
		d.Cands = append(d.Cands, c)
	}
	return crows.Err()
}

const LikedArtistTracks = 40

func (s *Store) loadLikedArtistTracks(ctx context.Context, d *RecData) error {
	type ranked struct {
		id  uuid.UUID
		aff float64
	}
	var top []ranked
	for id, aff := range d.Taste.Artists {
		if aff >= 0.25 {
			top = append(top, ranked{id, aff})
		}
	}
	sort.Slice(top, func(i, j int) bool { return top[i].aff > top[j].aff })
	ids := make([]uuid.UUID, 0, len(top))
	for _, r := range top {
		ids = append(ids, r.id)
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `select tt.artist_id, tt.rank, tt.title, tt.album, tt.duration_ms, tt.artwork_url
		from artist_top_tracks tt
		where tt.artist_id = any($1)
		  and not exists (select 1 from track_media tm where tm.track_id = tt.track_id and tm.variant = 'main')
		order by array_position($1, tt.artist_id), tt.rank`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	seen := map[string]bool{}
	for _, c := range d.Cands {
		if len(c.ArtistIDs) > 0 {
			seen[c.ArtistIDs[0].String()+"|"+foldName(c.Title)] = true
		}
	}
	added := 0
	for rows.Next() && added < LikedArtistTracks {
		var artist uuid.UUID
		var rank int
		var title string
		var album, artwork *string
		var dur *int32
		if err := rows.Scan(&artist, &rank, &title, &album, &dur, &artwork); err != nil {
			return err
		}
		if seen[artist.String()+"|"+foldName(title)] {
			continue
		}
		seen[artist.String()+"|"+foldName(title)] = true
		c := &Cand{Title: title, Artists: []string{d.artists[artist]}, ArtistIDs: []uuid.UUID{artist}, Group: -1,
			Sources: map[string]float64{"liked_artist": 1 - float64(rank)/10}, Album: deref(album), ArtworkURL: deref(artwork),
			DurationMs: dur, TopArtist: artist, TopRank: rank}
		d.Cands = append(d.Cands, c)
		added++
	}
	return rows.Err()
}

func (s *Store) loadPeriods(ctx context.Context, d *RecData, loc *time.Location) error {
	d.periodGroups = map[string]map[int]float64{}
	d.periodPlays = map[string]int{}
	rows, err := s.pool.Query(ctx, `select track_id, created_at from listening_events
		where user_id = $1 and event = 'start' and created_at > $2`, d.UserID, d.Now.Add(-90*24*time.Hour))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var at time.Time
		if err := rows.Scan(&id, &at); err != nil {
			return err
		}
		p := PeriodOf(at.In(loc).Hour())
		d.periodPlays[p]++
		if c := d.byTrack[id]; c != nil && c.Group >= 0 {
			if d.periodGroups[p] == nil {
				d.periodGroups[p] = map[int]float64{}
			}
			d.periodGroups[p][c.Group]++
		}
	}
	return rows.Err()
}

func (d *RecData) featurize(cands []*Cand, context func(*Cand) float64) {
	var tasteVals, popVals []float64
	var tasteIdx, popIdx []int
	for i, c := range cands {
		if c.Embedding != nil {
			sim, _ := d.Taste.TasteSim(c.Embedding)
			tasteVals = append(tasteVals, sim)
			tasteIdx = append(tasteIdx, i)
		}
		if c.Popularity != nil {
			popVals = append(popVals, *c.Popularity)
			popIdx = append(popIdx, i)
		}
	}
	taste := make([]float64, len(cands))
	pop := make([]float64, len(cands))
	for i := range pop {
		pop[i] = 0.3
	}
	for r, v := range PercentileRanks(tasteVals) {
		taste[tasteIdx[r]] = v
	}
	for r, v := range PercentileRanks(popVals) {
		pop[popIdx[r]] = v
	}
	for i, c := range cands {
		f := Features{Popularity: pop[i], Context: 0.5, Novelty: 0.3}
		for _, a := range c.ArtistIDs {
			f.Artist = math.Max(f.Artist, d.Taste.Artists[a])
		}
		if f.Artist == 0 {
			f.Artist = c.RelatedAffinity
		}
		f.Tag = TagAffinity(c.Tags, d.Taste.Tags)
		if c.Embedding != nil && len(d.Taste.Groups) > 0 {
			f.Taste = taste[i]
		} else {
			f.Taste = 0.6*f.Artist + 0.4*f.Tag
		}
		best := 0.0
		for _, v := range c.Sources {
			best = math.Max(best, v)
		}
		f.Agreement = 0.6*math.Min(1, float64(len(c.Sources))/3) + 0.4*best
		if context != nil {
			f.Context = context(c)
		}
		if c.New() {
			f.Novelty = 1
		}
		if sig := c.Signal; sig != nil {
			if !sig.LastPlayed.IsZero() && d.Now.Sub(sig.LastPlayed) < 7*24*time.Hour {
				f.Penalty += PenaltyRecent
			}
			f.Penalty += PenaltySkip * float64(min(sig.Skips, 3))
		}
		c.Features = f
		c.Score = RankScore(f) * c.Language
		if c.Picked {
			c.Score *= PickBoost
		}
	}
}

func moodFit(kind string, m MixTrack) (float64, bool) {
	if m.Happy == nil || m.Sad == nil || m.Relaxed == nil || m.Arousal == nil {
		return 0, false
	}
	val := 0.5
	if m.Valence != nil {
		val = float64(*m.Valence)
	}
	energy := float64(*m.Arousal)
	if m.Energy != nil {
		energy = 0.5*energy + 0.5*float64(*m.Energy)
	}
	switch kind {
	case MixHappy:
		return 0.6*float64(*m.Happy) + 0.4*val, true
	case MixCalm:
		return 0.6*float64(*m.Relaxed) + 0.4*(1-energy), true
	case MixSad:
		return 0.7*float64(*m.Sad) + 0.3*(1-val), true
	case MixEnergetic:
		return 0.6*energy + 0.2*float64(*m.Arousal) + 0.2*(1-float64(*m.Relaxed)), true
	}
	return 0, false
}

func audioFit(m MixTrack, target [2]float64) float64 {
	if m.Energy == nil || m.Valence == nil {
		return 0.5
	}
	return 1 - math.Min(1, math.Hypot(float64(*m.Energy)-target[0], float64(*m.Valence)-target[1])/math.Sqrt2)
}

func (d *RecData) Build(kind string) []*Cand {
	spec := mixSpecs[kind]
	cands := make([]*Cand, 0, len(d.Cands))
	switch kind {
	case MixDaily:
		d.featurize(d.Cands, nil)
		cands = append(cands, d.Cands...)
	case MixMorning, MixAfternoon, MixEvening, MixLateNight:
		learned := d.periodPlays[kind] >= PeriodLearnedAt
		groups := d.periodGroups[kind]
		top := 0.0
		for _, v := range groups {
			top = math.Max(top, v)
		}
		d.featurize(d.Cands, func(c *Cand) float64 {
			if learned && top > 0 && c.Group >= 0 {
				return groups[c.Group] / top
			}
			return audioFit(c.Audio, periodTargets[kind])
		})
		for _, c := range d.Cands {
			c.Score = 0.6*c.Score + 0.4*c.Features.Context*c.Language
			cands = append(cands, c)
		}
	case MixHappy, MixCalm, MixSad, MixEnergetic:
		d.featurize(d.Cands, nil)
		for _, c := range d.Cands {
			fit, ok := moodFit(kind, c.Audio)
			if !ok || fit < 0.45 {
				continue
			}
			c.Score = 0.65*fit + 0.35*c.Score
			cands = append(cands, c)
		}
	case MixYourSong:
		cands = d.yourSong()
	case MixRediscover:
		cands = d.rediscover()
	}
	list := Rerank(cands, spec.Size, spec.Discovery)
	for _, c := range list {
		c.Reason = d.reason(kind, c)
	}
	return list
}

func (d *RecData) yourSong() []*Cand {
	seed := d.byTrack[d.OurSong]
	if seed == nil {
		return nil
	}
	d.featurize(d.Cands, nil)
	seedArtists := map[uuid.UUID]bool{}
	for _, a := range seed.ArtistIDs {
		seedArtists[a] = true
	}
	var out []*Cand
	var sims []float64
	for _, c := range d.Cands {
		if c == seed {
			continue
		}
		fromSeed := 0.0
		if c.SeedTrack == d.OurSong {
			for _, v := range c.Sources {
				fromSeed = math.Max(fromSeed, v)
			}
		}
		related := 0.0
		if seedArtists[c.RelatedTo] {
			related = 1
		}
		for _, a := range c.ArtistIDs {
			if seedArtists[a] {
				related = 0.7
			}
		}
		sim := -1.0
		if seed.Embedding != nil && c.Embedding != nil {
			sim = Dot(seed.Embedding, c.Embedding)
		}
		if fromSeed == 0 && related == 0 && sim < 0.2 {
			continue
		}
		c.Features.Context = fromSeed
		c.Features.Agreement = related
		sims = append(sims, sim)
		out = append(out, c)
	}
	ranks := PercentileRanks(sims)
	for i, c := range out {
		simRank := 0.0
		if c.Embedding != nil && seed.Embedding != nil {
			simRank = ranks[i]
		}
		c.Score = (0.45*simRank + 0.25*c.Features.Context + 0.15*c.Features.Taste + 0.15*c.Features.Agreement) * c.Language
	}
	return out
}

func (d *RecData) rediscover() []*Cand {
	var out []*Cand
	var plays, scores []float64
	for _, c := range d.Cands {
		sig := c.Signal
		if sig == nil || !sig.Liked || c.TrackID == uuid.Nil || d.Now.Sub(sig.LastEngaged) < RediscoverAfter {
			continue
		}
		out = append(out, c)
		plays = append(plays, float64(sig.Plays))
		scores = append(scores, sig.Score)
	}
	p, s := PercentileRanks(plays), PercentileRanks(scores)
	for i, c := range out {
		c.Score = 0.6*p[i] + 0.4*s[i]
	}
	return out
}

func (d *RecData) reason(kind string, c *Cand) Reason {
	switch {
	case c.Picked:
		return Reason{"pick", "From " + nonEmptyOr(d.OtherName, "owner")}
	case kind == MixRediscover:
		return Reason{"rediscover", "Rediscover"}
	case kind == MixYourSong:
		if n, ok := d.names[d.OurSong]; ok {
			return Reason{"similar", "Similar to " + n.Title}
		}
	}
	if !c.New() {
		switch {
		case c.Signal.Plays >= 5:
			return Reason{"favorite", "On repeat"}
		case c.Signal.LikedInApp:
			return Reason{"favorite", "In your likes"}
		case c.Signal.Imported:
			return Reason{"favorite", "From your playlist"}
		default:
			return Reason{"favorite", "Played before"}
		}
	}
	f := c.Features
	type factor struct {
		weight float64
		reason Reason
	}
	var factors []factor
	if c.SeedTrack != uuid.Nil {
		if n, ok := d.names[c.SeedTrack]; ok {
			factors = append(factors, factor{WAgreement*f.Agreement + 0.1, Reason{"similar", "Similar to " + n.Title}})
		}
	} else if c.SeedArtist != "" {
		factors = append(factors, factor{WAgreement * f.Agreement, Reason{"related", "Similar to " + c.SeedArtist}})
	}
	direct := 0.0
	for _, a := range c.ArtistIDs {
		direct = math.Max(direct, d.Taste.Artists[a])
	}
	if direct > 0 {
		factors = append(factors, factor{WArtist * direct, Reason{"artist", "Artist in your likes"}})
	} else if c.RelatedAffinity > 0 {
		factors = append(factors, factor{WArtist * c.RelatedAffinity, Reason{"related", "Similar to " + d.artists[c.RelatedTo]}})
	}
	if c.Embedding != nil {
		if near := d.nearestLiked(c); near != uuid.Nil {
			factors = append(factors, factor{WTaste * f.Taste, Reason{"similar", "Similar to " + d.names[near].Title}})
		}
	}
	if len(factors) == 0 {
		return Reason{"taste", "New for you"}
	}
	sort.SliceStable(factors, func(i, j int) bool { return factors[i].weight > factors[j].weight })
	return factors[0].reason
}

func (d *RecData) nearestLiked(c *Cand) uuid.UUID {
	best, id := math.Inf(-1), uuid.Nil
	for tid, sig := range d.Taste.Signals {
		if tid == c.TrackID || sig.Score <= 0 {
			continue
		}
		if s := Dot(c.Embedding, d.Emb.Get(tid)); s > best {
			best, id = s, tid
		}
	}
	return id
}

func nonEmptyOr(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func (s *Store) GenerateMixes(ctx context.Context, userID uuid.UUID, kinds []string, now time.Time, loc *time.Location) (map[string]int, error) {
	d, err := s.LoadRecs(ctx, userID, now, loc)
	if err != nil {
		return nil, err
	}
	if err := s.SaveTasteGroups(ctx, userID, d.Taste.Groups); err != nil {
		return nil, err
	}
	built := map[string][]*Cand{}
	for _, kind := range kinds {
		built[kind] = d.Build(kind)
	}
	added := map[*Cand]bool{}
	var queue []uuid.UUID
	for _, kind := range kinds {
		for _, c := range built[kind] {
			if added[c] {
				continue
			}
			added[c] = true
			if c.TrackID == uuid.Nil {
				id, err := s.addCandidate(ctx, userID, c)
				if err != nil {
					return nil, fmt.Errorf("add %q: %w", c.Title, err)
				}
				c.TrackID = id
			}
			if c.Audio.ID == uuid.Nil {
				queue = append(queue, c.TrackID)
			}
		}
	}
	if _, err := s.Prefetch(ctx, queue); err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, kind := range kinds {
		items := make([]MixItem, 0, len(built[kind]))
		for _, c := range built[kind] {
			if c.TrackID != uuid.Nil {
				items = append(items, MixItem{TrackID: c.TrackID, Reason: c.Reason, New: c.New()})
			}
		}
		if len(items) < mixSpecs[kind].Min {
			items = []MixItem{}
		}
		raw, err := json.Marshal(items)
		if err != nil {
			return nil, err
		}
		if _, err := s.pool.Exec(ctx, `insert into mixes (user_id, kind, items, generated_at) values ($1, $2, $3, $4)
			on conflict (user_id, kind) do update set items = excluded.items, generated_at = excluded.generated_at`,
			userID, kind, raw, now); err != nil {
			return nil, err
		}
		counts[kind] = len(items)
	}
	return counts, nil
}

func (s *Store) addCandidate(ctx context.Context, userID uuid.UUID, c *Cand) (uuid.UUID, error) {
	var id uuid.UUID
	var err error
	switch {
	case c.VideoID != "":
		in := SourceTrack{Provider: "ytmusic", ExternalID: c.VideoID, Title: c.Title, Artists: c.ArtistRefs, DurationMs: c.DurationMs}
		if c.Album != "" {
			in.Album = &AlbumRef{Name: c.Album}
		}
		if c.ArtworkURL != "" {
			in.Thumbnail = &c.ArtworkURL
		}
		id, _, _, err = s.AddTrackFromSource(ctx, in)
	case c.TopArtist != uuid.Nil:
		id, err = s.AddTopTrack(ctx, c.TopArtist, c.TopRank)
	default:
		id, err = s.addPendingTrack(ctx, c)
	}
	if err != nil {
		return uuid.Nil, err
	}
	if c.Key != "" {
		if _, err := s.pool.Exec(ctx, `update rec_candidates set track_id = $3 where user_id = $1 and key = $2`, userID, c.Key, id); err != nil {
			return uuid.Nil, err
		}
	}
	return id, nil
}

func (s *Store) addPendingTrack(ctx context.Context, c *Cand) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	if len(c.ArtistIDs) > 0 {
		var existing uuid.UUID
		err := tx.QueryRow(ctx, `select t.id from tracks t join track_artists ta on ta.track_id = t.id
			where ta.artist_id = any($1) and `+titleKeySQL("t.title")+` = `+titleKeySQL("$2::text")+` order by t.created_at limit 1`,
			c.ArtistIDs, c.Title).Scan(&existing)
		if err == nil {
			return existing, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, err
		}
	}
	id := newID()
	var artwork *string
	if c.ArtworkURL != "" {
		artwork = &c.ArtworkURL
	}
	if _, err := tx.Exec(ctx, `insert into tracks (id, title, duration_ms, artwork_url, match_status) values ($1, $2, $3, $4, 'pending')`,
		id, c.Title, c.DurationMs, artwork); err != nil {
		return uuid.Nil, err
	}
	for i, name := range c.Artists {
		artistID, err := upsertArtist(ctx, tx, "ytmusic_id", "", name)
		if err != nil {
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `insert into track_artists (track_id, artist_id, position) values ($1, $2, $3) on conflict do nothing`,
			id, artistID, i); err != nil {
			return uuid.Nil, err
		}
	}
	p := MatchPayload{TrackID: id, Title: c.Title, Artists: c.Artists, Album: c.Album}
	if c.DurationMs != nil {
		p.DurationMs = *c.DurationMs
	}
	if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindMatchTrack, Payload: p, DedupeKey: MatchKey(id), Priority: PriorityMatch}); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

type Mix struct {
	Kind        string    `json:"kind"`
	Items       []MixItem `json:"items"`
	GeneratedAt time.Time `json:"generated_at"`
}

func (s *Store) Mixes(ctx context.Context, userID uuid.UUID) ([]Mix, error) {
	rows, err := s.pool.Query(ctx, `select kind, items, generated_at from mixes where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	mixes, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Mix, error) {
		var m Mix
		var raw []byte
		if err := r.Scan(&m.Kind, &raw, &m.GeneratedAt); err != nil {
			return m, err
		}
		return m, json.Unmarshal(raw, &m.Items)
	})
	if err != nil {
		return nil, err
	}
	drop, err := s.unplayable(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range mixes {
		kept := mixes[i].Items[:0]
		for _, it := range mixes[i].Items {
			if !drop[it.TrackID] {
				kept = append(kept, it)
			}
		}
		mixes[i].Items = kept
	}
	return mixes, nil
}

func (s *Store) unplayable(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := s.pool.Query(ctx, `select item_id from hidden_items where user_id = $1 and item_type = 'track'
		union select ta.track_id from hidden_items h join track_artists ta on ta.artist_id = h.item_id
			where h.user_id = $1 and h.item_type = 'artist'
		union select id from tracks where match_status in ('unmatched', 'failed')`, userID)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, err
}

func (s *Store) MixSize(ctx context.Context, userID uuid.UUID, kind string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) else 0 end
		from mixes where user_id = $1 and kind = $2`, userID, kind).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return n, err
}

func (s *Store) MixGeneratedAt(ctx context.Context, userID uuid.UUID, kind string) (time.Time, error) {
	var at time.Time
	err := s.pool.QueryRow(ctx, `select generated_at from mixes where user_id = $1 and kind = $2`, userID, kind).Scan(&at)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	return at, err
}
