package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const MaxSessionItems = 500

var (
	ErrSessionLive  = errors.New("another session is live")
	ErrSessionState = errors.New("not possible in this session's state")
)

type SessionItem struct {
	Key      string     `json:"key"`
	Position int        `json:"position"`
	TrackID  uuid.UUID  `json:"track_id"`
	AddedBy  *uuid.UUID `json:"added_by"`
	Note     string     `json:"note"`
	PlayedAt *time.Time `json:"played_at"`
	Track    *TrackView `json:"track,omitempty"`
}

type ListeningSession struct {
	ID          uuid.UUID     `json:"id"`
	Title       string        `json:"title"`
	CreatedBy   uuid.UUID     `json:"created_by"`
	Status      string        `json:"status"`
	ScheduledAt *time.Time    `json:"scheduled_at"`
	StartedAt   *time.Time    `json:"started_at"`
	EndedAt     *time.Time    `json:"ended_at"`
	CurrentKey  *string       `json:"current_key"`
	PositionMs  int64         `json:"position_ms"`
	TogetherMs  int64         `json:"together_ms"`
	Members     []uuid.UUID   `json:"members"`
	ItemCount   int           `json:"item_count"`
	PlayedCount int           `json:"played_count"`
	Covers      []string      `json:"covers"`
	CreatedAt   time.Time     `json:"created_at"`
	Items       []SessionItem `json:"items,omitempty"`
}

const sessionSQL = `select s.id, s.title, s.created_by, s.status, s.scheduled_at, s.started_at, s.ended_at,
		s.current_key, s.position_ms, s.together_ms, s.members, s.created_at,
		(select count(*) from listening_session_items i where i.session_id = s.id),
		(select count(*) from listening_session_items i where i.session_id = s.id and i.played_at is not null),
		(select coalesce(array_agg(c.u order by c.pos), '{}') from (
			select min(i.position) as pos, '/api/media/' || ma.sha256 || '.300.jpg' as u
			from listening_session_items i join tracks t on t.id = i.track_id left join albums al on al.id = t.album_id
			join media_assets ma on ma.id = coalesce(t.artwork_asset_id, al.artwork_asset_id)
			where i.session_id = s.id group by ma.sha256 order by pos limit 4) c)
	from listening_sessions s`

func scanSession(row pgx.Row) (*ListeningSession, error) {
	var s ListeningSession
	err := row.Scan(&s.ID, &s.Title, &s.CreatedBy, &s.Status, &s.ScheduledAt, &s.StartedAt, &s.EndedAt,
		&s.CurrentKey, &s.PositionMs, &s.TogetherMs, &s.Members, &s.CreatedAt, &s.ItemCount, &s.PlayedCount, &s.Covers)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &s, err
}

