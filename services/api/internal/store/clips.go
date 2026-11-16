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

const KindProcessClip = "process_clip"

type ClipPayload struct {
	ClipID uuid.UUID `json:"clip_id"`
	Path   string    `json:"path"`
}

type VoiceClip struct {
	ID         uuid.UUID `json:"id"`
	AuthorID   uuid.UUID `json:"author_id"`
	Status     string    `json:"status"`
	URL        *string   `json:"url"`
	DurationMs *int32    `json:"duration_ms"`
	CreatedAt  time.Time `json:"created_at"`
}

func (s *Store) CreateVoiceClip(ctx context.Context, authorID uuid.UUID, path string) (VoiceClip, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VoiceClip{}, err
	}
	defer tx.Rollback(ctx)
	c := VoiceClip{ID: newID(), AuthorID: authorID, Status: "processing"}
	if err := tx.QueryRow(ctx, `insert into voice_clips (id, author_id, original_path) values ($1, $2, $3) returning created_at`,
		c.ID, authorID, path).Scan(&c.CreatedAt); err != nil {
		return c, err
	}
	if _, _, err := enqueue(ctx, tx, JobSpec{Kind: KindProcessClip, DedupeKey: "clip:" + c.ID.String(), Priority: PriorityInteractive,
		Payload: ClipPayload{ClipID: c.ID, Path: path}}); err != nil {
		return c, err
	}
	return c, tx.Commit(ctx)
}

func completeClip(ctx context.Context, tx pgx.Tx, payload, result []byte) error {
	var p ClipPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	var r struct {
		Asset AssetResult `json:"asset"`
	}
	if err := json.Unmarshal(result, &r); err != nil {
		return fmt.Errorf("decode result: %w", err)
	}
	if r.Asset.Kind != "audio" {
		return fmt.Errorf("clip result is %q, not audio", r.Asset.Kind)
	}
	assetID, err := insertAsset(ctx, tx, r.Asset)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `update voice_clips set status = 'ready', asset_id = $2, duration_ms = $3 where id = $1`, p.ClipID, assetID, r.Asset.DurationMs)
	return err
}

func failClip(ctx context.Context, tx pgx.Tx, payload []byte) error {
	var p ClipPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `update voice_clips set status = 'failed' where id = $1`, p.ClipID)
	return err
}

const clipSelect = `select c.id, c.author_id, c.status, ma.sha256, ma.mime, c.duration_ms, c.created_at
	from voice_clips c left join media_assets ma on ma.id = c.asset_id`

func scanClip(row interface{ Scan(...any) error }) (VoiceClip, error) {
	var c VoiceClip
	var sha, mime *string
	if err := row.Scan(&c.ID, &c.AuthorID, &c.Status, &sha, &mime, &c.DurationMs, &c.CreatedAt); err != nil {
		return c, err
	}
	if sha != nil && mime != nil {
		u := "/api/media/" + *sha + "." + MediaExt[*mime]
		c.URL = &u
	}
	return c, nil
}

