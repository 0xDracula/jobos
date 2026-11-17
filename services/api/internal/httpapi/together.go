package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type queueItem struct {
	TrackID uuid.UUID `json:"track_id"`
	AddedBy uuid.UUID `json:"added_by"`
	Key     string    `json:"key"`
}

type roomState struct {
	Active            bool        `json:"active"`
	SessionID         uuid.UUID   `json:"session_id"`
	Title             string      `json:"title"`
	Members           []uuid.UUID `json:"members"`
	Queue             []queueItem `json:"queue"`
	Index             int         `json:"index"`
	Playing           bool        `json:"playing"`
	Finished          bool        `json:"finished"`
	StartedAtServerMs int64       `json:"started_at_server_ms"`
	PositionAtStartMs int64       `json:"position_at_start_ms"`
	ApplyAtServerMs   int64       `json:"apply_at_server_ms"`
	Version           int         `json:"version"`
	StartedBy         uuid.UUID   `json:"started_by"`
}

type together struct {
	mu         sync.Mutex
	state      roomState
	togetherMs int64
	accruedAt  int64
}

const commandLead = 300

var sessionReactions = map[string]bool{"❤️": true, "😂": true, "🔥": true, "🎶": true, "🥹": true, "😭": true}

func (s *roomState) position(now int64) int64 {
	if !s.Playing {
		return s.PositionAtStartMs
	}
	return s.PositionAtStartMs + max(0, now-s.StartedAtServerMs)
}

func (s *roomState) currentKey() string {
	if s.Index >= 0 && s.Index < len(s.Queue) {
		return s.Queue[s.Index].Key
	}
	return ""
}

func (t *together) accrue(now int64) {
	st := &t.state
	if st.Active && st.Playing && len(st.Members) >= 2 && t.accruedAt > 0 {
		t.togetherMs += max(0, now-t.accruedAt)
	}
	t.accruedAt = now
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

func (a *api) saveLive(played bool) {
	a.room.mu.Lock()
	st := a.room.state
	a.room.accrue(time.Now().UnixMilli())
	together := a.room.togetherMs
	a.room.mu.Unlock()
	if !st.Active || a.Store == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	key := st.currentKey()
	if err := a.Store.SaveSessionLive(ctx, st.SessionID, key, st.position(time.Now().UnixMilli()), together, st.Members); err != nil {
		a.Log.Warn("save live session", "err", err)
	}
	if played && key != "" {
		if err := a.Store.MarkSessionItemPlayed(ctx, st.SessionID, key); err != nil {
			a.Log.Warn("mark session song played", "err", err)
		}
	}
}

func (a *api) saveLiveQueue(ctx context.Context) {
	st := a.together()
	if !st.Active || a.Store == nil {
		return
	}
	items := make([]store.SessionItem, len(st.Queue))
	for i, q := range st.Queue {
		by := q.AddedBy
		items[i] = store.SessionItem{Key: q.Key, TrackID: q.TrackID, AddedBy: &by}
	}
	if err := a.Store.SyncSessionItems(ctx, st.SessionID, items); err != nil {
		a.Log.Warn("save session setlist", "err", err)
	}
	a.broadcast(ctx, realtime.NewEvent("session.update", map[string]any{"id": st.SessionID}))
}

func (a *api) goLive(sess *store.ListeningSession, user uuid.UUID) {
	q := make([]queueItem, 0, len(sess.Items))
	for _, it := range sess.Items {
		by := user
		if it.AddedBy != nil {
			by = *it.AddedBy
		}
		q = append(q, queueItem{TrackID: it.TrackID, AddedBy: by, Key: it.Key})
	}
	now := time.Now().UnixMilli()
	at := now + commandLead
	a.room.mu.Lock()
	a.room.state = roomState{Active: true, SessionID: sess.ID, Title: sess.Title, Members: []uuid.UUID{user}, Queue: q,
		Playing: len(q) > 0, StartedAtServerMs: at, ApplyAtServerMs: at, StartedBy: user, Version: a.room.state.Version + 1}
	a.room.togetherMs = sess.TogetherMs
	a.room.accruedAt = now
	a.room.mu.Unlock()
}

func (a *api) reloadLiveQueue(ctx context.Context, id uuid.UUID) error {
	items, err := a.Store.SessionItems(ctx, id)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	at := now + commandLead
	a.room.mu.Lock()
	st := &a.room.state
	if !st.Active || st.SessionID != id {
		a.room.mu.Unlock()
		return nil
	}
	a.room.accrue(now)
	current := st.currentKey()
	q := make([]queueItem, 0, len(items))
	index := 0
	for i, it := range items {
		by := st.StartedBy
		if it.AddedBy != nil {
			by = *it.AddedBy
		}
		q = append(q, queueItem{TrackID: it.TrackID, AddedBy: by, Key: it.Key})
		if it.Key == current {
			index = i
		}
	}
	resume := st.Finished && index < len(q)-1
	st.Queue = q
	st.Index = index
	if resume {
		st.Index++
		st.Finished = false
		st.Playing = true
		st.PositionAtStartMs = 0
		st.StartedAtServerMs = at
	}
	st.ApplyAtServerMs = at
	st.Version++
	a.room.mu.Unlock()
	if resume {
		a.saveLive(true)
	}
	a.publishRoom(ctx)
	return nil
}

func (a *api) restoreLive() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	sess, err := a.Store.LiveSession(ctx)
	if err != nil {
		return
	}
	a.goLive(sess, sess.CreatedBy)
	a.room.mu.Lock()
	st := &a.room.state
	st.Members = nil
	st.Playing = false
	for i, q := range st.Queue {
		if sess.CurrentKey != nil && q.Key == *sess.CurrentKey {
			st.Index = i
		}
	}
	st.PositionAtStartMs = sess.PositionMs
	a.room.mu.Unlock()
}

