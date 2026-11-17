package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Window struct {
	From *time.Time
	To   *time.Time
}

const windowSQL = `($2::timestamptz is null or e.created_at >= $2) and ($3::timestamptz is null or e.created_at < $3)`

type ListeningTotals struct {
	Minutes int `json:"minutes"`
	Plays   int `json:"plays"`
	Songs   int `json:"songs"`
	Days    int `json:"days"`
}

func (s *Store) ListeningTotals(ctx context.Context, userID uuid.UUID, w Window, tz string) (ListeningTotals, error) {
	var t ListeningTotals
	err := s.pool.QueryRow(ctx, `select count(*) filter (where e.event = 'progress'),
			count(*) filter (where e.event = 'start'),
			count(distinct e.track_id) filter (where e.event = 'start'),
			count(distinct (e.created_at at time zone $4)::date)
		from listening_events e
		where e.user_id = $1 and e.event in ('start', 'progress') and `+windowSQL, userID, w.From, w.To, tz).
		Scan(&t.Minutes, &t.Plays, &t.Songs, &t.Days)
	return t, err
}

func (s *Store) TopTracks(ctx context.Context, userID uuid.UUID, w Window, limit int) ([]PlayedTrack, error) {
	rows, err := s.pool.Query(ctx, `select e.track_id, count(*) from listening_events e
		where e.user_id = $1 and e.event = 'start' and `+windowSQL+`
		group by e.track_id order by count(*) desc, max(e.created_at) desc limit $4`, userID, w.From, w.To, limit)
	if err != nil {
		return nil, err
	}
	return s.playedTracks(ctx, rows)
}

func (s *Store) playedTracks(ctx context.Context, rows pgx.Rows) ([]PlayedTrack, error) {
	type count struct {
		id    uuid.UUID
		plays int
	}
	counts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (count, error) {
		var c count
		return c, row.Scan(&c.id, &c.plays)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(counts))
	for i, c := range counts {
		ids[i] = c.id
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]PlayedTrack, 0, len(counts))
	for _, c := range counts {
		if v, ok := views[c.id]; ok {
			out = append(out, PlayedTrack{TrackView: v, Plays: c.plays})
		}
	}
	return out, nil
}

type ArtistPlays struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	ImageURL *string   `json:"image_url"`
	Plays    int       `json:"plays"`
}

func (s *Store) TopArtists(ctx context.Context, userID uuid.UUID, w Window, limit int) ([]ArtistPlays, error) {
	rows, err := s.pool.Query(ctx, `select a.id, a.name, `+imageURLSQL("img")+`, count(*)
		from listening_events e
		join track_artists ta on ta.track_id = e.track_id
		join artists a on a.id = ta.artist_id
		left join media_assets img on img.id = a.image_asset_id
		where e.user_id = $1 and e.event = 'start' and `+windowSQL+`
		group by a.id, img.sha256, img.mime order by count(*) desc, a.name limit $4`, userID, w.From, w.To, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ArtistPlays, error) {
		var a ArtistPlays
		return a, row.Scan(&a.ID, &a.Name, &a.ImageURL, &a.Plays)
	})
}

type TagWeight struct {
	Name   string  `json:"name"`
	Weight float64 `json:"weight"`
}

func (s *Store) TopTags(ctx context.Context, userID uuid.UUID, w Window, limit int) ([]TagWeight, error) {
	rows, err := s.pool.Query(ctx, `with plays as (
			select e.track_id, count(*) as n from listening_events e
			where e.user_id = $1 and e.event = 'start' and `+windowSQL+` group by e.track_id
		), tagged as (
			select p.track_id, p.n, x.tag_id, max(x.weight) as weight from plays p
			join lateral (
				select tt.tag_id, tt.weight from track_tags tt where tt.track_id = p.track_id
				union all
				select at.tag_id, at.weight from track_artists ta join artist_tags at on at.artist_id = ta.artist_id
				where ta.track_id = p.track_id
			) x on true
			group by p.track_id, p.n, x.tag_id
		)
		select t.name, sum(tg.n * tg.weight)::float8 as w from tagged tg join tags t on t.id = tg.tag_id
		group by t.name order by w desc, t.name limit $4`, userID, w.From, w.To, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (TagWeight, error) {
		var t TagWeight
		return t, row.Scan(&t.Name, &t.Weight)
	})
}

