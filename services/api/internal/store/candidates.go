package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	KindFetchCandidates = "fetch_candidates"
	KindFetchReleases   = "fetch_releases"
	SeedTracks          = 10
	SeedArtists         = 8
	SeedsPerGroup       = 2
	RelatedPerSeed      = 6
	ReleaseArtists      = 40
	ReleasesFirstLook   = 60 * 24 * time.Hour
)

type seedTrack struct {
	ID      uuid.UUID `json:"id"`
	Title   string    `json:"title"`
	Artists []string  `json:"artists"`
	VideoID string    `json:"video_id,omitempty"`
}

type relatedRef struct {
	Name     string `json:"name"`
	DeezerID string `json:"deezer_id"`
}

type seedArtist struct {
	ID       uuid.UUID    `json:"id"`
	Name     string       `json:"name"`
	DeezerID string       `json:"deezer_id,omitempty"`
	MBID     string       `json:"mbid,omitempty"`
	Related  []relatedRef `json:"related,omitempty"`
}

type libraryRef struct {
	ID      uuid.UUID `json:"id"`
	Title   string    `json:"title"`
	Artists []string  `json:"artists"`
}

type CandidatesPayload struct {
	UserID  uuid.UUID    `json:"user_id"`
	Tracks  []seedTrack  `json:"tracks"`
	Artists []seedArtist `json:"artists"`
	Library []libraryRef `json:"library"`
}

func CandidatesKey(userID uuid.UUID) string { return "candidates:" + userID.String() }

