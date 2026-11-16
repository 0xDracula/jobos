package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
)

type queueItem struct {
	TrackID uuid.UUID `json:"track_id"`
	AddedBy uuid.UUID `json:"added_by"`
	Key     string    `json:"key"`
}

type roomState struct {
	Active            bool        `json:"active"`
	Members           []uuid.UUID `json:"members"`
	Queue             []queueItem `json:"queue"`
	Index             int         `json:"index"`
	Playing           bool        `json:"playing"`
	StartedAtServerMs int64       `json:"started_at_server_ms"`
	PositionAtStartMs int64       `json:"position_at_start_ms"`
	ApplyAtServerMs   int64       `json:"apply_at_server_ms"`
	Version           int         `json:"version"`
	StartedBy         uuid.UUID   `json:"started_by"`
}

type together struct {
	mu    sync.Mutex
	state roomState
	seq   int
}

const commandLead = 300

func (t *together) key() string {
	t.seq++
	return uuid.NewString()[:8] + "-" + time.Now().Format("150405") + "-" + string(rune('a'+t.seq%26))
}

func (s *roomState) position(now int64) int64 {
	if !s.Playing {
		return s.PositionAtStartMs
	}
	return s.PositionAtStartMs + max(0, now-s.StartedAtServerMs)
}

func (a *api) together() roomState {
	a.room.mu.Lock()
	defer a.room.mu.Unlock()
	return a.room.state
}

func (a *api) publishRoom(ctx context.Context) {
	st := a.together()
	a.broadcast(ctx, realtime.NewEvent("room.state", st))
}

func (a *api) registerTogether() {
	a.Hub.Handle("room.join", func(ctx context.Context, user uuid.UUID, _ realtime.Event, reply func(realtime.Event)) {
		a.room.mu.Lock()
		st := &a.room.state
		if st.Active && !containsID(st.Members, user) {
			st.Members = append(st.Members, user)
			st.Version++
		}
		a.room.mu.Unlock()
		a.publishRoom(ctx)
	})
	a.Hub.Handle("room.leave", func(ctx context.Context, user uuid.UUID, _ realtime.Event, _ func(realtime.Event)) {
		a.room.mu.Lock()
		st := &a.room.state
		st.Members = removeID(st.Members, user)
		if len(st.Members) == 0 {
			a.room.state = roomState{Version: st.Version + 1}
		} else {
			st.Version++
		}
		a.room.mu.Unlock()
		a.publishRoom(ctx)
	})
	a.Hub.Handle("room.command", func(ctx context.Context, user uuid.UUID, e realtime.Event, reply func(realtime.Event)) {
		var c struct {
			Action     string      `json:"action"`
			TrackIDs   []uuid.UUID `json:"track_ids"`
			Index      int         `json:"index"`
			PositionMs int64       `json:"position_ms"`
			From       int         `json:"from"`
			To         int         `json:"to"`
		}
		if json.Unmarshal(e.Data, &c) != nil {
			return
		}
		now := time.Now().UnixMilli()
		at := now + commandLead
		a.room.mu.Lock()
		st := &a.room.state
		changed := true
		switch c.Action {
		case "start":
			if len(c.TrackIDs) == 0 || len(c.TrackIDs) > 500 {
				changed = false
				break
			}
			q := make([]queueItem, 0, len(c.TrackIDs))
			for _, id := range c.TrackIDs {
				q = append(q, queueItem{TrackID: id, AddedBy: user, Key: a.room.key()})
			}
			*st = roomState{Active: true, Members: []uuid.UUID{user}, Queue: q, Index: clampIndex(c.Index, len(q)), Playing: true,
				StartedAtServerMs: at, PositionAtStartMs: max(0, c.PositionMs), StartedBy: user, Version: st.Version + 1}
		case "play":
			if !st.Active || st.Playing {
				changed = false
				break
			}
			st.Playing = true
			st.StartedAtServerMs = at
		case "pause":
			if !st.Active || !st.Playing {
				changed = false
				break
			}
			st.PositionAtStartMs = st.position(at)
			st.Playing = false
		case "seek":
			if !st.Active {
				changed = false
				break
			}
			st.PositionAtStartMs = max(0, c.PositionMs)
			st.StartedAtServerMs = at
		case "skip", "jump":
			if !st.Active || len(st.Queue) == 0 {
				changed = false
				break
			}
			next := st.Index + 1
			if c.Action == "jump" {
				next = c.Index
			} else if c.Index < 0 {
				next = st.Index - 1
			}
			if next < 0 || next >= len(st.Queue) {
				changed = false
				break
			}
			st.Index = next
			st.PositionAtStartMs = 0
			st.StartedAtServerMs = at
			st.Playing = true
		case "queue.add":
			if !st.Active || len(c.TrackIDs) == 0 || len(st.Queue)+len(c.TrackIDs) > 500 {
				changed = false
				break
			}
			for _, id := range c.TrackIDs {
				st.Queue = append(st.Queue, queueItem{TrackID: id, AddedBy: user, Key: a.room.key()})
			}
		case "queue.remove":
			if !st.Active || c.Index < 0 || c.Index >= len(st.Queue) || c.Index == st.Index {
				changed = false
				break
			}
			st.Queue = append(st.Queue[:c.Index], st.Queue[c.Index+1:]...)
			if c.Index < st.Index {
				st.Index--
			}
		case "queue.move":
			if !st.Active || c.From < 0 || c.From >= len(st.Queue) || c.To < 0 || c.To >= len(st.Queue) || c.From == c.To {
				changed = false
				break
			}
			item := st.Queue[c.From]
			q := append(st.Queue[:c.From:c.From], st.Queue[c.From+1:]...)
			q = append(q[:c.To], append([]queueItem{item}, q[c.To:]...)...)
			current := st.Queue[st.Index].Key
			st.Queue = q
			for i, it := range q {
				if it.Key == current {
					st.Index = i
				}
			}
		case "end":
			*st = roomState{Version: st.Version + 1}
		default:
			changed = false
		}
		if changed {
			st.ApplyAtServerMs = at
			st.Version++
		}
		a.room.mu.Unlock()
		if changed {
			a.publishRoom(ctx)
		}
	})
}

func (a *api) togetherState(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"room": a.together(), "server_ts": time.Now().UnixMilli()})
}

func clampIndex(i, n int) int {
	if i < 0 || i >= n {
		return 0
	}
	return i
}

func containsID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func removeID(ids []uuid.UUID, id uuid.UUID) []uuid.UUID {
	out := ids[:0:0]
	for _, x := range ids {
		if x != id {
			out = append(out, x)
		}
	}
	return out
}