func (s *Store) VoiceClip(ctx context.Context, id uuid.UUID) (VoiceClip, error) {
	c, err := scanClip(s.pool.QueryRow(ctx, clipSelect+` where c.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	return c, err
}

type Dedication struct {
	ID        uuid.UUID  `json:"id"`
	AuthorID  uuid.UUID  `json:"author_id"`
	TrackID   uuid.UUID  `json:"track_id"`
	Note      string     `json:"note"`
	CreatedAt time.Time  `json:"created_at"`
	Clip      VoiceClip  `json:"clip"`
	Track     *TrackView `json:"track,omitempty"`
}

func (s *Store) CreateDedication(ctx context.Context, authorID, trackID, clipID uuid.UUID, note string) (Dedication, error) {
	clip, err := s.VoiceClip(ctx, clipID)
	if err != nil {
		return Dedication{}, err
	}
	if clip.AuthorID != authorID {
		return Dedication{}, ErrNotFound
	}
	d := Dedication{ID: newID(), AuthorID: authorID, TrackID: trackID, Note: note, Clip: clip}
	err = s.pool.QueryRow(ctx, `insert into dedications (id, author_id, track_id, clip_id, note) values ($1, $2, $3, $4, $5) returning created_at`,
		d.ID, authorID, trackID, clipID, note).Scan(&d.CreatedAt)
	return d, err
}

func (s *Store) Dedications(ctx context.Context, trackID *uuid.UUID) ([]Dedication, error) {
	q := `select d.id, d.author_id, d.track_id, d.note, d.created_at,
		c.id, c.author_id, c.status, ma.sha256, ma.mime, c.duration_ms, c.created_at
		from dedications d join voice_clips c on c.id = d.clip_id left join media_assets ma on ma.id = c.asset_id`
	var rows pgx.Rows
	var err error
	if trackID != nil {
		rows, err = s.pool.Query(ctx, q+` where d.track_id = $1 order by d.created_at desc`, *trackID)
	} else {
		rows, err = s.pool.Query(ctx, q+` order by d.created_at desc limit 500`)
	}
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Dedication, error) {
		var d Dedication
		var sha, mime *string
		if err := row.Scan(&d.ID, &d.AuthorID, &d.TrackID, &d.Note, &d.CreatedAt,
			&d.Clip.ID, &d.Clip.AuthorID, &d.Clip.Status, &sha, &mime, &d.Clip.DurationMs, &d.Clip.CreatedAt); err != nil {
			return d, err
		}
		if sha != nil && mime != nil {
			u := "/api/media/" + *sha + "." + MediaExt[*mime]
			d.Clip.URL = &u
		}
		return d, nil
	})
	if err != nil || trackID != nil {
		return out, err
	}
	return out, s.attachTracks(ctx, len(out), func(i int) uuid.UUID { return out[i].TrackID }, func(i int, v *TrackView) { out[i].Track = v })
}

func (s *Store) DedicatedTrackIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `select distinct d.track_id from dedications d join voice_clips c on c.id = d.clip_id where c.status <> 'failed'`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

func (s *Store) DeleteDedication(ctx context.Context, id, authorID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from dedications where id = $1 and author_id = $2`, id, authorID)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const (
	maxMixtapeTracks = 30
	maxMixtapeTitle  = 60
)

type MixtapeTrackInput struct {
	TrackID uuid.UUID `json:"track_id"`
	Side    string    `json:"side"`
	Note    string    `json:"note"`
}

type MixtapeInput struct {
	Title       string              `json:"title"`
	Color       string              `json:"color"`
	Note        string              `json:"note"`
	IntroClipID *uuid.UUID          `json:"intro_clip_id"`
	Tracks      []MixtapeTrackInput `json:"tracks"`
}

func (in *MixtapeInput) Validate() error {
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" || utf8.RuneCountInString(in.Title) > maxMixtapeTitle {
		return fmt.Errorf("title of 1 to %d characters", maxMixtapeTitle)
	}
	if in.Color == "" {
		in.Color = "#c86b5e"
	}
	if !hexColor.MatchString(in.Color) {
		return errors.New("color must be #rrggbb")
	}
	if utf8.RuneCountInString(in.Note) > maxNoteRunes {
		return fmt.Errorf("note of %d characters at most", maxNoteRunes)
	}
	if len(in.Tracks) > maxMixtapeTracks {
		return fmt.Errorf("%d tracks at most", maxMixtapeTracks)
	}
	for i := range in.Tracks {
		t := &in.Tracks[i]
		if t.Side != "A" && t.Side != "B" {
			return errors.New("side must be A or B")
		}
		if utf8.RuneCountInString(t.Note) > 1000 {
			return errors.New("track notes are 1000 characters at most")
		}
	}
	return nil
}

type MixtapeSummary struct {
	ID         uuid.UUID  `json:"id"`
	Title      string     `json:"title"`
	Color      string     `json:"color"`
	FromUser   uuid.UUID  `json:"from_user"`
	ToUser     uuid.UUID  `json:"to_user"`
	CreatedAt  time.Time  `json:"created_at"`
	SentAt     *time.Time `json:"sent_at"`
	OpenedAt   *time.Time `json:"opened_at"`
	TrackCount int        `json:"track_count"`
}

type MixtapeTrack struct {
	Position int        `json:"position"`
	Side     string     `json:"side"`
	Note     string     `json:"note"`
	Track    *TrackView `json:"track"`
}

type Mixtape struct {
	MixtapeSummary
	Note   string         `json:"note"`
	Intro  *VoiceClip     `json:"intro"`
	Tracks []MixtapeTrack `json:"tracks"`
}

const mixtapeSummarySQL = `select x.id, x.title, x.color, x.from_user, x.to_user, x.created_at, x.sent_at, x.opened_at,
	(select count(*) from mixtape_tracks mt where mt.mixtape_id = x.id) from mixtapes x`

func scanMixtapeSummary(row interface{ Scan(...any) error }) (MixtapeSummary, error) {
	var m MixtapeSummary
	return m, row.Scan(&m.ID, &m.Title, &m.Color, &m.FromUser, &m.ToUser, &m.CreatedAt, &m.SentAt, &m.OpenedAt, &m.TrackCount)
}

func (s *Store) Mixtapes(ctx context.Context, userID uuid.UUID) ([]MixtapeSummary, error) {
	rows, err := s.pool.Query(ctx, mixtapeSummarySQL+` where x.from_user = $1 or (x.to_user = $1 and x.sent_at is not null)
		order by coalesce(x.sent_at, x.created_at) desc`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (MixtapeSummary, error) { return scanMixtapeSummary(row) })
}

func (s *Store) Mixtape(ctx context.Context, id, userID uuid.UUID) (Mixtape, error) {
	var m Mixtape
	var intro *uuid.UUID
	row := s.pool.QueryRow(ctx, `select x.id, x.title, x.color, x.from_user, x.to_user, x.created_at, x.sent_at, x.opened_at,
		(select count(*) from mixtape_tracks mt where mt.mixtape_id = x.id), x.note, x.intro_clip_id
		from mixtapes x where x.id = $1 and (x.from_user = $2 or (x.to_user = $2 and x.sent_at is not null))`, id, userID)
	err := row.Scan(&m.ID, &m.Title, &m.Color, &m.FromUser, &m.ToUser, &m.CreatedAt, &m.SentAt, &m.OpenedAt, &m.TrackCount, &m.Note, &intro)
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	if err != nil {
		return m, err
	}
	if intro != nil {
		if c, err := s.VoiceClip(ctx, *intro); err == nil {
			m.Intro = &c
		}
	}
	rows, err := s.pool.Query(ctx, `select position, side, note, track_id from mixtape_tracks where mixtape_id = $1 order by position`, id)
	if err != nil {
		return m, err
	}
	var ids []uuid.UUID
	m.Tracks, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MixtapeTrack, error) {
		var t MixtapeTrack
		var tid uuid.UUID
		err := row.Scan(&t.Position, &t.Side, &t.Note, &tid)
		ids = append(ids, tid)
		return t, err
	})
	if err != nil {
		return m, err
	}
	return m, s.attachTracks(ctx, len(ids), func(i int) uuid.UUID { return ids[i] }, func(i int, v *TrackView) { m.Tracks[i].Track = v })
}

