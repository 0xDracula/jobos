package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const MaxAvatarBytes = 2048

func (s *Store) SetAvatar(ctx context.Context, userID uuid.UUID, look json.RawMessage) error {
	_, err := s.pool.Exec(ctx, `update users set avatar = $2, updated_at = now() where id = $1`, userID, []byte(look))
	return err
}

var FavoriteCategories = []string{"flowers", "food", "drinks", "colors", "places", "films", "artists", "scents"}

const (
	maxFavoritesPerCategory = 20
	maxFavoriteRunes        = 80
)

type FavoriteList struct {
	UserID    uuid.UUID           `json:"user_id"`
	Items     map[string][]string `json:"items"`
	UpdatedAt *time.Time          `json:"updated_at"`
}

func CleanFavorites(in map[string][]string) (map[string][]string, error) {
	known := map[string]bool{}
	for _, c := range FavoriteCategories {
		known[c] = true
	}
	out := map[string][]string{}
	for cat, items := range in {
		if !known[cat] {
			return nil, fmt.Errorf("unknown category %q", cat)
		}
		seen := map[string]bool{}
		var list []string
		for _, it := range items {
			it = strings.TrimSpace(it)
			if it == "" || seen[strings.ToLower(it)] {
				continue
			}
			if utf8.RuneCountInString(it) > maxFavoriteRunes {
				return nil, fmt.Errorf("%s: entries are %d characters at most", cat, maxFavoriteRunes)
			}
			seen[strings.ToLower(it)] = true
			list = append(list, it)
		}
		if len(list) > maxFavoritesPerCategory {
			return nil, fmt.Errorf("%s: %d entries at most", cat, maxFavoritesPerCategory)
		}
		if len(list) > 0 {
			out[cat] = list
		}
	}
	return out, nil
}

func (s *Store) FavoriteLists(ctx context.Context) ([]FavoriteList, error) {
	rows, err := s.pool.Query(ctx, `select u.id, coalesce(f.items, '{}'), f.updated_at from users u
		left join favorite_lists f on f.user_id = u.id order by u.created_at`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (FavoriteList, error) {
		var l FavoriteList
		var raw []byte
		if err := row.Scan(&l.UserID, &raw, &l.UpdatedAt); err != nil {
			return l, err
		}
		l.Items = map[string][]string{}
		_ = json.Unmarshal(raw, &l.Items)
		return l, nil
	})
}

func (s *Store) SetFavorites(ctx context.Context, userID uuid.UUID, items map[string][]string) (FavoriteList, error) {
	raw, err := json.Marshal(items)
	if err != nil {
		return FavoriteList{}, err
	}
	l := FavoriteList{UserID: userID, Items: items}
	err = s.pool.QueryRow(ctx, `insert into favorite_lists (user_id, items) values ($1, $2)
		on conflict (user_id) do update set items = excluded.items, updated_at = now() returning updated_at`, userID, raw).Scan(&l.UpdatedAt)
	return l, err
}

type Star struct {
	ID     string     `json:"id"`
	Kind   string     `json:"kind"`
	Track  *TrackView `json:"track"`
	UserID uuid.UUID  `json:"user_id"`
	At     time.Time  `json:"at"`
	Note   *string    `json:"note"`
}

