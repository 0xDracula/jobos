package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	maxLetterRunes = 20000
	maxLabelRunes  = 80
	maxTitleRunes  = 120
	maxPaperRunes  = 2000
	dateLayout     = "2006-01-02"
)

var (
	ErrLocked     = errors.New("locked")
	ErrMissingRef = errors.New("song, playlist or person not found")
	hhmm          = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
)

func missingRef(err error) error {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) && pgErr.SQLState() == "23503" {
		return ErrMissingRef
	}
	return err
}

const forViewer = `(%[1]s.author_id <> $1 and (%[1]s.recipient_id = $1 or %[1]s.recipient_id is null))`

func validDate(s string) bool {
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func dateString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(dateLayout)
	return &s
}

var LetterKinds = map[string]bool{"standard": true, "open_when": true, "time_locked": true}

type Letter struct {
	ID          uuid.UUID  `json:"id"`
	AuthorID    uuid.UUID  `json:"author_id"`
	RecipientID *uuid.UUID `json:"recipient_id"`
	Kind        string     `json:"kind"`
	Occasion    string     `json:"occasion"`
	Title       string     `json:"title"`
	Body        *string    `json:"body"`
	PlaylistID  *uuid.UUID `json:"playlist_id"`
	TrackID     *uuid.UUID `json:"track_id"`
	Track       *TrackView `json:"track,omitempty"`
	UnlockAt    *time.Time `json:"unlock_at"`
	UnlockDate  string     `json:"unlock_date,omitempty"`
	UnlockTime  string     `json:"unlock_time,omitempty"`
	Locked      bool       `json:"locked"`
	OpenedAt    *time.Time `json:"opened_at"`
	Status      string     `json:"status"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type LetterInput struct {
	Kind       string     `json:"kind"`
	Occasion   string     `json:"occasion"`
	Title      string     `json:"title"`
	Body       string     `json:"body"`
	PlaylistID *uuid.UUID `json:"playlist_id"`
	TrackID    *uuid.UUID `json:"track_id"`
	UnlockDate string     `json:"unlock_date"`
	UnlockTime string     `json:"unlock_time"`
	Status     string     `json:"status"`
	UnlockAt   *time.Time `json:"-"`
}

func (in *LetterInput) Validate() error {
	in.Occasion = strings.TrimSpace(in.Occasion)
	in.Title = strings.TrimSpace(in.Title)
	in.Body = strings.TrimRight(in.Body, " \n\t")
	if !LetterKinds[in.Kind] {
		return errors.New("kind must be standard, open_when or time_locked")
	}
	if in.Status == "" {
		in.Status = "published"
	}
	if in.Status != "draft" && in.Status != "published" {
		return errors.New("status must be draft or published")
	}
	if in.Kind == "open_when" && in.Occasion == "" {
		return errors.New("an open-when letter needs an occasion")
	}
	if utf8.RuneCountInString(in.Occasion) > maxLabelRunes {
		return fmt.Errorf("occasion of %d characters at most", maxLabelRunes)
	}
	if utf8.RuneCountInString(in.Title) > maxTitleRunes {
		return fmt.Errorf("title of %d characters at most", maxTitleRunes)
	}
	if utf8.RuneCountInString(in.Body) > maxLetterRunes {
		return fmt.Errorf("letters are %d characters at most", maxLetterRunes)
	}
	if in.Status == "published" && strings.TrimSpace(in.Body) == "" {
		return errors.New("a letter needs a body")
	}
	if in.Kind == "time_locked" {
		if in.UnlockTime == "" {
			in.UnlockTime = "00:00"
		}
		if !validDate(in.UnlockDate) || !hhmm.MatchString(in.UnlockTime) {
			return errors.New("a time-locked letter needs an unlock date (YYYY-MM-DD) and time (HH:MM)")
		}
	} else {
		in.UnlockDate, in.UnlockTime = "", ""
	}
	return nil
}

const letterSelect = `select l.id, l.author_id, l.recipient_id, l.kind, l.occasion, l.title, l.body, l.playlist_id,
	l.track_id, l.unlock_at, l.opened_at, l.status, l.placeholder, l.created_at, l.updated_at,
	coalesce(l.unlock_at > now(), false)
	from letters l`

var lettersVisible = `(l.author_id = $1 or (l.status = 'published' and ` + fmt.Sprintf(forViewer, "l") + `)) and (not l.placeholder or $2)`

func scanLetter(row pgx.Row, viewer uuid.UUID) (Letter, error) {
	var l Letter
	var body string
	if err := row.Scan(&l.ID, &l.AuthorID, &l.RecipientID, &l.Kind, &l.Occasion, &l.Title, &body, &l.PlaylistID,
		&l.TrackID, &l.UnlockAt, &l.OpenedAt, &l.Status, &l.Placeholder, &l.CreatedAt, &l.UpdatedAt, &l.Locked); err != nil {
		return l, err
	}
	if l.Locked && l.AuthorID != viewer {
		l.PlaylistID, l.TrackID = nil, nil
	} else {
		l.Body = &body
	}
	return l, nil
}

func (s *Store) letters(ctx context.Context, viewer uuid.UUID, where string, args ...any) ([]Letter, error) {
	rows, err := s.pool.Query(ctx, letterSelect+" where "+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Letter, error) { return scanLetter(row, viewer) })
	if err != nil {
		return nil, err
	}
	var withTrack []int
	for i := range out {
		if out[i].TrackID != nil {
			withTrack = append(withTrack, i)
		}
	}
	return out, s.attachTracks(ctx, len(withTrack), func(i int) uuid.UUID { return *out[withTrack[i]].TrackID },
		func(i int, v *TrackView) { out[withTrack[i]].Track = v })
}

func (s *Store) Letters(ctx context.Context, viewer uuid.UUID, placeholders bool) ([]Letter, error) {
	return s.letters(ctx, viewer, lettersVisible+` order by l.created_at desc, l.id desc limit 500`, viewer, placeholders)
}

func (s *Store) Letter(ctx context.Context, id, viewer uuid.UUID, placeholders bool) (Letter, error) {
	list, err := s.letters(ctx, viewer, lettersVisible+` and l.id = $3`, viewer, placeholders, id)
	if err != nil {
		return Letter{}, err
	}
	if len(list) == 0 {
		return Letter{}, ErrNotFound
	}
	return list[0], nil
}

func (s *Store) CreateLetter(ctx context.Context, authorID uuid.UUID, recipient *uuid.UUID, in LetterInput) (Letter, error) {
	id := newID()
	if _, err := s.pool.Exec(ctx, `insert into letters (id, author_id, recipient_id, kind, occasion, title, body, playlist_id,
			track_id, unlock_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		id, authorID, recipient, in.Kind, in.Occasion, in.Title, in.Body, in.PlaylistID, in.TrackID, in.UnlockAt, in.Status); err != nil {
		return Letter{}, missingRef(err)
	}
	return s.Letter(ctx, id, authorID, true)
}