func (s *Store) SaveMixtape(ctx context.Context, id *uuid.UUID, fromUser, toUser uuid.UUID, in MixtapeInput) (uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	var mid uuid.UUID
	if id == nil {
		mid = newID()
		_, err = tx.Exec(ctx, `insert into mixtapes (id, from_user, to_user, title, color, note, intro_clip_id) values ($1, $2, $3, $4, $5, $6, $7)`,
			mid, fromUser, toUser, in.Title, in.Color, in.Note, in.IntroClipID)
	} else {
		mid = *id
		var tag interface{ RowsAffected() int64 }
		tag, err = tx.Exec(ctx, `update mixtapes set title = $3, color = $4, note = $5, intro_clip_id = $6, updated_at = now()
			where id = $1 and from_user = $2 and sent_at is null`, mid, fromUser, in.Title, in.Color, in.Note, in.IntroClipID)
		if err == nil && tag.RowsAffected() == 0 {
			return mid, ErrNotFound
		}
		if err == nil {
			_, err = tx.Exec(ctx, `delete from mixtape_tracks where mixtape_id = $1`, mid)
		}
	}
	if err != nil {
		return mid, err
	}
	for i, t := range in.Tracks {
		if _, err := tx.Exec(ctx, `insert into mixtape_tracks (mixtape_id, position, side, track_id, note) values ($1, $2, $3, $4, $5)`,
			mid, i, t.Side, t.TrackID, strings.TrimSpace(t.Note)); err != nil {
			return mid, err
		}
	}
	return mid, tx.Commit(ctx)
}

func (s *Store) SendMixtape(ctx context.Context, id, fromUser uuid.UUID) (MixtapeSummary, error) {
	m, err := scanMixtapeSummary(s.pool.QueryRow(ctx, `with sent as (
			update mixtapes set sent_at = now(), updated_at = now()
			where id = $1 and from_user = $2 and sent_at is null and exists (select 1 from mixtape_tracks where mixtape_id = $1)
			returning *)
		select x.id, x.title, x.color, x.from_user, x.to_user, x.created_at, x.sent_at, x.opened_at,
			(select count(*) from mixtape_tracks mt where mt.mixtape_id = x.id) from sent x`, id, fromUser))
	if errors.Is(err, pgx.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func (s *Store) OpenMixtape(ctx context.Context, id, toUser uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `update mixtapes set opened_at = coalesce(opened_at, now()) where id = $1 and to_user = $2 and sent_at is not null`, id, toUser)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) DeleteMixtape(ctx context.Context, id, fromUser uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `delete from mixtapes where id = $1 and from_user = $2 and sent_at is null`, id, fromUser)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
