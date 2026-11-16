package store

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	maxRecentSearches = 20
	maxSearchRunes    = 200
)

func (s *Store) RecentSearches(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `select query from recent_searches where user_id = $1 order by searched_at desc limit $2`, userID, maxRecentSearches)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (s *Store) AddRecentSearch(ctx context.Context, userID uuid.UUID, q string) error {
	q = strings.TrimSpace(q)
	if q == "" || utf8.RuneCountInString(q) > maxSearchRunes {
		return nil
	}
	if _, err := s.pool.Exec(ctx, `insert into recent_searches (user_id, query) values ($1, $2)
		on conflict (user_id, query) do update set searched_at = now()`, userID, q); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx, `delete from recent_searches where user_id = $1 and query not in
		(select query from recent_searches where user_id = $1 order by searched_at desc limit $2)`, userID, maxRecentSearches)
	return err
}

func (s *Store) DeleteRecentSearch(ctx context.Context, userID uuid.UUID, q string) error {
	if q == "" {
		_, err := s.pool.Exec(ctx, `delete from recent_searches where user_id = $1`, userID)
		return err
	}
	_, err := s.pool.Exec(ctx, `delete from recent_searches where user_id = $1 and query = $2`, userID, q)
	return err
}

type ReviewItem struct {
	Track     TrackView  `json:"track"`
	Score     *float32   `json:"score"`
	Check     *string    `json:"check"`
	CheckedAt *time.Time `json:"checked_at"`
	Playlists []string   `json:"playlists"`
}

type ReviewCounts struct {
	Auto      int `json:"auto"`
	Correct   int `json:"correct"`
	Wrong     int `json:"wrong"`
	Review    int `json:"review"`
	Unmatched int `json:"unmatched"`
	Chosen    int `json:"chosen"`
	Pending   int `json:"pending"`
}

var ReviewLists = map[string]string{
	"review":    `t.match_status = 'review'`,
	"unmatched": `t.match_status = 'unmatched'`,
	"unchecked": `t.match_status in ('matched', 'review') and mc.track_id is null`,
	"checked":   `mc.track_id is not null`,
	"chosen":    `t.match_status = 'chosen' and not exists (select 1 from track_sources u where u.track_id = t.id and u.provider = 'upload')`,
	"all":       `t.match_status in ('matched', 'review')`,
}

func (s *Store) ReviewList(ctx context.Context, list string, playlistID *uuid.UUID, limit int) ([]ReviewItem, error) {
	where, ok := ReviewLists[list]
	if !ok {
		return nil, ErrNotFound
	}
	args := []any{limit}
	if playlistID != nil {
		where += ` and exists (select 1 from playlist_items pi where pi.track_id = t.id and pi.playlist_id = $2)`
		args = append(args, *playlistID)
	}
	rows, err := s.pool.Query(ctx, `select t.id, (select ts.match_score from track_sources ts where ts.track_id = t.id and ts.status = 'selected' limit 1),
			mc.verdict, mc.checked_at,
			coalesce((select array_agg(p.name order by p.name) from playlist_items pi join playlists p on p.id = pi.playlist_id where pi.track_id = t.id), '{}')
		from tracks t left join match_checks mc on mc.track_id = t.id
		where `+where+` order by t.updated_at desc limit $1`, args...)
	if err != nil {
		return nil, err
	}
	type row struct {
		id        uuid.UUID
		score     *float32
		check     *string
		checkedAt *time.Time
		playlists []string
	}
	raw, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		return x, r.Scan(&x.id, &x.score, &x.check, &x.checkedAt, &x.playlists)
	})
	if err != nil {
		return nil, err
	}
	out := make([]ReviewItem, len(raw))
	for i, r := range raw {
		out[i] = ReviewItem{Score: r.score, Check: r.check, CheckedAt: r.checkedAt, Playlists: r.playlists}
	}
	return out, s.attachTracks(ctx, len(raw), func(i int) uuid.UUID { return raw[i].id }, func(i int, v *TrackView) {
		if v != nil {
			out[i].Track = *v
		}
	})
}