func (s *Store) ListeningSessions(ctx context.Context) ([]ListeningSession, error) {
	rows, err := s.pool.Query(ctx, `(`+sessionSQL+` where s.status <> 'ended')
		union all (`+sessionSQL+` where s.status = 'ended' order by s.ended_at desc limit 30)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ListeningSession{}
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sess)
	}
	return out, rows.Err()
}

func (s *Store) ListeningSessionByID(ctx context.Context, id uuid.UUID) (*ListeningSession, error) {
	sess, err := scanSession(s.pool.QueryRow(ctx, sessionSQL+` where s.id = $1`, id))
	if err != nil {
		return nil, err
	}
	if sess.Items, err = s.SessionItems(ctx, id); err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(sess.Items))
	for i, it := range sess.Items {
		ids[i] = it.TrackID
	}
	tracks, err := s.TracksByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]*TrackView, len(tracks))
	for i := range tracks {
		byID[tracks[i].ID] = &tracks[i]
	}
	for i := range sess.Items {
		sess.Items[i].Track = byID[sess.Items[i].TrackID]
	}
	return sess, nil
}

func (s *Store) SessionItems(ctx context.Context, id uuid.UUID) ([]SessionItem, error) {
	rows, err := s.pool.Query(ctx, `select key, position, track_id, added_by, note, played_at
		from listening_session_items where session_id = $1 order by position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SessionItem{}
	for rows.Next() {
		var it SessionItem
		if err := rows.Scan(&it.Key, &it.Position, &it.TrackID, &it.AddedBy, &it.Note, &it.PlayedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func SessionKey() string { return newID().String() }

func (s *Store) CreateListeningSession(ctx context.Context, by uuid.UUID, title string, scheduledAt *time.Time, trackIDs []uuid.UUID) (uuid.UUID, error) {
	if len(trackIDs) > MaxSessionItems {
		trackIDs = trackIDs[:MaxSessionItems]
	}
	id := newID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `insert into listening_sessions (id, title, created_by, scheduled_at) values ($1, $2, $3, $4)`,
		id, title, by, scheduledAt); err != nil {
		return uuid.Nil, err
	}
	if err := insertSessionItems(ctx, tx, id, by, trackIDs, 0); err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(ctx)
}

func insertSessionItems(ctx context.Context, tx pgx.Tx, id, by uuid.UUID, trackIDs []uuid.UUID, at int) error {
	for i, t := range trackIDs {
		if _, err := tx.Exec(ctx, `insert into listening_session_items (session_id, key, position, track_id, added_by)
			values ($1, $2, $3, $4, $5)`, id, SessionKey(), at+i, t, by); err != nil {
			return err
		}
	}
	return nil
}

func renumber(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	_, err := tx.Exec(ctx, `update listening_session_items i set position = r.n
		from (select key, row_number() over (order by position, key) - 1 as n from listening_session_items where session_id = $1) r
		where i.session_id = $1 and i.key = r.key and i.position <> r.n`, id)
	return err
}

func (s *Store) touchSession(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	tag, err := tx.Exec(ctx, `update listening_sessions set updated_at = now() where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) UpdateListeningSession(ctx context.Context, id uuid.UUID, title string, scheduledAt *time.Time) error {
	tag, err := s.pool.Exec(ctx, `update listening_sessions set title = $2, scheduled_at = $3,
		reminded_at = case when scheduled_at is distinct from $3 then null else reminded_at end, updated_at = now()
		where id = $1 and status <> 'ended'`, id, title, scheduledAt)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeleteListeningSession(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from listening_sessions where id = $1 and status <> 'live'`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrSessionState
	}
	return err
}

func (s *Store) AddSessionItems(ctx context.Context, id, by uuid.UUID, trackIDs []uuid.UUID, at int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from listening_session_items where session_id = $1`, id).Scan(&n); err != nil {
		return err
	}
	if n+len(trackIDs) > MaxSessionItems {
		return ErrSessionState
	}
	if at < 0 || at > n {
		at = n
	}
	if _, err := tx.Exec(ctx, `update listening_session_items set position = position + $3 where session_id = $1 and position >= $2`,
		id, at, len(trackIDs)); err != nil {
		return err
	}
	if err := insertSessionItems(ctx, tx, id, by, trackIDs, at); err != nil {
		return err
	}
	if err := s.touchSession(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RemoveSessionItem(ctx context.Context, id uuid.UUID, key string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `delete from listening_session_items where session_id = $1 and key = $2`, id, key)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := renumber(ctx, tx, id); err != nil {
		return err
	}
	if err := s.touchSession(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) OrderSessionItems(ctx context.Context, id uuid.UUID, keys []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from listening_session_items where session_id = $1`, id).Scan(&n); err != nil {
		return err
	}
	seen := make(map[string]bool, len(keys))
	for _, k := range keys {
		seen[k] = true
	}
	if len(keys) != n || len(seen) != n {
		return ErrNotPermutation
	}
	tag, err := tx.Exec(ctx, `update listening_session_items i set position = k.n - 1
		from unnest($2::text[]) with ordinality as k(key, n) where i.session_id = $1 and i.key = k.key`, id, keys)
	if err != nil {
		return err
	}
	if int(tag.RowsAffected()) != n {
		return ErrNotPermutation
	}
	if err := s.touchSession(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) SetSessionItemNote(ctx context.Context, id uuid.UUID, key, note string) error {
	tag, err := s.pool.Exec(ctx, `update listening_session_items set note = $3 where session_id = $1 and key = $2`, id, key, note)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) SyncSessionItems(ctx context.Context, id uuid.UUID, items []SessionItem) error {
	keys := make([]string, len(items))
	pos := make([]int32, len(items))
	tracks := make([]uuid.UUID, len(items))
	added := make([]*uuid.UUID, len(items))
	for i, it := range items {
		keys[i], pos[i], tracks[i], added[i] = it.Key, int32(i), it.TrackID, it.AddedBy
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `delete from listening_session_items where session_id = $1 and not (key = any($2::text[]))`, id, keys); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into listening_session_items (session_id, key, position, track_id, added_by)
		select $1, k, p, t, a from unnest($2::text[], $3::int[], $4::uuid[], $5::uuid[]) as x(k, p, t, a)
		on conflict (session_id, key) do update set position = excluded.position`, id, keys, pos, tracks, added); err != nil {
		return err
	}
	if err := s.touchSession(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) StartSession(ctx context.Context, id uuid.UUID, endIdle *uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if endIdle != nil {
		if _, err := tx.Exec(ctx, `update listening_sessions set status = 'ended', ended_at = now(), updated_at = now()
			where id = $1 and status = 'live'`, *endIdle); err != nil {
			return err
		}
	}
	tag, err := tx.Exec(ctx, `update listening_sessions set status = 'live', started_at = coalesce(started_at, now()),
		updated_at = now() where id = $1 and status = 'planned'`, id)
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return ErrSessionLive
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrSessionState
	}
	return tx.Commit(ctx)
}

func (s *Store) SaveSessionLive(ctx context.Context, id uuid.UUID, currentKey string, positionMs, togetherMs int64, members []uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `update listening_sessions set current_key = nullif($2, ''), position_ms = $3, together_ms = $4,
		members = (select coalesce(array_agg(distinct m), '{}') from unnest(members || $5::uuid[]) m), updated_at = now()
		where id = $1 and status = 'live'`, id, currentKey, positionMs, togetherMs, members)
	return err
}

func (s *Store) MarkSessionItemPlayed(ctx context.Context, id uuid.UUID, key string) error {
	_, err := s.pool.Exec(ctx, `update listening_session_items set played_at = coalesce(played_at, now())
		where session_id = $1 and key = $2`, id, key)
	return err
}

func (s *Store) EndSession(ctx context.Context, id uuid.UUID, positionMs, togetherMs int64) error {
	_, err := s.pool.Exec(ctx, `update listening_sessions set status = 'ended', ended_at = now(), position_ms = $2,
		together_ms = $3, updated_at = now() where id = $1 and status = 'live'`, id, positionMs, togetherMs)
	return err
}

func (s *Store) LiveSession(ctx context.Context) (*ListeningSession, error) {
	var id uuid.UUID
	if err := s.pool.QueryRow(ctx, `select id from listening_sessions where status = 'live'`).Scan(&id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s.ListeningSessionByID(ctx, id)
}

func (s *Store) CopySession(ctx context.Context, id, by uuid.UUID) (uuid.UUID, error) {
	src, err := scanSession(s.pool.QueryRow(ctx, sessionSQL+` where s.id = $1`, id))
	if err != nil {
		return uuid.Nil, err
	}
	items, err := s.SessionItems(ctx, id)
	if err != nil {
		return uuid.Nil, err
	}
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.TrackID
	}
	return s.CreateListeningSession(ctx, by, src.Title, nil, ids)
}

func (s *Store) PlannedSessionsBetween(ctx context.Context, from, to time.Time) ([]ListeningSession, error) {
	rows, err := s.pool.Query(ctx, sessionSQL+` where s.status = 'planned' and s.scheduled_at >= $1 and s.scheduled_at < $2
		order by s.scheduled_at`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ListeningSession{}
	for rows.Next() {
		sess, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sess)
	}
	return out, rows.Err()
}

func (s *Store) DueSessionReminders(ctx context.Context, now, until time.Time) ([]ListeningSession, error) {
	rows, err := s.pool.Query(ctx, `update listening_sessions set reminded_at = now()
		where status = 'planned' and reminded_at is null and scheduled_at > $1 and scheduled_at <= $2
		returning id, title, created_by, scheduled_at`, now, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ListeningSession{}
	for rows.Next() {
		var sess ListeningSession
		if err := rows.Scan(&sess.ID, &sess.Title, &sess.CreatedBy, &sess.ScheduledAt); err != nil {
			return nil, err
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}