func (s *Store) Stars(ctx context.Context, revealedBefore time.Time) ([]Star, error) {
	rows, err := s.pool.Query(ctx, `
		select 'card:' || m.id, 'card', (m.data->>'track_id')::uuid, m.sender_id, m.created_at,
			nullif(coalesce(m.data->>'note', ''), '')
		from chat_messages m
		where m.kind in ('song', 'lyric') and m.deleted_at is null and m.data ? 'track_id'
		union all
		select 'swap:' || w.id, 'swap', w.track_id, w.user_id, w.week::timestamptz, nullif(w.note, '')
		from song_swaps w where w.week < $1
		union all
		select 'dedication:' || d.id, 'dedication', d.track_id, d.author_id, d.created_at, nullif(d.note, '')
		from dedications d join voice_clips c on c.id = d.clip_id where c.status = 'ready'
		union all
		select 'mixtape:' || x.id || ':' || mt.position, 'mixtape', mt.track_id, x.from_user, x.sent_at,
			coalesce(nullif(mt.note, ''), x.title)
		from mixtapes x join mixtape_tracks mt on mt.mixtape_id = x.id
		where x.sent_at is not null and x.opened_at is not null
		union all
		select 'note:' || n.id, 'note', n.track_id, n.author_id, n.created_at, n.body
		from song_notes n
		order by 5`, revealedBefore)
	if err != nil {
		return nil, err
	}
	type row struct {
		Star
		trackID uuid.UUID
	}
	raw, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		return x, r.Scan(&x.ID, &x.Kind, &x.trackID, &x.UserID, &x.At, &x.Note)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		ids = append(ids, r.trackID)
	}
	views, err := s.TracksByID(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]*TrackView{}
	for i := range views {
		byID[views[i].ID] = &views[i]
	}
	out := make([]Star, 0, len(raw))
	for _, r := range raw {
		if r.Star.Track = byID[r.trackID]; r.Star.Track != nil {
			out = append(out, r.Star)
		}
	}
	return out, nil
}

