package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Mood struct {
	UserID    uuid.UUID `json:"user_id"`
	Mood      string    `json:"mood"`
	Note      string    `json:"note"`
	SetAt     time.Time `json:"set_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *Store) Moods(ctx context.Context) ([]Mood, error) {
	rows, err := s.pool.Query(ctx, `select user_id, mood, note, set_at, expires_at from moods where expires_at > now() and user_id in (select jobbos_people())`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Mood, error) {
		var m Mood
		return m, r.Scan(&m.UserID, &m.Mood, &m.Note, &m.SetAt, &m.ExpiresAt)
	})
}

func (s *Store) SetMood(ctx context.Context, userID uuid.UUID, mood, note string, until time.Time) (*Mood, error) {
	m := Mood{UserID: userID, Mood: mood, Note: note, ExpiresAt: until}
	err := s.pool.QueryRow(ctx, `insert into moods (user_id, mood, note, set_at, expires_at) values ($1, $2, $3, now(), $4)
		on conflict (user_id) do update set mood = excluded.mood, note = excluded.note, set_at = now(), expires_at = excluded.expires_at
		returning set_at`, userID, mood, note, until).Scan(&m.SetAt)
	return &m, err
}

func (s *Store) ClearMood(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from moods where user_id = $1`, userID)
	return err
}