func (s *Store) EnqueueCandidates(ctx context.Context, userID uuid.UUID, now time.Time) (bool, error) {
	lib, err := s.MixCandidates(ctx, userID)
	if err != nil {
		return false, err
	}
	signals, err := s.Signals(ctx, userID, now)
	if err != nil {
		return false, err
	}
	emb, err := s.LoadEmbeddings(ctx)
	if err != nil {
		return false, err
	}
	names, _, err := s.libraryNames(ctx)
	if err != nil {
		return false, err
	}
	libMap := make(map[uuid.UUID]MixTrack, len(lib))
	for _, m := range lib {
		libMap[m.ID] = m
	}
	h := fnv.New64a()
	_, _ = h.Write(userID[:])
	taste := BuildTaste(signals, libMap, emb, h.Sum64())

	videos := map[uuid.UUID]string{}
	rows, err := s.pool.Query(ctx, `select distinct on (track_id) track_id, external_id from track_sources
		where status = 'selected' and provider in ('ytmusic', 'youtube') order by track_id, provider = 'ytmusic' desc`)
	if err != nil {
		return false, err
	}
	for rows.Next() {
		var id uuid.UUID
		var vid string
		if err := rows.Scan(&id, &vid); err != nil {
			rows.Close()
			return false, err
		}
		videos[id] = vid
	}
	rows.Close()

	p := CandidatesPayload{UserID: userID}
	picked := map[uuid.UUID]bool{}
	add := func(id uuid.UUID) {
		if picked[id] || len(p.Tracks) >= SeedTracks || videos[id] == "" {
			return
		}
		picked[id] = true
		n := names[id]
		p.Tracks = append(p.Tracks, seedTrack{ID: id, Title: n.Title, Artists: n.Artists, VideoID: videos[id]})
	}
	var ours struct {
		TrackID *uuid.UUID `json:"track_id"`
	}
	var raw []byte
	if err := s.pool.QueryRow(ctx, `select value from app_settings where key = 'our_song'`).Scan(&raw); err == nil {
		if json.Unmarshal(raw, &ours) == nil && ours.TrackID != nil {
			add(*ours.TrackID)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	scored := make([]uuid.UUID, 0, len(signals))
	for id, sig := range signals {
		if sig.Score > 0 {
			scored = append(scored, id)
		}
	}
	sort.Slice(scored, func(i, j int) bool {
		a, b := signals[scored[i]].Score, signals[scored[j]].Score
		if a != b {
			return a > b
		}
		return scored[i].String() < scored[j].String()
	})
	groupTaken := map[int]int{}
	if len(taste.Groups) > 0 {
		for _, id := range scored {
			_, g := taste.TasteSim(emb.Get(id))
			if g < 0 || groupTaken[g] >= SeedsPerGroup || videos[id] == "" {
				continue
			}
			groupTaken[g]++
			add(id)
		}
	}
	for _, id := range scored {
		add(id)
	}

	type affinity struct {
		id  uuid.UUID
		aff float64
	}
	var top []affinity
	for id, a := range taste.Artists {
		top = append(top, affinity{id, a})
	}
	sort.Slice(top, func(i, j int) bool { return top[i].aff > top[j].aff })
	for _, a := range top {
		if len(p.Artists) >= SeedArtists {
			break
		}
		var sa seedArtist
		var deezer, mbid *string
		if err := s.pool.QueryRow(ctx, `select id, name, deezer_id, mbid from artists where id = $1`, a.id).
			Scan(&sa.ID, &sa.Name, &deezer, &mbid); err != nil {
			return false, err
		}
		sa.DeezerID, sa.MBID = deref(deezer), deref(mbid)
		rrows, err := s.pool.Query(ctx, `select name, deezer_id from artist_related where artist_id = $1 and deezer_id is not null
			order by rank limit $2`, a.id, RelatedPerSeed)
		if err != nil {
			return false, err
		}
		sa.Related, err = pgx.CollectRows(rrows, func(r pgx.CollectableRow) (relatedRef, error) {
			var x relatedRef
			return x, r.Scan(&x.Name, &x.DeezerID)
		})
		if err != nil {
			return false, err
		}
		p.Artists = append(p.Artists, sa)
	}
	for id, n := range names {
		p.Library = append(p.Library, libraryRef{ID: id, Title: n.Title, Artists: n.Artists})
	}
	if len(p.Tracks) == 0 && len(p.Artists) == 0 {
		return false, nil
	}
	_, added, err := enqueue(ctx, s.pool, JobSpec{Kind: KindFetchCandidates, Payload: p, DedupeKey: CandidatesKey(userID), Priority: PriorityBackground})
	return added, err
}

type candidateResult struct {
	Source     string     `json:"source"`
	Score      float64    `json:"score"`
	SeedTrack  *uuid.UUID `json:"seed_track"`
	SeedArtist string     `json:"seed_artist"`
	Title      string     `json:"title"`
	Artists    []struct {
		Name      string `json:"name"`
		YtmusicID string `json:"ytmusic_id,omitempty"`
	} `json:"artists"`
	VideoID    string     `json:"video_id"`
	DeezerID   string     `json:"deezer_id"`
	MBID       string     `json:"mbid"`
	Album      string     `json:"album"`
	DurationMs *int32     `json:"duration_ms"`
	ArtworkURL string     `json:"artwork_url"`
	Popularity *float64   `json:"popularity"`
	Key        string     `json:"key"`
	TrackID    *uuid.UUID `json:"track_id"`
}

type CandidatesStatus struct {
	RefreshedAt time.Time         `json:"refreshed_at"`
	Counts      map[string]int    `json:"counts"`
	Errors      map[string]string `json:"errors"`
	Total       int               `json:"total"`
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func completeCandidates(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p CandidatesPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r struct {
		Candidates []candidateResult `json:"candidates"`
		Errors     map[string]string `json:"errors"`
		Counts     map[string]int    `json:"counts"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	type merged struct {
		c       candidateResult
		sources map[string]candSource
	}
	byKey := map[string]*merged{}
	var order []string
	for _, c := range r.Candidates {
		if c.Key == "" || c.Title == "" || len(c.Key) > 300 {
			continue
		}
		m := byKey[c.Key]
		if m == nil {
			m = &merged{c: c, sources: map[string]candSource{}}
			byKey[c.Key] = m
			order = append(order, c.Key)
		} else {
			if m.c.VideoID == "" && c.VideoID != "" {
				m.c.VideoID, m.c.Artists = c.VideoID, c.Artists
			}
			for _, f := range []struct{ dst, src *string }{{&m.c.DeezerID, &c.DeezerID}, {&m.c.MBID, &c.MBID},
				{&m.c.Album, &c.Album}, {&m.c.ArtworkURL, &c.ArtworkURL}} {
				if *f.dst == "" {
					*f.dst = *f.src
				}
			}
			if m.c.DurationMs == nil {
				m.c.DurationMs = c.DurationMs
			}
			if c.Popularity != nil && (m.c.Popularity == nil || *c.Popularity > *m.c.Popularity) {
				m.c.Popularity = c.Popularity
			}
			if m.c.TrackID == nil {
				m.c.TrackID = c.TrackID
			}
		}
		if old, ok := m.sources[c.Source]; !ok || c.Score > old.Score {
			m.sources[c.Source] = candSource{Score: c.Score, SeedTrack: c.SeedTrack, SeedArtist: c.SeedArtist}
		}
	}
	known := map[string]uuid.UUID{}
	rows, err := tx.Query(ctx, `select key, track_id from rec_candidates where user_id = $1 and track_id is not null`, p.UserID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var k string
		var id uuid.UUID
		if err := rows.Scan(&k, &id); err != nil {
			rows.Close()
			return err
		}
		known[k] = id
	}
	rows.Close()
	if _, err := tx.Exec(ctx, `delete from rec_candidates where user_id = $1`, p.UserID); err != nil {
		return err
	}
	now := time.Now()
	for _, k := range order {
		m := byKey[k]
		c := m.c
		trackID := c.TrackID
		if trackID == nil {
			if id, ok := known[k]; ok {
				trackID = &id
			}
		}
		if trackID == nil && c.VideoID != "" {
			var id uuid.UUID
			err := tx.QueryRow(ctx, `select track_id from track_sources where external_id = $1 and status = 'selected'
				and provider in ('ytmusic', 'youtube') limit 1`, c.VideoID).Scan(&id)
			if err == nil {
				trackID = &id
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		if trackID != nil {
			var exists bool
			if err := tx.QueryRow(ctx, `select exists (select 1 from tracks where id = $1)`, *trackID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				trackID = nil
			}
		}
		artists, err := json.Marshal(c.Artists)
		if err != nil {
			return err
		}
		sources, err := json.Marshal(m.sources)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into rec_candidates (user_id, key, title, artists, track_id, video_id, deezer_id, mbid,
				album, duration_ms, artwork_url, sources, popularity, refreshed_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			p.UserID, k, c.Title, artists, trackID, nilIfEmpty(c.VideoID), nilIfEmpty(c.DeezerID), nilIfEmpty(c.MBID),
			nilIfEmpty(c.Album), c.DurationMs, nilIfEmpty(c.ArtworkURL), sources, c.Popularity, now); err != nil {
			return err
		}
	}
	status, err := json.Marshal(CandidatesStatus{RefreshedAt: now, Counts: r.Counts, Errors: r.Errors, Total: len(order)})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into user_settings (user_id, key, value) values ($1, 'recs.candidates', $2)
		on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`, p.UserID, status)
	return err
}

func (s *Store) CandidatesStatus(ctx context.Context, userID uuid.UUID) (*CandidatesStatus, error) {
	raw, err := s.UserSetting(ctx, userID, "recs.candidates")
	if err != nil || raw == nil {
		return nil, err
	}
	var st CandidatesStatus
	return &st, json.Unmarshal(raw, &st)
}

type ReleasesPayload struct {
	Since   string `json:"since"`
	Artists []struct {
		ID       uuid.UUID `json:"id"`
		Name     string    `json:"name"`
		DeezerID string    `json:"deezer_id"`
	} `json:"artists"`
}

const releasesCheckedKey = "recs.releases_checked_at"

func (s *Store) EnqueueReleases(ctx context.Context, users []uuid.UUID, now time.Time) (bool, error) {
	since := now.Add(-ReleasesFirstLook)
	var raw []byte
	if err := s.pool.QueryRow(ctx, `select value from app_settings where key = $1`, releasesCheckedKey).Scan(&raw); err == nil {
		var at time.Time
		if json.Unmarshal(raw, &at) == nil && at.After(since) {
			since = at.Add(-7 * 24 * time.Hour)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	var p ReleasesPayload
	p.Since = since.Format("2006-01-02")
	seen := map[uuid.UUID]bool{}
	for _, u := range users {
		ids, err := s.likedArtists(ctx, u, now, ReleaseArtists)
		if err != nil {
			return false, err
		}
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			var a struct {
				ID       uuid.UUID `json:"id"`
				Name     string    `json:"name"`
				DeezerID string    `json:"deezer_id"`
			}
			var deezer *string
			if err := s.pool.QueryRow(ctx, `select id, name, deezer_id from artists where id = $1`, id).Scan(&a.ID, &a.Name, &deezer); err != nil {
				return false, err
			}
			if deezer == nil {
				continue
			}
			a.DeezerID = *deezer
			p.Artists = append(p.Artists, a)
		}
	}
	if len(p.Artists) == 0 {
		return false, nil
	}
	_, added, err := enqueue(ctx, s.pool, JobSpec{Kind: KindFetchReleases, Payload: p, DedupeKey: "releases", Priority: PriorityBackground})
	return added, err
}

func (s *Store) likedArtists(ctx context.Context, userID uuid.UUID, now time.Time, n int) ([]uuid.UUID, error) {
	lib, err := s.MixCandidates(ctx, userID)
	if err != nil {
		return nil, err
	}
	signals, err := s.Signals(ctx, userID, now)
	if err != nil {
		return nil, err
	}
	libMap := make(map[uuid.UUID]MixTrack, len(lib))
	for _, m := range lib {
		libMap[m.ID] = m
	}
	taste := BuildTaste(signals, libMap, nil, 0)
	ids := make([]uuid.UUID, 0, len(taste.Artists))
	for id := range taste.Artists {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return taste.Artists[ids[i]] > taste.Artists[ids[j]] })
	if len(ids) > n {
		ids = ids[:n]
	}
	return ids, nil
}

type releaseResult struct {
	ArtistID    uuid.UUID       `json:"artist_id"`
	DeezerID    string          `json:"deezer_id"`
	Title       string          `json:"title"`
	Kind        string          `json:"kind"`
	ReleaseDate string          `json:"release_date"`
	ArtworkURL  string          `json:"artwork_url"`
	Tracks      json.RawMessage `json:"tracks"`
}

func completeReleases(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var r struct {
		Releases []releaseResult `json:"releases"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	for _, rel := range r.Releases {
		day, err := time.Parse("2006-01-02", rel.ReleaseDate)
		if err != nil || rel.DeezerID == "" || rel.Title == "" {
			continue
		}
		tracks := rel.Tracks
		if len(tracks) == 0 {
			tracks = json.RawMessage("[]")
		}
		if _, err := tx.Exec(ctx, `insert into releases (deezer_id, artist_id, title, kind, release_date, artwork_url, tracks)
			select $1, $2, $3, $4, $5, $6, $7 where exists (select 1 from artists where id = $2)
			on conflict (deezer_id) do update set title = excluded.title, kind = excluded.kind, artwork_url = excluded.artwork_url,
				tracks = excluded.tracks`,
			rel.DeezerID, rel.ArtistID, rel.Title, rel.Kind, day, nilIfEmpty(rel.ArtworkURL), []byte(tracks)); err != nil {
			return err
		}
	}
	at, err := json.Marshal(time.Now())
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into app_settings (key, value) values ($1, $2)
		on conflict (key) do update set value = excluded.value, updated_at = now()`, releasesCheckedKey, at)
	return err
}

func (s *Store) ReleasesCheckedAt(ctx context.Context) (time.Time, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `select value from app_settings where key = $1`, releasesCheckedKey).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	var at time.Time
	return at, json.Unmarshal(raw, &at)
}

type Release struct {
	ID          string          `json:"id"`
	ArtistID    uuid.UUID       `json:"artist_id"`
	Artist      string          `json:"artist"`
	Title       string          `json:"title"`
	Kind        string          `json:"kind"`
	ReleaseDate string          `json:"release_date"`
	ArtworkURL  *string         `json:"artwork_url"`
	Tracks      json.RawMessage `json:"tracks"`
	FoundAt     time.Time       `json:"found_at"`
}

const ReleaseWindow = 90 * 24 * time.Hour

func (s *Store) Releases(ctx context.Context, userID uuid.UUID, now time.Time) ([]Release, error) {
	rows, err := s.pool.Query(ctx, `with mine as (
			select track_id from likes where user_id = $1
			union select pi.track_id from playlist_items pi join playlists p on p.id = pi.playlist_id
				where p.kind = 'imported' and (p.recipient_id = $1 or (p.recipient_id is null and p.owner_id = $1))
			union select track_id from listening_events where user_id = $1 and event = 'complete'),
		names as (select distinct lower(a.name) as name from mine join track_artists ta on ta.track_id = mine.track_id
			join artists a on a.id = ta.artist_id)
		select r.deezer_id, r.artist_id, a.name, r.title, r.kind, to_char(r.release_date, 'YYYY-MM-DD'), r.artwork_url, r.tracks, r.found_at
		from releases r join artists a on a.id = r.artist_id
		where r.release_date >= $2 and lower(a.name) in (select name from names)
		  and not exists (select 1 from hidden_items h where h.user_id = $1 and h.item_type = 'artist' and h.item_id = r.artist_id)
		order by r.release_date desc, r.found_at desc limit 30`, userID, now.Add(-ReleaseWindow))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Release, error) {
		var x Release
		var tracks []byte
		err := r.Scan(&x.ID, &x.ArtistID, &x.Artist, &x.Title, &x.Kind, &x.ReleaseDate, &x.ArtworkURL, &tracks, &x.FoundAt)
		x.Tracks = tracks
		return x, err
	})
}

func (s *Store) ReleaseTracks(ctx context.Context, deezerID string) ([]uuid.UUID, error) {
	var artistID uuid.UUID
	var artistName, album string
	var artwork *string
	var raw []byte
	err := s.pool.QueryRow(ctx, `select r.artist_id, a.name, r.title, r.artwork_url, r.tracks from releases r
		join artists a on a.id = r.artist_id where r.deezer_id = $1`, deezerID).Scan(&artistID, &artistName, &album, &artwork, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	var tracks []struct {
		Title      string   `json:"title"`
		Artists    []string `json:"artists"`
		DurationMs *int32   `json:"duration_ms"`
	}
	if err := json.Unmarshal(raw, &tracks); err != nil {
		return nil, err
	}
	var ids []uuid.UUID
	for _, t := range tracks {
		c := &Cand{Title: t.Title, Artists: t.Artists, ArtistIDs: []uuid.UUID{artistID}, Album: album, DurationMs: t.DurationMs,
			ArtworkURL: deref(artwork)}
		if len(c.Artists) == 0 {
			c.Artists = []string{artistName}
		}
		id, err := s.addPendingTrack(ctx, c)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}