func (s *Store) UpdateLetter(ctx context.Context, id, authorID uuid.UUID, in LetterInput) (l Letter, published bool, err error) {
	var was string
	err = s.pool.QueryRow(ctx, `update letters l set kind = $3, occasion = $4, title = $5, body = $6, playlist_id = $7,
			track_id = $8, unlock_notified_at = case when l.unlock_at is distinct from $9 then null else l.unlock_notified_at end,
			unlock_at = $9, status = $10, placeholder = false, updated_at = now()
		from (select id, status from letters where id = $1) old
		where l.id = old.id and l.author_id = $2 and l.kind <> 'welcome'
		returning old.status`,
		id, authorID, in.Kind, in.Occasion, in.Title, in.Body, in.PlaylistID, in.TrackID, in.UnlockAt, in.Status).Scan(&was)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, false, ErrNotFound
	}
	if err != nil {
		return l, false, missingRef(err)
	}
	l, err = s.Letter(ctx, id, authorID, true)
	return l, was == "draft" && in.Status == "published", err
}

func (s *Store) DeleteLetter(ctx context.Context, id, authorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from letters where id = $1 and author_id = $2`, id, authorID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) OpenLetter(ctx context.Context, id, viewer uuid.UUID) error {
	cond := `l.id = $2 and l.status = 'published' and ` + fmt.Sprintf(forViewer, "l")
	tag, err := s.pool.Exec(ctx, `update letters l set opened_at = coalesce(l.opened_at, now()), recipient_id = $1
		where `+cond+` and (l.unlock_at is null or l.unlock_at <= now())`, viewer, id)
	if err != nil || tag.RowsAffected() > 0 {
		return err
	}
	var locked bool
	err = s.pool.QueryRow(ctx, `select coalesce(l.unlock_at > now(), false) from letters l where `+cond, viewer, id).Scan(&locked)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNotFound
	case err != nil:
		return err
	case locked:
		return ErrLocked
	}
	return nil
}

func (s *Store) WelcomeLetter(ctx context.Context, viewer uuid.UUID, placeholders bool) (*Letter, error) {
	list, err := s.letters(ctx, viewer, `l.kind = 'welcome' and `+lettersVisible+`
		order by (l.author_id = $1), l.created_at desc limit 1`, viewer, placeholders)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func (s *Store) SetWelcomeLetter(ctx context.Context, authorID uuid.UUID, title, body string) (Letter, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `insert into letters (id, author_id, kind, title, body) values ($1, $2, 'welcome', $3, $4)
		on conflict (author_id) where kind = 'welcome'
		do update set title = excluded.title, body = excluded.body, placeholder = false, status = 'published', updated_at = now()
		returning id`, newID(), authorID, title, body).Scan(&id)
	if err != nil {
		return Letter{}, err
	}
	return s.Letter(ctx, id, authorID, true)
}

func (s *Store) DueLetterUnlocks(ctx context.Context) ([]Letter, error) {
	rows, err := s.pool.Query(ctx, `update letters set unlock_notified_at = now()
		where kind = 'time_locked' and status = 'published' and not placeholder
			and unlock_at <= now() and unlock_notified_at is null
		returning id, author_id, recipient_id, kind, occasion, title, unlock_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Letter, error) {
		var l Letter
		return l, row.Scan(&l.ID, &l.AuthorID, &l.RecipientID, &l.Kind, &l.Occasion, &l.Title, &l.UnlockAt)
	})
}

