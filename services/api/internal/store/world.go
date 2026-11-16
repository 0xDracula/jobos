package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type RoomStats struct {
	ListeningSeconds int64      `json:"listening_seconds"`
	LikedSongs       int        `json:"liked_songs"`
	ActiveDays       int        `json:"active_days"`
	Since            *time.Time `json:"since"`
}

func (s *Store) RoomStats(ctx context.Context, userID uuid.UUID) (*RoomStats, error) {
	var st RoomStats
	err := s.pool.QueryRow(ctx, `select
			(select count(*) * 60 from listening_events where user_id = $1 and event = 'progress'),
			(select count(*) from likes where user_id = $1),
			(select count(distinct date(created_at)) from listening_events where user_id = $1),
			(select min(created_at) from listening_events where user_id = $1)`, userID).
		Scan(&st.ListeningSeconds, &st.LikedSongs, &st.ActiveDays, &st.Since)
	return &st, err
}

var HiddenSpots = map[string]bool{"moon": true, "drawer": true, "shooting_star": true, "pet_bed": true, "frame": true}

type HiddenNote struct {
	ID      uuid.UUID  `json:"id"`
	Spot    string     `json:"spot"`
	Found   bool       `json:"found"`
	FoundAt *time.Time `json:"found_at,omitempty"`
	Title   *string    `json:"title,omitempty"`
	Body    *string    `json:"body,omitempty"`
}

const visibleNotesSQL = `select n.id, n.spot, f.found_at, n.title, n.body
	from hidden_notes n
	left join found_notes f on f.note_id = n.id and f.user_id = $1
	where (n.for_user_id = $1 or (n.for_user_id is null and n.author_id is distinct from $1))
		and (n.unlock_at is null or n.unlock_at <= now())
		and (n.after_note_id is null or exists (select 1 from found_notes p where p.note_id = n.after_note_id and p.user_id = $1))`

func scanHiddenNote(row pgx.Row) (HiddenNote, error) {
	var n HiddenNote
	var title, body string
	if err := row.Scan(&n.ID, &n.Spot, &n.FoundAt, &title, &body); err != nil {
		return n, err
	}
	n.Found = n.FoundAt != nil
	if n.Found {
		n.Title, n.Body = &title, &body
	}
	return n, nil
}

func (s *Store) HiddenNotes(ctx context.Context, userID uuid.UUID) ([]HiddenNote, error) {
	rows, err := s.pool.Query(ctx, visibleNotesSQL+` order by n.created_at`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (HiddenNote, error) { return scanHiddenNote(row) })
}

func (s *Store) FindNote(ctx context.Context, userID, noteID uuid.UUID) (*HiddenNote, error) {
	n, err := scanHiddenNote(s.pool.QueryRow(ctx, visibleNotesSQL+` and n.id = $2`, userID, noteID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !n.Found {
		var at time.Time
		if err := s.pool.QueryRow(ctx, `insert into found_notes (user_id, note_id) values ($1, $2)
			on conflict (user_id, note_id) do update set found_at = found_notes.found_at returning found_at`, userID, noteID).Scan(&at); err != nil {
			return nil, err
		}
		return s.FindNote(ctx, userID, noteID)
	}
	return &n, nil
}

type NoteInput struct {
	Spot        string     `json:"spot"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	ForUserID   *uuid.UUID `json:"for_user_id"`
	UnlockAt    *time.Time `json:"unlock_at"`
	AfterNoteID *uuid.UUID `json:"after_note_id"`
}

func (n NoteInput) Validate() error {
	switch {
	case !HiddenSpots[n.Spot]:
		return fmt.Errorf("unknown spot %q", n.Spot)
	case strings.TrimSpace(n.Body) == "":
		return errors.New("body is required")
	case len(n.Body) > 20000 || len(n.Title) > 200:
		return errors.New("title of 200 and body of 20000 characters at most")
	}
	return nil
}

type AdminNote struct {
	NoteInput
	ID        uuid.UUID  `json:"id"`
	AuthorID  *uuid.UUID `json:"author_id"`
	CreatedAt time.Time  `json:"created_at"`
	FoundBy   int        `json:"found_by"`
}

func (s *Store) CreateNote(ctx context.Context, authorID uuid.UUID, in NoteInput) (uuid.UUID, error) {
	id := newID()
	_, err := s.pool.Exec(ctx, `insert into hidden_notes (id, spot, title, body, for_user_id, author_id, unlock_at, after_note_id)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`, id, in.Spot, strings.TrimSpace(in.Title), in.Body, in.ForUserID, authorID, in.UnlockAt, in.AfterNoteID)
	return id, err
}

func (s *Store) AdminNotes(ctx context.Context) ([]AdminNote, error) {
	rows, err := s.pool.Query(ctx, `select n.id, n.spot, n.title, n.body, n.for_user_id, n.unlock_at, n.after_note_id, n.author_id,
			n.created_at, (select count(*) from found_notes f where f.note_id = n.id)
		from hidden_notes n order by n.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (AdminNote, error) {
		var n AdminNote
		err := row.Scan(&n.ID, &n.Spot, &n.Title, &n.Body, &n.ForUserID, &n.UnlockAt, &n.AfterNoteID, &n.AuthorID, &n.CreatedAt, &n.FoundBy)
		return n, err
	})
}

func (s *Store) DeleteNote(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from hidden_notes where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type UserCity struct {
	UserID      uuid.UUID       `json:"user_id"`
	DisplayName string          `json:"display_name"`
	City        json.RawMessage `json:"city"`
}

func (s *Store) UserCities(ctx context.Context) ([]UserCity, error) {
	rows, err := s.pool.Query(ctx, `select u.id, u.display_name,
			coalesce((select value from user_settings where user_id = u.id and key = 'location.manual'),
				(select value from user_settings where user_id = u.id and key = 'location.detected'))
		from users u order by u.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (UserCity, error) {
		var c UserCity
		var city []byte
		err := row.Scan(&c.UserID, &c.DisplayName, &city)
		c.City = city
		return c, err
	})
}

func (s *Store) DeleteSetting(ctx context.Context, userID uuid.UUID, key string) error {
	_, err := s.pool.Exec(ctx, `delete from user_settings where user_id = $1 and key = $2`, userID, key)
	return err
}
