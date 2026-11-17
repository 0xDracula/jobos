package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var DateKinds = map[string]bool{"birthday": true, "anniversary": true, "countdown": true, "plan": true, "other": true}

var Decorations = map[string]bool{"lanterns": true, "crescent": true, "string_flags": true, "hearts": true, "balloons": true, "tree": true}

var ErrUnknownRef = errors.New("playlist or person not found")

type ImportantDate struct {
	ID            uuid.UUID  `json:"id"`
	Kind          string     `json:"kind"`
	Label         string     `json:"label"`
	Date          string     `json:"date"`
	Time          *string    `json:"time"`
	Note          string     `json:"note"`
	Recurring     bool       `json:"recurring"`
	Surprise      bool       `json:"surprise"`
	UserID        *uuid.UUID `json:"user_id"`
	AuthorID      *uuid.UUID `json:"author_id"`
	PlaylistID    *uuid.UUID `json:"playlist_id"`
	Decorations   []string   `json:"decorations"`
	RemindMinutes *int       `json:"remind_minutes"`
	Placeholder   bool       `json:"placeholder"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

type DateInput struct {
	Kind          string     `json:"kind"`
	Label         string     `json:"label"`
	Date          string     `json:"date"`
	Time          *string    `json:"time"`
	Note          string     `json:"note"`
	Recurring     bool       `json:"recurring"`
	Surprise      bool       `json:"surprise"`
	UserID        *uuid.UUID `json:"user_id"`
	PlaylistID    *uuid.UUID `json:"playlist_id"`
	Decorations   []string   `json:"decorations"`
	RemindMinutes *int       `json:"remind_minutes"`
}

var clockRE = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func (in *DateInput) Validate() error {
	in.Label = strings.TrimSpace(in.Label)
	in.Note = strings.TrimSpace(in.Note)
	switch {
	case !DateKinds[in.Kind]:
		return errors.New("kind must be birthday, anniversary, countdown, plan or other")
	case in.Label == "" || utf8.RuneCountInString(in.Label) > 80:
		return errors.New("title of 1 to 80 characters")
	case utf8.RuneCountInString(in.Note) > 2000:
		return errors.New("note of 2000 characters at most")
	case in.RemindMinutes != nil && (*in.RemindMinutes < 0 || *in.RemindMinutes > 43200):
		return errors.New("reminder of 0 to 43200 minutes")
	case len(in.Decorations) > 6:
		return errors.New("6 decorations at most")
	}
	d, err := time.Parse("2006-01-02", in.Date)
	if err != nil || d.Year() < 1900 || d.Year() > 2200 {
		return errors.New("date must be YYYY-MM-DD")
	}
	if in.Time != nil {
		if t := strings.TrimSpace(*in.Time); t == "" {
			in.Time = nil
		} else if !clockRE.MatchString(t) {
			return errors.New("time must be HH:MM")
		} else {
			in.Time = &t
		}
	}
	seen := map[string]bool{}
	decorations := []string{}
	for _, d := range in.Decorations {
		if !Decorations[d] {
			return fmt.Errorf("unknown decoration %q", d)
		}
		if !seen[d] {
			seen[d] = true
			decorations = append(decorations, d)
		}
	}
	in.Decorations = decorations
	if in.Kind == "birthday" || in.Kind == "anniversary" {
		in.Recurring = true
	}
	if in.Kind != "birthday" {
		in.UserID = nil
	}
	return nil
}

const dateCols = `id, kind, label, to_char(date, 'YYYY-MM-DD'), to_char(time, 'HH24:MI'), note, recurring, surprise,
	user_id, author_id, playlist_id, decorations, remind_minutes, placeholder, created_at, updated_at`

func scanDate(row pgx.CollectableRow) (ImportantDate, error) {
	var d ImportantDate
	err := row.Scan(&d.ID, &d.Kind, &d.Label, &d.Date, &d.Time, &d.Note, &d.Recurring, &d.Surprise,
		&d.UserID, &d.AuthorID, &d.PlaylistID, &d.Decorations, &d.RemindMinutes, &d.Placeholder, &d.CreatedAt, &d.UpdatedAt)
	if d.Decorations == nil {
		d.Decorations = []string{}
	}
	return d, err
}

func (s *Store) ImportantDates(ctx context.Context, kinds []string, withPlaceholders bool) ([]ImportantDate, error) {
	rows, err := s.pool.Query(ctx, `select `+dateCols+` from important_dates
		where (coalesce(cardinality($1::text[]), 0) = 0 or kind = any($1)) and ($2 or not placeholder)
		order by date, time nulls first, created_at`, kinds, withPlaceholders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanDate)
}

func (s *Store) ImportantDate(ctx context.Context, id uuid.UUID) (ImportantDate, error) {
	rows, err := s.pool.Query(ctx, `select `+dateCols+` from important_dates where id = $1`, id)
	if err != nil {
		return ImportantDate{}, err
	}
	d, err := pgx.CollectExactlyOneRow(rows, scanDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

func (s *Store) InsertImportantDate(ctx context.Context, authorID *uuid.UUID, in DateInput, placeholder bool) (ImportantDate, error) {
	rows, err := s.pool.Query(ctx, `insert into important_dates (id, kind, label, date, time, note, recurring, surprise,
			user_id, author_id, playlist_id, decorations, remind_minutes, placeholder)
		values ($1, $2, $3, $4::date, $5::time, $6, $7, $8, $9, $10, $11, coalesce($12, '{}'::text[]), $13, $14) returning `+dateCols,
		newID(), in.Kind, in.Label, in.Date, in.Time, in.Note, in.Recurring, in.Surprise,
		in.UserID, authorID, in.PlaylistID, in.Decorations, in.RemindMinutes, placeholder)
	if err != nil {
		return ImportantDate{}, err
	}
	d, err := pgx.CollectExactlyOneRow(rows, scanDate)
	if isForeignKey(err) {
		return d, ErrUnknownRef
	}
	return d, err
}

func (s *Store) UpdateImportantDate(ctx context.Context, id uuid.UUID, in DateInput) (ImportantDate, error) {
	rows, err := s.pool.Query(ctx, `update important_dates set kind = $2, label = $3, date = $4::date, time = $5::time,
			note = $6, recurring = $7, surprise = $8, user_id = $9, playlist_id = $10, decorations = coalesce($11, '{}'::text[]),
			remind_minutes = $12, placeholder = false, updated_at = now()
		where id = $1 returning `+dateCols,
		id, in.Kind, in.Label, in.Date, in.Time, in.Note, in.Recurring, in.Surprise,
		in.UserID, in.PlaylistID, in.Decorations, in.RemindMinutes)
	if err != nil {
		return ImportantDate{}, err
	}
	d, err := pgx.CollectExactlyOneRow(rows, scanDate)
	if isForeignKey(err) {
		return d, ErrUnknownRef
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	return d, err
}

func (s *Store) DeleteImportantDate(ctx context.Context, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from important_dates where id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DatePlaceholdersLeft(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) filter (where placeholder)
			+ count(*) filter (where not placeholder and kind in ('birthday', 'anniversary') and playlist_id is null)
		from important_dates`).Scan(&n)
	return n, err
}