func (s *Store) LetterUnlocks(ctx context.Context, viewer uuid.UUID, placeholders bool, from, to time.Time) ([]Letter, error) {
	return s.letters(ctx, viewer, `l.kind = 'time_locked' and l.status = 'published' and `+lettersVisible+`
		and l.unlock_at >= $3 and l.unlock_at < $4 order by l.unlock_at`, viewer, placeholders, from, to)
}

var NoteKinds = map[string]bool{"daily": true, "morning": true, "night": true}

type Note struct {
	ID          uuid.UUID  `json:"id"`
	AuthorID    uuid.UUID  `json:"author_id"`
	RecipientID *uuid.UUID `json:"recipient_id"`
	Kind        string     `json:"kind"`
	Body        string     `json:"body"`
	TrackID     *uuid.UUID `json:"track_id"`
	Track       *TrackView `json:"track,omitempty"`
	AvailableOn *string    `json:"available_on"`
	OpenedAt    *time.Time `json:"opened_at"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type NoteEdit struct {
	Kind    string     `json:"kind"`
	Body    string     `json:"body"`
	TrackID *uuid.UUID `json:"track_id"`
}

func (in *NoteEdit) Validate() error {
	in.Body = strings.TrimSpace(in.Body)
	if !NoteKinds[in.Kind] {
		return errors.New("kind must be daily, morning or night")
	}
	if in.Body == "" || utf8.RuneCountInString(in.Body) > maxPaperRunes {
		return fmt.Errorf("a note of 1 to %d characters", maxPaperRunes)
	}
	return nil
}

const noteSelect = `select n.id, n.author_id, n.recipient_id, n.kind, n.body, n.track_id, n.available_on, n.opened_at,
	n.placeholder, n.created_at, n.updated_at from notes n`

func scanNote(row pgx.Row) (Note, error) {
	var n Note
	var on *time.Time
	err := row.Scan(&n.ID, &n.AuthorID, &n.RecipientID, &n.Kind, &n.Body, &n.TrackID, &on, &n.OpenedAt, &n.Placeholder, &n.CreatedAt, &n.UpdatedAt)
	n.AvailableOn = dateString(on)
	return n, err
}

func (s *Store) notes(ctx context.Context, where string, args ...any) ([]Note, error) {
	rows, err := s.pool.Query(ctx, noteSelect+" where "+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Note, error) { return scanNote(row) })
	if err != nil {
		return nil, err
	}
	var withTrack []int
	for i := range out {
		if out[i].TrackID != nil {
			withTrack = append(withTrack, i)
		}
	}
	return out, s.attachTracks(ctx, len(withTrack), func(i int) uuid.UUID { return *out[withTrack[i]].TrackID },
		func(i int, v *TrackView) { out[withTrack[i]].Track = v })
}

func (s *Store) note(ctx context.Context, id uuid.UUID) (Note, error) {
	list, err := s.notes(ctx, `n.id = $1`, id)
	if err != nil {
		return Note{}, err
	}
	if len(list) == 0 {
		return Note{}, ErrNotFound
	}
	return list[0], nil
}

var jarPool = `n.kind = 'daily' and n.available_on is null and ` + fmt.Sprintf(forViewer, "n") + ` and (not n.placeholder or $2)`

type Jar struct {
	Day     string `json:"day"`
	Today   *Note  `json:"today"`
	Waiting bool   `json:"waiting"`
	Left    int    `json:"left"`
	Opened  []Note `json:"opened"`
	NextAt  string `json:"next_at"`
}

func (s *Store) Jar(ctx context.Context, viewer uuid.UUID, day string, placeholders bool) (Jar, error) {
	j := Jar{Day: day}
	if err := s.pool.QueryRow(ctx, `select count(*) from notes n where `+jarPool, viewer, placeholders).Scan(&j.Left); err != nil {
		return j, err
	}
	opened, err := s.notes(ctx, `n.kind = 'daily' and n.recipient_id = $1 and n.available_on is not null
		order by n.available_on desc limit 200`, viewer)
	if err != nil {
		return j, err
	}
	j.Opened = opened
	if len(opened) > 0 && opened[0].AvailableOn != nil && *opened[0].AvailableOn == day {
		j.Today = &opened[0]
	}
	j.Waiting = j.Today == nil && j.Left > 0
	return j, nil
}

func (s *Store) OpenJar(ctx context.Context, viewer uuid.UUID, day string, placeholders bool) (Note, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Note{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('jar:' || $1::text, 0))`, viewer); err != nil {
		return Note{}, err
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `select id from notes where kind = 'daily' and recipient_id = $1 and available_on = $2`, viewer, day).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `select n.id from notes n where `+jarPool+` order by n.created_at, n.id limit 1`, viewer, placeholders).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return Note{}, ErrNotFound
		}
		if err == nil {
			_, err = tx.Exec(ctx, `update notes set available_on = $2, recipient_id = $3, opened_at = now() where id = $1`, id, day, viewer)
		}
	}
	if err != nil {
		return Note{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Note{}, err
	}
	return s.note(ctx, id)
}