type SongNote struct {
	ID        uuid.UUID  `json:"id"`
	AuthorID  uuid.UUID  `json:"author_id"`
	TrackID   uuid.UUID  `json:"track_id"`
	LineIndex *int32     `json:"line_index"`
	LineText  *string    `json:"line_text"`
	LineMs    *int32     `json:"line_ms"`
	Body      string     `json:"body"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	Track     *TrackView `json:"track,omitempty"`
}

type SongNoteInput struct {
	LineIndex *int32  `json:"line_index"`
	LineText  *string `json:"line_text"`
	LineMs    *int32  `json:"line_ms"`
	Body      string  `json:"body"`
}

const maxNoteRunes = 4000

func (in *SongNoteInput) Validate() error {
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" {
		return errors.New("note is empty")
	}
	if utf8.RuneCountInString(in.Body) > maxNoteRunes {
		return fmt.Errorf("notes are %d characters at most", maxNoteRunes)
	}
	if in.LineIndex != nil && *in.LineIndex < 0 {
		return errors.New("invalid line")
	}
	return nil
}

const songNoteCols = `id, author_id, track_id, line_index, line_text, line_ms, body, created_at, updated_at`

func scanSongNote(row pgx.CollectableRow) (SongNote, error) {
	var n SongNote
	return n, row.Scan(&n.ID, &n.AuthorID, &n.TrackID, &n.LineIndex, &n.LineText, &n.LineMs, &n.Body, &n.CreatedAt, &n.UpdatedAt)
}

func (s *Store) SongNotes(ctx context.Context, trackID *uuid.UUID) ([]SongNote, error) {
	var rows pgx.Rows
	var err error
	if trackID != nil {
		rows, err = s.pool.Query(ctx, `select `+songNoteCols+` from song_notes where track_id = $1
			order by line_index nulls first, created_at`, *trackID)
	} else {
		rows, err = s.pool.Query(ctx, `select `+songNoteCols+` from song_notes order by created_at desc limit 500`)
	}
	if err != nil {
		return nil, err
	}
	notes, err := pgx.CollectRows(rows, scanSongNote)
	if err != nil || trackID != nil {
		return notes, err
	}
	return notes, s.attachTracks(ctx, len(notes), func(i int) uuid.UUID { return notes[i].TrackID }, func(i int, v *TrackView) { notes[i].Track = v })
}

func (s *Store) CreateSongNote(ctx context.Context, authorID, trackID uuid.UUID, in SongNoteInput) (SongNote, error) {
	rows, err := s.pool.Query(ctx, `insert into song_notes (id, author_id, track_id, line_index, line_text, line_ms, body)
		values ($1, $2, $3, $4, $5, $6, $7) returning `+songNoteCols,
		newID(), authorID, trackID, in.LineIndex, in.LineText, in.LineMs, in.Body)
	if err != nil {
		return SongNote{}, err
	}
	return pgx.CollectExactlyOneRow(rows, scanSongNote)
}

func (s *Store) UpdateSongNote(ctx context.Context, id, authorID uuid.UUID, body string) (SongNote, error) {
	rows, err := s.pool.Query(ctx, `update song_notes set body = $3, updated_at = now() where id = $1 and author_id = $2
		returning `+songNoteCols, id, authorID, body)
	if err != nil {
		return SongNote{}, err
	}
	n, err := pgx.CollectExactlyOneRow(rows, scanSongNote)
	if errors.Is(err, pgx.ErrNoRows) {
		return n, ErrNotFound
	}
	return n, err
}

func (s *Store) DeleteSongNote(ctx context.Context, id, authorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from song_notes where id = $1 and author_id = $2`, id, authorID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

type CardLine struct {
	Text string `json:"text"`
	Ms   *int32 `json:"ms"`
}

type Clipping struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"user_id"`
	TrackID   uuid.UUID  `json:"track_id"`
	Lines     []CardLine `json:"lines"`
	CreatedAt time.Time  `json:"created_at"`
	Track     *TrackView `json:"track,omitempty"`
}

const maxClippingLines = 12

func ValidateLines(lines []CardLine) error {
	if len(lines) == 0 || len(lines) > maxClippingLines {
		return fmt.Errorf("1 to %d lines", maxClippingLines)
	}
	for _, l := range lines {
		if strings.TrimSpace(l.Text) == "" || utf8.RuneCountInString(l.Text) > 500 {
			return errors.New("invalid line")
		}
	}
	return nil
}

func (s *Store) Clippings(ctx context.Context) ([]Clipping, error) {
	rows, err := s.pool.Query(ctx, `select id, user_id, track_id, lines, created_at from scrapbook_clippings order by created_at desc limit 1000`)
	if err != nil {
		return nil, err
	}
	clips, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Clipping, error) {
		var c Clipping
		var raw []byte
		if err := row.Scan(&c.ID, &c.UserID, &c.TrackID, &raw, &c.CreatedAt); err != nil {
			return c, err
		}
		return c, json.Unmarshal(raw, &c.Lines)
	})
	if err != nil {
		return nil, err
	}
	return clips, s.attachTracks(ctx, len(clips), func(i int) uuid.UUID { return clips[i].TrackID }, func(i int, v *TrackView) { clips[i].Track = v })
}

func (s *Store) AddClipping(ctx context.Context, userID, trackID uuid.UUID, lines []CardLine) (Clipping, error) {
	raw, err := json.Marshal(lines)
	if err != nil {
		return Clipping{}, err
	}
	c := Clipping{ID: newID(), UserID: userID, TrackID: trackID, Lines: lines}
	err = s.pool.QueryRow(ctx, `insert into scrapbook_clippings (id, user_id, track_id, lines) values ($1, $2, $3, $4) returning created_at`,
		c.ID, userID, trackID, raw).Scan(&c.CreatedAt)
	return c, err
}

func (s *Store) DeleteClipping(ctx context.Context, id, userID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from scrapbook_clippings where id = $1 and user_id = $2`, id, userID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) attachTracks(ctx context.Context, n int, idOf func(int) uuid.UUID, set func(int, *TrackView)) error {
	if n == 0 {
		return nil
	}
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = idOf(i)
	}
	views, err := s.TracksByID(ctx, ids)
	if err != nil {
		return err
	}
	byID := map[uuid.UUID]*TrackView{}
	for i := range views {
		byID[views[i].ID] = &views[i]
	}
	for i := 0; i < n; i++ {
		set(i, byID[idOf(i)])
	}
	return nil
}

type PlayCount struct {
	UserID uuid.UUID `json:"user_id"`
	Plays  int       `json:"plays"`
}

func (s *Store) PlayCounts(ctx context.Context, trackID uuid.UUID) ([]PlayCount, error) {
	rows, err := s.pool.Query(ctx, `select u.id, count(e.id) from users u
		left join listening_events e on e.user_id = u.id and e.track_id = $1 and e.event = 'start'
		group by u.id, u.created_at order by u.created_at`, trackID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlayCount, error) {
		var c PlayCount
		return c, r.Scan(&c.UserID, &c.Plays)
	})
}