func (s *Store) HourMinutes(ctx context.Context, userID uuid.UUID, w Window, tz string) ([24]int, error) {
	var out [24]int
	rows, err := s.pool.Query(ctx, `select extract(hour from e.created_at at time zone $4)::int, count(*)
		from listening_events e where e.user_id = $1 and e.event = 'progress' and `+windowSQL+` group by 1`,
		userID, w.From, w.To, tz)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var h, n int
		if err := rows.Scan(&h, &n); err != nil {
			return out, err
		}
		if h >= 0 && h < 24 {
			out[h] = n
		}
	}
	return out, rows.Err()
}

func (s *Store) ListeningDays(ctx context.Context, userID uuid.UUID, to *time.Time, tz string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `select distinct to_char((e.created_at at time zone $3)::date, 'YYYY-MM-DD') as d
		from listening_events e where e.user_id = $1 and e.event in ('start', 'progress')
			and ($2::timestamptz is null or e.created_at < $2)
		order by d`, userID, to, tz)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (s *Store) TogetherMinutes(ctx context.Context, a, b uuid.UUID, w Window) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) from listening_events e
		where e.user_id = $1 and e.event = 'progress' and e.context->>'id' = 'together' and `+windowSQL+`
		and exists (select 1 from listening_events o where o.user_id = $4 and o.event = 'progress'
			and o.context->>'id' = 'together'
			and o.created_at between e.created_at - interval '60 seconds' and e.created_at + interval '60 seconds')`,
		a, w.From, w.To, b).Scan(&n)
	return n, err
}

func (s *Store) BothLiked(ctx context.Context, a, b uuid.UUID, w Window, limit int) ([]TrackView, int, error) {
	rows, err := s.pool.Query(ctx, `select la.track_id, count(*) over () from likes la
		join likes lb on lb.track_id = la.track_id and lb.user_id = $4
		where la.user_id = $1
			and ($2::timestamptz is null or greatest(la.created_at, lb.created_at) >= $2)
			and ($3::timestamptz is null or greatest(la.created_at, lb.created_at) < $3)
		order by greatest(la.created_at, lb.created_at) desc limit $5`, a, w.From, w.To, b, limit)
	if err != nil {
		return nil, 0, err
	}
	total := 0
	ids, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (uuid.UUID, error) {
		var id uuid.UUID
		return id, row.Scan(&id, &total)
	})
	if err != nil {
		return nil, 0, err
	}
	views, err := s.TracksByID(ctx, ids)
	return views, total, err
}

type TasteProfile struct {
	Artists map[string]float64
	Tags    map[string]float64
}

func (s *Store) TasteProfile(ctx context.Context, userID uuid.UUID) (TasteProfile, error) {
	p := TasteProfile{Artists: map[string]float64{}, Tags: map[string]float64{}}
	const songs = `with songs as (
			select track_id, sum(w) as w from (
				select e.track_id, 1.0::float8 as w from listening_events e where e.user_id = $1 and e.event = 'start'
				union all
				select l.track_id, 3.0::float8 from likes l where l.user_id = $1
			) x group by track_id
		)`
	rows, err := s.pool.Query(ctx, songs+` select ta.artist_id::text, sum(s.w)::float8 from songs s
		join track_artists ta on ta.track_id = s.track_id group by ta.artist_id`, userID)
	if err != nil {
		return p, err
	}
	if err := collectWeights(rows, p.Artists); err != nil {
		return p, err
	}
	rows, err = s.pool.Query(ctx, songs+`, tagged as (
			select s.track_id, s.w, x.tag_id, max(x.weight) as weight from songs s
			join lateral (
				select tt.tag_id, tt.weight from track_tags tt where tt.track_id = s.track_id
				union all
				select at.tag_id, at.weight from track_artists ta join artist_tags at on at.artist_id = ta.artist_id
				where ta.track_id = s.track_id
			) x on true group by s.track_id, s.w, x.tag_id
		)
		select t.name, sum(tg.w * tg.weight)::float8 from tagged tg join tags t on t.id = tg.tag_id group by t.name`, userID)
	if err != nil {
		return p, err
	}
	return p, collectWeights(rows, p.Tags)
}

func collectWeights(rows pgx.Rows, into map[string]float64) error {
	defer rows.Close()
	for rows.Next() {
		var k string
		var v float64
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		into[k] = v
	}
	return rows.Err()
}

type SharedTrack struct {
	TrackView
	Plays map[string]int `json:"plays"`
}

func (s *Store) SharedTopTracks(ctx context.Context, a, b uuid.UUID, w Window, limit int) ([]SharedTrack, error) {
	rows, err := s.pool.Query(ctx, `select e.track_id,
			count(*) filter (where e.user_id = $1), count(*) filter (where e.user_id = $4)
		from listening_events e
		where e.user_id in ($1, $4) and e.event = 'start' and `+windowSQL+`
		group by e.track_id
		having count(*) filter (where e.user_id = $1) > 0 and count(*) filter (where e.user_id = $4) > 0
		order by count(*) desc, max(e.created_at) desc limit $5`, a, w.From, w.To, b, limit)
	if err != nil {
		return nil, err
	}
	type count struct {
		id     uuid.UUID
		pa, pb int
	}
	counts, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (count, error) {
		var c count
		return c, row.Scan(&c.id, &c.pa, &c.pb)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(counts))
	for i, c := range counts {
		ids[i] = c.id
	}
	views, err := s.viewsByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]SharedTrack, 0, len(counts))
	for _, c := range counts {
		if v, ok := views[c.id]; ok {
			out = append(out, SharedTrack{TrackView: v, Plays: map[string]int{a.String(): c.pa, b.String(): c.pb}})
		}
	}
	return out, nil
}

func (s *Store) PlayCountsIn(ctx context.Context, trackID uuid.UUID, w Window) ([]PlayCount, error) {
	rows, err := s.pool.Query(ctx, `select u.id, count(e.id) from users u
		left join listening_events e on e.user_id = u.id and e.track_id = $1 and e.event = 'start'
			and ($2::timestamptz is null or e.created_at >= $2) and ($3::timestamptz is null or e.created_at < $3)
		group by u.id, u.created_at order by u.created_at`, trackID, w.From, w.To)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlayCount, error) {
		var c PlayCount
		return c, r.Scan(&c.UserID, &c.Plays)
	})
}

func (s *Store) FirstListen(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, `select min(created_at) from listening_events where user_id = $1`, userID).Scan(&at)
	return at, err
}

type DayActivity struct {
	UserID  uuid.UUID `json:"user_id"`
	Day     string    `json:"day"`
	Minutes int       `json:"minutes"`
	Plays   int       `json:"plays"`
	Skips   int       `json:"skips"`
}

func (s *Store) ActivityByDay(ctx context.Context, w Window, tz string) ([]DayActivity, error) {
	rows, err := s.pool.Query(ctx, `select e.user_id, to_char((e.created_at at time zone $1)::date, 'YYYY-MM-DD'),
			count(*) filter (where e.event = 'progress'), count(*) filter (where e.event = 'start'), count(*) filter (where e.event = 'skip')
		from listening_events e where e.event in ('progress', 'start', 'skip') and ($2::timestamptz is null or e.created_at >= $2)
			and ($3::timestamptz is null or e.created_at < $3)
		group by 1, 2 order by 2`, tz, w.From, w.To)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (DayActivity, error) {
		var d DayActivity
		return d, r.Scan(&d.UserID, &d.Day, &d.Minutes, &d.Plays, &d.Skips)
	})
}

func (s *Store) MostSkipped(ctx context.Context, userID uuid.UUID, w Window, limit int) ([]PlayedTrack, error) {
	rows, err := s.pool.Query(ctx, `select e.track_id, count(*) from listening_events e
		where e.user_id = $1 and e.event = 'skip' and `+windowSQL+`
		group by e.track_id order by count(*) desc, max(e.created_at) desc limit $4`, userID, w.From, w.To, limit)
	if err != nil {
		return nil, err
	}
	return s.playedTracks(ctx, rows)
}