func (s *Store) WindowNotes(ctx context.Context, viewer uuid.UUID, kind string, placeholders bool) ([]Note, error) {
	return s.notes(ctx, `n.kind = $3 and `+fmt.Sprintf(forViewer, "n")+` and (not n.placeholder or $2)
		order by n.created_at, n.id`, viewer, placeholders, kind)
}

func (s *Store) NotesWritten(ctx context.Context, authorID uuid.UUID, placeholders bool) ([]Note, error) {
	return s.notes(ctx, `n.author_id = $1 and (not n.placeholder or $2) order by n.created_at, n.id`, authorID, placeholders)
}

func (s *Store) AddNote(ctx context.Context, authorID uuid.UUID, recipient *uuid.UUID, in NoteEdit) (Note, error) {
	id := newID()
	if _, err := s.pool.Exec(ctx, `insert into notes (id, author_id, recipient_id, kind, body, track_id) values ($1, $2, $3, $4, $5, $6)`,
		id, authorID, recipient, in.Kind, in.Body, in.TrackID); err != nil {
		return Note{}, missingRef(err)
	}
	return s.note(ctx, id)
}

func (s *Store) EditNote(ctx context.Context, id, authorID uuid.UUID, in NoteEdit) (Note, error) {
	tag, err := s.pool.Exec(ctx, `update notes set kind = case when available_on is null then $3 else kind end,
			body = $4, track_id = $5, placeholder = false, updated_at = now()
		where id = $1 and author_id = $2`, id, authorID, in.Kind, in.Body, in.TrackID)
	if err != nil {
		return Note{}, missingRef(err)
	}
	if tag.RowsAffected() == 0 {
		return Note{}, ErrNotFound
	}
	return s.note(ctx, id)
}