func (a *api) endLive(ctx context.Context) {
	now := time.Now().UnixMilli()
	a.room.mu.Lock()
	st := a.room.state
	a.room.accrue(now)
	together := a.room.togetherMs
	a.room.state = roomState{Version: st.Version + 1}
	a.room.togetherMs = 0
	a.room.mu.Unlock()
	if st.Active && a.Store != nil {
		if err := a.Store.EndSession(ctx, st.SessionID, st.position(now), together); err != nil {
			a.Log.Warn("end session", "err", err)
		}
		a.broadcast(ctx, realtime.NewEvent("session.update", map[string]any{"id": st.SessionID}))
	}
	a.publishRoom(ctx)
}

func (a *api) registerTogether() {
	a.Hub.Handle("room.join", func(ctx context.Context, user uuid.UUID, _ realtime.Event, reply func(realtime.Event)) {
		a.room.mu.Lock()
		st := &a.room.state
		joined := false
		if st.Active && !containsID(st.Members, user) {
			a.room.accrue(time.Now().UnixMilli())
			st.Members = append(st.Members, user)
			st.Version++
			joined = true
		}
		a.room.mu.Unlock()
		if joined {
			a.saveLive(false)
		}
		a.publishRoom(ctx)
	})
	a.Hub.Handle("room.leave", func(ctx context.Context, user uuid.UUID, _ realtime.Event, _ func(realtime.Event)) {
		now := time.Now().UnixMilli()
		a.room.mu.Lock()
		st := &a.room.state
		a.room.accrue(now)
		st.Members = removeID(st.Members, user)
		if len(st.Members) == 0 && st.Playing {
			st.PositionAtStartMs = st.position(now)
			st.Playing = false
		}
		st.Version++
		a.room.mu.Unlock()
		a.saveLive(false)
		a.publishRoom(ctx)
	})
	a.Hub.Handle("room.react", func(ctx context.Context, user uuid.UUID, e realtime.Event, _ func(realtime.Event)) {
		var c struct {
			Emoji string `json:"emoji"`
		}
		st := a.together()
		if json.Unmarshal(e.Data, &c) != nil || !sessionReactions[c.Emoji] || !st.Active || !containsID(st.Members, user) {
			return
		}
		a.broadcast(ctx, realtime.NewEvent("session.reaction", map[string]any{"session_id": st.SessionID, "from": user, "emoji": c.Emoji}))
	})
	a.Hub.Handle("room.command", func(ctx context.Context, user uuid.UUID, e realtime.Event, reply func(realtime.Event)) {
		var c struct {
			Action     string      `json:"action"`
			TrackIDs   []uuid.UUID `json:"track_ids"`
			Index      int         `json:"index"`
			PositionMs int64       `json:"position_ms"`
			From       int         `json:"from"`
			To         int         `json:"to"`
			Key        string      `json:"key"`
			At         *int        `json:"at"`
			Keys       []string    `json:"keys"`
		}
		if json.Unmarshal(e.Data, &c) != nil {
			return
		}
		if c.Action == "end" {
			if st := a.together(); st.Active && containsID(st.Members, user) {
				a.endLive(ctx)
			}
			return
		}
		now := time.Now().UnixMilli()
		at := now + commandLead
		a.room.mu.Lock()
		st := &a.room.state
		if !st.Active || !containsID(st.Members, user) {
			a.room.mu.Unlock()
			return
		}
		a.room.accrue(now)
		changed, played, queueChanged := true, false, false
		addAt := func(pos int) []queueItem {
			added := make([]queueItem, 0, len(c.TrackIDs))
			for _, id := range c.TrackIDs {
				added = append(added, queueItem{TrackID: id, AddedBy: user, Key: store.SessionKey()})
			}
			st.Queue = append(st.Queue[:pos:pos], append(added, st.Queue[pos:]...)...)
			return added
		}
		switch c.Action {
		case "play":
			if st.Playing || len(st.Queue) == 0 {
				changed = false
				break
			}
			if st.Finished {
				st.Finished = false
				st.PositionAtStartMs = 0
			}
			st.Playing = true
			st.StartedAtServerMs = at
		case "pause":
			if !st.Playing {
				changed = false
				break
			}
			st.PositionAtStartMs = st.position(at)
			st.Playing = false
		case "seek":
			st.PositionAtStartMs = max(0, c.PositionMs)
			st.StartedAtServerMs = at
		case "skip", "jump":
			if len(st.Queue) == 0 || (c.Key != "" && st.currentKey() != c.Key) || (st.Finished && c.Action == "skip" && c.Index >= 0) {
				changed = false
				break
			}
			next := st.Index + 1
			if c.Action == "jump" {
				next = c.Index
			} else if c.Index < 0 {
				next = st.Index - 1
			}
			if c.Action == "skip" && c.Index >= 0 && next == len(st.Queue) {
				st.Finished = true
				st.Playing = false
				st.PositionAtStartMs = st.position(at)
				break
			}
			if next < 0 || next >= len(st.Queue) {
				changed = false
				break
			}
			st.Index = next
			st.Finished = false
			st.PositionAtStartMs = 0
			st.StartedAtServerMs = at
			st.Playing = true
			played = true
		case "playnow":
			if len(c.TrackIDs) == 0 || len(st.Queue)+len(c.TrackIDs) > store.MaxSessionItems {
				changed = false
				break
			}
			if len(c.TrackIDs) > 100 {
				c.TrackIDs = c.TrackIDs[:100]
			}
			pos := min(st.Index+1, len(st.Queue))
			addAt(pos)
			st.Index = pos
			st.Finished = false
			st.PositionAtStartMs = 0
			st.StartedAtServerMs = at
			st.Playing = true
			played, queueChanged = true, true
		case "queue.add":
			if len(c.TrackIDs) == 0 || len(st.Queue)+len(c.TrackIDs) > store.MaxSessionItems {
				changed = false
				break
			}
			pos := len(st.Queue)
			if c.At != nil && *c.At > st.Index && *c.At < len(st.Queue) {
				pos = *c.At
			}
			addAt(pos)
			if st.Finished {
				st.Index++
				st.Finished = false
				st.PositionAtStartMs = 0
				st.StartedAtServerMs = at
				st.Playing = true
				played = true
			}
			queueChanged = true
		case "queue.remove":
			if c.Index < 0 || c.Index >= len(st.Queue) || c.Index == st.Index {
				changed = false
				break
			}
			st.Queue = append(st.Queue[:c.Index], st.Queue[c.Index+1:]...)
			if c.Index < st.Index {
				st.Index--
			}
			queueChanged = true
		case "queue.move":
			if c.From < 0 || c.From >= len(st.Queue) || c.To < 0 || c.To >= len(st.Queue) || c.From == c.To {
				changed = false
				break
			}
			current := st.currentKey()
			item := st.Queue[c.From]
			q := append(st.Queue[:c.From:c.From], st.Queue[c.From+1:]...)
			q = append(q[:c.To], append([]queueItem{item}, q[c.To:]...)...)
			st.Queue = q
			for i, it := range q {
				if it.Key == current {
					st.Index = i
				}
			}
			queueChanged = true
		case "queue.order":
			if len(c.Keys) != len(st.Queue) {
				changed = false
				break
			}
			byKey := make(map[string]queueItem, len(st.Queue))
			for _, it := range st.Queue {
				byKey[it.Key] = it
			}
			current := st.currentKey()
			q := make([]queueItem, 0, len(c.Keys))
			for _, k := range c.Keys {
				it, ok := byKey[k]
				if !ok {
					break
				}
				delete(byKey, k)
				q = append(q, it)
			}
			if len(q) != len(st.Queue) {
				changed = false
				break
			}
			st.Queue = q
			for i, it := range q {
				if it.Key == current {
					st.Index = i
				}
			}
			queueChanged = true
		case "queue.clear":
			if st.Index >= len(st.Queue)-1 {
				changed = false
				break
			}
			st.Queue = st.Queue[: st.Index+1 : st.Index+1]
			queueChanged = true
		default:
			changed = false
		}
		if changed {
			st.ApplyAtServerMs = at
			st.Version++
		}
		a.room.mu.Unlock()
		if !changed {
			return
		}
		a.publishRoom(ctx)
		if queueChanged {
			a.saveLiveQueue(ctx)
		}
		a.saveLive(played)
	})
}

func (a *api) togetherState(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"room": a.together(), "server_ts": time.Now().UnixMilli()})
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