func (s *Store) MarkReminderSent(ctx context.Context, eventID string, occursOn time.Time, userID uuid.UUID) (bool, error) {
	tag, err := s.pool.Exec(ctx, `insert into calendar_reminders (event_id, occurs_on, user_id) values ($1, $2::date, $3)
		on conflict do nothing`, eventID, occursOn.Format("2006-01-02"), userID)
	return err == nil && tag.RowsAffected() == 1, err
}

type RecapNote struct {
	ID          uuid.UUID `json:"id"`
	AuthorID    uuid.UUID `json:"author_id"`
	Period      string    `json:"period"`
	StartsOn    string    `json:"starts_on"`
	Body        string    `json:"body"`
	Placeholder bool      `json:"placeholder"`
	UpdatedAt   time.Time `json:"updated_at"`
}

const maxRecapNoteRunes = 2000

func ValidRecapNote(body string) (string, error) {
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(body) > maxRecapNoteRunes {
		return "", fmt.Errorf("notes are %d characters at most", maxRecapNoteRunes)
	}
	return body, nil
}

const recapNoteCols = `id, author_id, period, to_char(starts_on, 'YYYY-MM-DD'), body, placeholder, updated_at`

func scanRecapNote(row pgx.CollectableRow) (RecapNote, error) {
	var n RecapNote
	return n, row.Scan(&n.ID, &n.AuthorID, &n.Period, &n.StartsOn, &n.Body, &n.Placeholder, &n.UpdatedAt)
}

func (s *Store) RecapNotes(ctx context.Context, period string, startsOn time.Time, withPlaceholders bool) ([]RecapNote, error) {
	rows, err := s.pool.Query(ctx, `select `+recapNoteCols+` from recap_notes
		where period = $1 and starts_on = $2::date and ($3 or not placeholder) order by created_at`,
		period, startsOn.Format("2006-01-02"), withPlaceholders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanRecapNote)
}

func (s *Store) AuthorRecapNotes(ctx context.Context, authorID uuid.UUID, withPlaceholders bool) ([]RecapNote, error) {
	rows, err := s.pool.Query(ctx, `select `+recapNoteCols+` from recap_notes
		where author_id = $1 and ($2 or not placeholder) order by starts_on desc, period`, authorID, withPlaceholders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanRecapNote)
}

func (s *Store) SetRecapNote(ctx context.Context, authorID uuid.UUID, period string, startsOn time.Time, body string) (*RecapNote, error) {
	day := startsOn.Format("2006-01-02")
	if body == "" {
		_, err := s.pool.Exec(ctx, `delete from recap_notes where author_id = $1 and period = $2 and starts_on = $3::date`, authorID, period, day)
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `insert into recap_notes (id, author_id, period, starts_on, body) values ($1, $2, $3, $4::date, $5)
		on conflict (author_id, period, starts_on) do update set body = excluded.body, placeholder = false, updated_at = now()
		returning `+recapNoteCols, newID(), authorID, period, day, body)
	if err != nil {
		return nil, err
	}
	n, err := pgx.CollectExactlyOneRow(rows, scanRecapNote)
	return &n, err
}

func (s *Store) SeedRecapNote(ctx context.Context, authorID uuid.UUID, period string, startsOn time.Time, body string, placeholder bool) error {
	_, err := s.pool.Exec(ctx, `insert into recap_notes (id, author_id, period, starts_on, body, placeholder)
		values ($1, $2, $3, $4::date, $5, $6) on conflict do nothing`, newID(), authorID, period, startsOn.Format("2006-01-02"), body, placeholder)
	return err
}

func (s *Store) RecapNotePlaceholders(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) from recap_notes where placeholder`).Scan(&n)
	return n, err
}

func (s *Store) MarkRecapOpened(ctx context.Context, userID uuid.UUID, period string, startsOn time.Time) error {
	_, err := s.pool.Exec(ctx, `insert into recap_views (user_id, period, starts_on) values ($1, $2, $3::date) on conflict do nothing`,
		userID, period, startsOn.Format("2006-01-02"))
	return err
}

func (s *Store) OpenedRecaps(ctx context.Context, userID uuid.UUID) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `select period || ':' || to_char(starts_on, 'YYYY-MM-DD') from recap_views where user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out, err
}