func (s *Store) RemoveNote(ctx context.Context, id, authorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from notes where id = $1 and author_id = $2`, id, authorID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type NotesLeft struct {
	AuthorID     uuid.UUID `json:"author_id"`
	Left         int       `json:"left"`
	Placeholders int       `json:"placeholders"`
}

func (s *Store) DailyNotesLeft(ctx context.Context) ([]NotesLeft, error) {
	rows, err := s.pool.Query(ctx, `select author_id, count(*) filter (where not placeholder), count(*) filter (where placeholder)
		from notes where kind = 'daily' and available_on is null group by author_id order by author_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (NotesLeft, error) {
		var n NotesLeft
		return n, row.Scan(&n.AuthorID, &n.Left, &n.Placeholders)
	})
}

type Promise struct {
	ID          uuid.UUID `json:"id"`
	AuthorID    uuid.UUID `json:"author_id"`
	Body        string    `json:"body"`
	KeptOn      *string   `json:"kept_on"`
	Placeholder bool      `json:"placeholder"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PromiseInput struct {
	Body   string  `json:"body"`
	KeptOn *string `json:"kept_on"`
}

func (in *PromiseInput) Validate() error {
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" || utf8.RuneCountInString(in.Body) > maxPaperRunes {
		return fmt.Errorf("a promise of 1 to %d characters", maxPaperRunes)
	}
	if in.KeptOn != nil && *in.KeptOn == "" {
		in.KeptOn = nil
	}
	if in.KeptOn != nil && !validDate(*in.KeptOn) {
		return errors.New("kept_on must be YYYY-MM-DD")
	}
	return nil
}

func scanPromise(row pgx.Row) (Promise, error) {
	var p Promise
	var kept *time.Time
	err := row.Scan(&p.ID, &p.AuthorID, &p.Body, &kept, &p.Placeholder, &p.CreatedAt, &p.UpdatedAt)
	p.KeptOn = dateString(kept)
	return p, err
}

const promiseSelect = `select id, author_id, body, kept_on, placeholder, created_at, updated_at from promises`

func (s *Store) Promises(ctx context.Context, placeholders bool) ([]Promise, error) {
	rows, err := s.pool.Query(ctx, promiseSelect+` where not placeholder or $1 order by created_at, id`, placeholders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Promise, error) { return scanPromise(row) })
}

func (s *Store) CreatePromise(ctx context.Context, authorID uuid.UUID, in PromiseInput) (Promise, error) {
	return scanPromise(s.pool.QueryRow(ctx, `insert into promises (id, author_id, body, kept_on) values ($1, $2, $3, $4)
		returning id, author_id, body, kept_on, placeholder, created_at, updated_at`, newID(), authorID, in.Body, in.KeptOn))
}

func (s *Store) UpdatePromise(ctx context.Context, id, authorID uuid.UUID, in PromiseInput) (Promise, error) {
	p, err := scanPromise(s.pool.QueryRow(ctx, `update promises set body = $3, kept_on = $4, placeholder = false, updated_at = now()
		where id = $1 and author_id = $2 returning id, author_id, body, kept_on, placeholder, created_at, updated_at`, id, authorID, in.Body, in.KeptOn))
	if errors.Is(err, pgx.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

func (s *Store) DeletePromise(ctx context.Context, id, authorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from promises where id = $1 and author_id = $2`, id, authorID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type SongPick struct {
	AuthorID    uuid.UUID  `json:"author_id"`
	TrackID     uuid.UUID  `json:"track_id"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	Track       *TrackView `json:"track,omitempty"`
}

func (s *Store) SongPicks(ctx context.Context, placeholders bool) ([]SongPick, error) {
	rows, err := s.pool.Query(ctx, `select author_id, track_id, placeholder, created_at from picks
		where not placeholder or $1 order by created_at desc limit 500`, placeholders)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (SongPick, error) {
		var p SongPick
		return p, row.Scan(&p.AuthorID, &p.TrackID, &p.Placeholder, &p.CreatedAt)
	})
	if err != nil {
		return nil, err
	}
	return out, s.attachTracks(ctx, len(out), func(i int) uuid.UUID { return out[i].TrackID }, func(i int, v *TrackView) { out[i].Track = v })
}

func (s *Store) AddSongPick(ctx context.Context, authorID, trackID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `insert into picks (author_id, track_id) values ($1, $2)
		on conflict (author_id, track_id) do update set placeholder = false`, authorID, trackID)
	return missingRef(err)
}

func (s *Store) RemoveSongPick(ctx context.Context, authorID, trackID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `delete from picks where author_id = $1 and track_id = $2`, authorID, trackID)
	return err
}

type PickUse struct {
	TrackID     uuid.UUID
	Placeholder bool
	CreatedAt   time.Time
	LastUsed    *string
}

func (s *Store) PickUses(ctx context.Context, authorID uuid.UUID, placeholders bool) ([]PickUse, error) {
	rows, err := s.pool.Query(ctx, `select p.track_id, p.placeholder, p.created_at,
			(select max(d.date) from songs_of_the_day d where d.author_id = p.author_id and d.track_id = p.track_id)
		from picks p where p.author_id = $1 and (not p.placeholder or $2) order by p.created_at, p.track_id`, authorID, placeholders)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PickUse, error) {
		var u PickUse
		var last *time.Time
		err := row.Scan(&u.TrackID, &u.Placeholder, &u.CreatedAt, &last)
		u.LastUsed = dateString(last)
		return u, err
	})
}

type SongOfTheDay struct {
	AuthorID    uuid.UUID  `json:"author_id"`
	Date        string     `json:"date"`
	TrackID     uuid.UUID  `json:"track_id"`
	Note        string     `json:"note"`
	Auto        bool       `json:"auto"`
	Placeholder bool       `json:"placeholder"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Track       *TrackView `json:"track,omitempty"`
}

const songOfTheDaySelect = `select author_id, date, track_id, note, auto, placeholder, created_at, updated_at from songs_of_the_day`

func (s *Store) songsOfTheDay(ctx context.Context, where string, args ...any) ([]SongOfTheDay, error) {
	rows, err := s.pool.Query(ctx, songOfTheDaySelect+" where "+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (SongOfTheDay, error) {
		var d SongOfTheDay
		var date time.Time
		err := row.Scan(&d.AuthorID, &date, &d.TrackID, &d.Note, &d.Auto, &d.Placeholder, &d.CreatedAt, &d.UpdatedAt)
		d.Date = date.Format(dateLayout)
		return d, err
	})
	if err != nil {
		return nil, err
	}
	return out, s.attachTracks(ctx, len(out), func(i int) uuid.UUID { return out[i].TrackID }, func(i int, v *TrackView) { out[i].Track = v })
}

func (s *Store) SongOfTheDayOn(ctx context.Context, authorID uuid.UUID, date string, placeholders bool) (*SongOfTheDay, error) {
	list, err := s.songsOfTheDay(ctx, `author_id = $1 and date = $2 and (not placeholder or $3)`, authorID, date, placeholders)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

func (s *Store) SongsOfTheDay(ctx context.Context, authorID uuid.UUID, through string, placeholders bool) ([]SongOfTheDay, error) {
	if through == "" {
		return s.songsOfTheDay(ctx, `author_id = $1 and (not placeholder or $2) order by date desc limit 120`, authorID, placeholders)
	}
	return s.songsOfTheDay(ctx, `author_id = $1 and (not placeholder or $2) and date <= $3 order by date desc limit 120`, authorID, placeholders, through)
}

func (s *Store) SetSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string, trackID uuid.UUID, note string) error {
	_, err := s.pool.Exec(ctx, `insert into songs_of_the_day (author_id, date, track_id, note) values ($1, $2, $3, $4)
		on conflict (pair_id, author_id, date) do update set track_id = excluded.track_id, note = excluded.note, auto = false,
			placeholder = false, updated_at = now()`, authorID, date, trackID, note)
	return missingRef(err)
}

func (s *Store) AutoSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string, trackID uuid.UUID) (*SongOfTheDay, error) {
	if _, err := s.pool.Exec(ctx, `insert into songs_of_the_day (author_id, date, track_id, auto) values ($1, $2, $3, true)
		on conflict (pair_id, author_id, date) do nothing`, authorID, date, trackID); err != nil {
		return nil, err
	}
	return s.SongOfTheDayOn(ctx, authorID, date, false)
}

