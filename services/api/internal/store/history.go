package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var EventKinds = map[string]bool{"start": true, "progress": true, "complete": true, "skip": true, "pause": true, "resume": true, "seek": true}

type ListeningEvent struct {
	DeviceID   *uuid.UUID      `json:"device_id"`
	TrackID    uuid.UUID       `json:"track_id"`
	Event      string          `json:"event"`
	PositionMs *int32          `json:"position_ms"`
	Context    json.RawMessage `json:"context"`
	At         *time.Time      `json:"at"`
}

func (e ListeningEvent) Validate() error {
	if !EventKinds[e.Event] {
		return fmt.Errorf("unknown event %q", e.Event)
	}
	if len(e.Context) > 4<<10 || (len(e.Context) > 0 && !json.Valid(e.Context)) {
		return errors.New("context must be JSON of 4 KB at most")
	}
	return nil
}

func (s *Store) RecordEvents(ctx context.Context, userID uuid.UUID, events []ListeningEvent) error {
	batch := &pgx.Batch{}
	for _, e := range events {
		var context []byte
		if len(e.Context) > 0 && string(e.Context) != "null" {
			context = e.Context
		}
		batch.Queue(`insert into listening_events (user_id, device_id, track_id, event, position_ms, context, created_at)
			select $1, (select id from devices where id = $2 and user_id = $1), $3, $4, $5, $6, coalesce($7, now())
			where exists (select 1 from tracks where id = $3)`, userID, e.DeviceID, e.TrackID, e.Event, e.PositionMs, context, e.At)
	}
	return s.pool.SendBatch(ctx, batch).Close()
}

func (s *Store) RecentlyPlayed(ctx context.Context, userID uuid.UUID, limit int) ([]TrackView, error) {
	return s.trackViews(ctx, `join (select track_id, max(created_at) as last_played from listening_events
			where user_id = $1 and event = 'start' group by track_id) h on h.track_id = t.id
		order by h.last_played desc limit $2`, userID, limit)
}

type PlayedTrack struct {
	TrackView
	Plays int `json:"plays"`
}

func (s *Store) MostPlayed(ctx context.Context, userID uuid.UUID, days, limit int) ([]PlayedTrack, error) {
	rows, err := s.pool.Query(ctx, `select track_id, count(*) from listening_events
		where user_id = $1 and event = 'start' and created_at > now() - make_interval(days => $2)
		group by track_id order by count(*) desc, max(created_at) desc limit $3`, userID, days, limit)
	if err != nil {
		return nil, err
	}
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

func (s *Store) viewsByID(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]TrackView, error) {
	views, err := s.trackViews(ctx, `where t.id = any($1)`, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]TrackView, len(views))
	for _, v := range views {
		out[v.ID] = v
	}
	return out, nil
}

type PlaybackState struct {
	DeviceID   uuid.UUID   `json:"device_id"`
	DeviceName string      `json:"device_name"`
	TrackID    *uuid.UUID  `json:"track_id"`
	PositionMs int32       `json:"position_ms"`
	Queue      []uuid.UUID `json:"queue"`
	QueueIndex int         `json:"queue_index"`
	Shuffle    bool        `json:"shuffle"`
	Repeat     string      `json:"repeat"`
	Playing    bool        `json:"playing"`
	UpdatedAt  time.Time   `json:"updated_at"`
}

var RepeatModes = map[string]bool{"off": true, "all": true, "one": true}

func (p PlaybackState) Validate() error {
	switch {
	case !RepeatModes[p.Repeat]:
		return fmt.Errorf("unknown repeat mode %q", p.Repeat)
	case len(p.Queue) > 5000:
		return errors.New("queue of 5000 tracks at most")
	case p.QueueIndex < 0 || (len(p.Queue) > 0 && p.QueueIndex >= len(p.Queue)):
		return errors.New("queue_index out of range")
	case p.PositionMs < 0:
		return errors.New("position_ms must be positive")
	}
	return nil
}

func (s *Store) SavePlayback(ctx context.Context, userID uuid.UUID, p PlaybackState) error {
	queue, err := json.Marshal(p.Queue)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `insert into playback_states (user_id, device_id, track_id, position_ms, queue, queue_index, shuffle, repeat, playing, updated_at)
		select $1, d.id, (select id from tracks where id = $3), $4, $5, $6, $7, $8, $9, now() from devices d where d.id = $2 and d.user_id = $1
		on conflict (user_id, device_id) do update set track_id = excluded.track_id, position_ms = excluded.position_ms,
			queue = excluded.queue, queue_index = excluded.queue_index, shuffle = excluded.shuffle, repeat = excluded.repeat,
			playing = excluded.playing, updated_at = now()`,
		userID, p.DeviceID, p.TrackID, p.PositionMs, queue, p.QueueIndex, p.Shuffle, p.Repeat, p.Playing)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err == nil {
		_, err = s.pool.Exec(ctx, `update devices set last_seen_at = now() where id = $1`, p.DeviceID)
	}
	return err
}

func (s *Store) Playback(ctx context.Context, userID uuid.UUID) ([]PlaybackState, error) {
	rows, err := s.pool.Query(ctx, `select p.device_id, d.name, p.track_id, p.position_ms, p.queue, p.queue_index, p.shuffle, p.repeat, p.playing, p.updated_at
		from playback_states p join devices d on d.id = p.device_id where p.user_id = $1 order by p.updated_at desc`, userID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PlaybackState, error) {
		var p PlaybackState
		var queue []byte
		if err := row.Scan(&p.DeviceID, &p.DeviceName, &p.TrackID, &p.PositionMs, &queue, &p.QueueIndex, &p.Shuffle, &p.Repeat, &p.Playing, &p.UpdatedAt); err != nil {
			return p, err
		}
		return p, json.Unmarshal(queue, &p.Queue)
	})
}