func (s *Store) ReviewCounts(ctx context.Context, playlistID *uuid.UUID) (ReviewCounts, error) {
	var c ReviewCounts
	filter := ""
	args := []any{}
	if playlistID != nil {
		filter = ` where exists (select 1 from playlist_items pi where pi.track_id = t.id and pi.playlist_id = $1)`
		args = append(args, *playlistID)
	}
	err := s.pool.QueryRow(ctx, `select
			count(*) filter (where t.match_status in ('matched', 'review')),
			count(*) filter (where t.match_status in ('matched', 'review') and mc.verdict = 'correct'),
			count(*) filter (where mc.verdict = 'wrong'),
			count(*) filter (where t.match_status = 'review'),
			count(*) filter (where t.match_status = 'unmatched'),
			count(*) filter (where t.match_status = 'chosen' and not exists (select 1 from track_sources u where u.track_id = t.id and u.provider = 'upload')),
			count(*) filter (where t.match_status = 'pending')
		from tracks t left join match_checks mc on mc.track_id = t.id`+filter, args...).
		Scan(&c.Auto, &c.Correct, &c.Wrong, &c.Review, &c.Unmatched, &c.Chosen, &c.Pending)
	return c, err
}

func (s *Store) SetMatchCheck(ctx context.Context, trackID, userID uuid.UUID, verdict string) error {
	if verdict == "" {
		_, err := s.pool.Exec(ctx, `delete from match_checks where track_id = $1`, trackID)
		return err
	}
	if verdict != "correct" && verdict != "wrong" {
		return errors.New("verdict must be correct or wrong")
	}
	_, err := s.pool.Exec(ctx, `insert into match_checks (track_id, user_id, verdict) values ($1, $2, $3)
		on conflict (track_id) do update set user_id = excluded.user_id, verdict = excluded.verdict, checked_at = now()`, trackID, userID, verdict)
	return err
}

func (s *Store) SetLyrics(ctx context.Context, trackID uuid.UUID, synced, plain string, instrumental bool) error {
	synced, plain = strings.TrimSpace(synced), strings.TrimSpace(plain)
	if synced != "" {
		if _, err := ParseLRC(synced); err != nil {
			return err
		}
	}
	nullable := func(v string) *string {
		if v == "" {
			return nil
		}
		return &v
	}
	_, err := s.pool.Exec(ctx, `insert into lyrics (track_id, synced_lrc, plain, source, instrumental) values ($1, $2, $3, 'manual', $4)
		on conflict (track_id) do update set synced_lrc = excluded.synced_lrc, plain = excluded.plain, source = 'manual',
			instrumental = excluded.instrumental, updated_at = now()`, trackID, nullable(synced), nullable(plain), instrumental && synced == "" && plain == "")
	return err
}

func (s *Store) SyncedLRC(ctx context.Context, trackID uuid.UUID) (string, error) {
	var lrc *string
	err := s.pool.QueryRow(ctx, `select synced_lrc from lyrics where track_id = $1`, trackID).Scan(&lrc)
	if errors.Is(err, pgx.ErrNoRows) || lrc == nil {
		return "", nil
	}
	return *lrc, err
}

type NowPlaying struct {
	UserID     uuid.UUID `json:"user_id"`
	DeviceName string    `json:"device_name"`
	TrackID    uuid.UUID `json:"track_id"`
	PositionMs int32     `json:"position_ms"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (s *Store) ListeningNow(ctx context.Context) (map[uuid.UUID]NowPlaying, error) {
	rows, err := s.pool.Query(ctx, `select distinct on (p.user_id) p.user_id, d.name, p.track_id, p.position_ms, p.updated_at
		from playback_states p join devices d on d.id = p.device_id
		where p.playing and p.track_id is not null and p.updated_at > now() - interval '1 minute'
		order by p.user_id, p.updated_at desc`)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (NowPlaying, error) {
		var n NowPlaying
		return n, r.Scan(&n.UserID, &n.DeviceName, &n.TrackID, &n.PositionMs, &n.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]NowPlaying, len(list))
	for _, n := range list {
		out[n.UserID] = n
	}
	return out, nil
}