func (s *Store) DeleteSongOfTheDay(ctx context.Context, authorID uuid.UUID, date string) error {
	tag, err := s.pool.Exec(ctx, `delete from songs_of_the_day where author_id = $1 and date = $2`, authorID, date)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

const KindProcessFont = "process_font"

type FontPayload struct {
	UserID uuid.UUID `json:"user_id"`
	Path   string    `json:"path"`
}

type HandwritingFont struct {
	UserID       uuid.UUID `json:"user_id"`
	Status       string    `json:"status"`
	OriginalName string    `json:"original_name"`
	URL          *string   `json:"url"`
	Family       *string   `json:"family"`
	Glyphs       *int32    `json:"glyphs"`
	Bytes        *int32    `json:"bytes"`
	Error        *string   `json:"error"`
	UpdatedAt    time.Time `json:"updated_at"`
}

const fontSelect = `select user_id, status, original_name, sha256, family, glyphs, bytes, error, updated_at from handwriting_fonts`

func scanFont(row pgx.Row) (HandwritingFont, error) {
	var f HandwritingFont
	var sha *string
	err := row.Scan(&f.UserID, &f.Status, &f.OriginalName, &sha, &f.Family, &f.Glyphs, &f.Bytes, &f.Error, &f.UpdatedAt)
	if sha != nil && f.Status == "ready" {
		u := "/api/fonts/" + *sha + ".woff2"
		f.URL = &u
	}
	return f, err
}

func (s *Store) HandwritingFonts(ctx context.Context) ([]HandwritingFont, error) {
	rows, err := s.pool.Query(ctx, fontSelect+` where user_id in (select jobbos_people()) order by user_id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (HandwritingFont, error) { return scanFont(row) })
}

func (s *Store) SetHandwritingFont(ctx context.Context, userID uuid.UUID, name, path string) (HandwritingFont, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return HandwritingFont{}, err
	}
	defer tx.Rollback(ctx)
	f, err := scanFont(tx.QueryRow(ctx, `insert into handwriting_fonts (user_id, original_name, original_path) values ($1, $2, $3)
		on conflict (user_id) do update set status = 'processing', original_name = excluded.original_name,
			original_path = excluded.original_path, sha256 = null, path = null, bytes = null, family = null, glyphs = null,
			error = null, updated_at = now()
		returning user_id, status, original_name, sha256, family, glyphs, bytes, error, updated_at`, userID, name, path))
	if err != nil {
		return f, missingRef(err)
	}
	if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindProcessFont, DedupeKey: "font:" + path, Priority: PriorityInteractive,
		Payload: FontPayload{UserID: userID, Path: path}}); err != nil {
		return f, err
	}
	return f, tx.Commit(ctx)
}

func (s *Store) DeleteHandwritingFont(ctx context.Context, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from handwriting_fonts where user_id = $1`, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) HandwritingFontFile(ctx context.Context, sha string) (string, error) {
	var path string
	err := s.pool.QueryRow(ctx, `select path from handwriting_fonts where sha256 = $1 and status = 'ready' and path is not null limit 1`, sha).Scan(&path)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return path, err
}

var fontPathRE = regexp.MustCompile(`^fonts/[0-9a-f]{2}/([0-9a-f]{64})\.woff2$`)

type FontResult struct {
	Font struct {
		SHA256 string `json:"sha256"`
		Path   string `json:"path"`
		Bytes  int64  `json:"bytes"`
		Family string `json:"family"`
		Glyphs int    `json:"glyphs"`
	} `json:"font"`
}

func completeFont(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p FontPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r FontResult
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	m := fontPathRE.FindStringSubmatch(r.Font.Path)
	if m == nil || m[1] != r.Font.SHA256 || r.Font.Bytes <= 0 {
		return fmt.Errorf("font result has an invalid path or size: %q", r.Font.Path)
	}
	family := strings.TrimSpace(r.Font.Family)
	if utf8.RuneCountInString(family) > 200 {
		family = string([]rune(family)[:200])
	}
	_, err := tx.Exec(ctx, `update handwriting_fonts set status = 'ready', sha256 = $3, path = $4, bytes = $5, family = nullif($6, ''),
			glyphs = $7, error = null, updated_at = now()
		where user_id = $1 and original_path = $2`, p.UserID, p.Path, r.Font.SHA256, r.Font.Path, r.Font.Bytes, family, r.Font.Glyphs)
	return err
}

func failFont(ctx context.Context, tx pgx.Tx, payload []byte, message string) error {
	var p FontPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if utf8.RuneCountInString(message) > 300 {
		message = string([]rune(message)[:300])
	}
	_, err := tx.Exec(ctx, `update handwriting_fonts set status = 'failed', error = $3, updated_at = now()
		where user_id = $1 and original_path = $2`, p.UserID, p.Path, message)
	return err
}

type LettersRecap struct {
	Letters       map[uuid.UUID]int
	Notes         map[uuid.UUID]int
	PromisesKept  map[uuid.UUID]int
	SongsOfTheDay map[uuid.UUID]int
}

func (s *Store) LettersRecap(ctx context.Context, from, to time.Time) (LettersRecap, error) {
	out := LettersRecap{Letters: map[uuid.UUID]int{}, Notes: map[uuid.UUID]int{}, PromisesKept: map[uuid.UUID]int{}, SongsOfTheDay: map[uuid.UUID]int{}}
	rows, err := s.pool.Query(ctx, `
		select 'letters', author_id, count(*) from letters
			where status = 'published' and not placeholder and created_at >= $1 and created_at < $2 group by author_id
		union all
		select 'notes', author_id, count(*) from notes
			where not placeholder and created_at >= $1 and created_at < $2 group by author_id
		union all
		select 'promises', author_id, count(*) from promises
			where not placeholder and kept_on >= $3::date and kept_on < $4::date group by author_id
		union all
		select 'songs', author_id, count(*) from songs_of_the_day
			where not placeholder and not auto and date >= $3::date and date < $4::date group by author_id`,
		from, to, from.Format(dateLayout), to.Format(dateLayout))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var what string
		var author uuid.UUID
		var n int
		if err := rows.Scan(&what, &author, &n); err != nil {
			return out, err
		}
		switch what {
		case "letters":
			out.Letters[author] = n
		case "notes":
			out.Notes[author] = n
		case "promises":
			out.PromisesKept[author] = n
		case "songs":
			out.SongsOfTheDay[author] = n
		}
	}
	return out, rows.Err()
}

type LettersSeed struct {
	Welcome  *LetterInput
	Letters  []LetterInput
	Notes    []NoteEdit
	Promises []string
	Picks    int
}

func (s *Store) SeedLetters(ctx context.Context, authorID uuid.UUID, seed LettersSeed) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if w := seed.Welcome; w != nil {
		if _, err := tx.Exec(ctx, `insert into letters (id, author_id, kind, title, body, placeholder) values ($1, $2, 'welcome', $3, $4, true)
			on conflict (author_id) where kind = 'welcome' do nothing`, newID(), authorID, w.Title, w.Body); err != nil {
			return err
		}
	}
	for i, l := range seed.Letters {
		if _, err := tx.Exec(ctx, `insert into letters (id, author_id, kind, occasion, title, body, unlock_at, placeholder, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, true, now() + make_interval(secs => $8), now() + make_interval(secs => $8))`,
			newID(), authorID, l.Kind, l.Occasion, l.Title, l.Body, l.UnlockAt, i); err != nil {
			return err
		}
	}
	for i, n := range seed.Notes {
		if _, err := tx.Exec(ctx, `insert into notes (id, author_id, kind, body, placeholder, created_at)
			values ($1, $2, $3, $4, true, now() + make_interval(secs => $5))`, newID(), authorID, n.Kind, n.Body, i); err != nil {
			return err
		}
	}
	for i, body := range seed.Promises {
		if _, err := tx.Exec(ctx, `insert into promises (id, author_id, body, placeholder, created_at)
			values ($1, $2, $3, true, now() + make_interval(secs => $4))`, newID(), authorID, body, i); err != nil {
			return err
		}
	}
	if seed.Picks > 0 {
		if _, err := tx.Exec(ctx, `insert into picks (author_id, track_id, placeholder)
			select $1, t.id, true from tracks t
			join track_media tm on tm.track_id = t.id and tm.variant = 'main'
			left join lateral (
				select pi.position from playlist_items pi
				where pi.track_id = t.id and pi.playlist_id = (
					select playlist_id from playlist_items group by playlist_id order by count(*) desc limit 1)
				limit 1) p on true
			order by p.position nulls last, t.created_at
			limit $2
			on conflict do nothing`, authorID, seed.Picks); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) LettersPlaceholders(ctx context.Context) (map[string]int, error) {
	out := map[string]int{}
	rows, err := s.pool.Query(ctx, `
		select case when kind = 'welcome' then 'welcome' else 'letters' end, count(*) from letters where placeholder group by 1
		union all select 'notes:' || kind, count(*) from notes where placeholder group by kind
		union all select 'promises', count(*) from promises where placeholder
		union all select 'picks', count(*) from picks where placeholder
		union all select 'songs_of_the_day', count(*) from songs_of_the_day where placeholder`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] += n
	}
	return out, rows.Err()
}
