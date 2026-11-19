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
	Jam               bool        `json:"jam"`
	Host              uuid.UUID   `json:"host"`
	AnyoneAdd         bool        `json:"anyone_add"`
	AnyoneSkip        bool        `json:"anyone_skip"`
}

type rooms struct {
	mu   sync.Mutex
	none together
	m    map[uuid.UUID]*together
	user map[uuid.UUID]uuid.UUID
	pair map[uuid.UUID]uuid.UUID
}

type roomKey struct{}

func withRoom(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, roomKey{}, id)
}

func (r *rooms) init() {
	if r.m == nil {
		r.m, r.user, r.pair = map[uuid.UUID]*together{}, map[uuid.UUID]uuid.UUID{}, map[uuid.UUID]uuid.UUID{}
	}
}

func (a *api) roomID(ctx context.Context) uuid.UUID {
	if id, ok := ctx.Value(roomKey{}).(uuid.UUID); ok {
		return id
	}
	a.rooms.mu.Lock()
	defer a.rooms.mu.Unlock()
	a.rooms.init()
	sp := spaceOf(ctx)
	if sp == nil {
		return uuid.Nil
	}
	if id, ok := a.rooms.user[sp.me]; ok && sp.me != uuid.Nil {
		return id
	}
	if sp.pair != nil {
		return a.rooms.pair[sp.pair.ID]
	}
	return uuid.Nil
}

func (a *api) room(id uuid.UUID) *together {
	if id == uuid.Nil {
		return &a.rooms.none
	}
	a.rooms.mu.Lock()
	defer a.rooms.mu.Unlock()
	a.rooms.init()
	t := a.rooms.m[id]
	if t == nil {
		t = &together{}
		a.rooms.m[id] = t
	}
	return t
}

func (a *api) roomOf(ctx context.Context) *together {
	return a.room(a.roomID(ctx))
}

func (a *api) userRoom(user uuid.UUID) (uuid.UUID, bool) {
	a.rooms.mu.Lock()
	defer a.rooms.mu.Unlock()
	a.rooms.init()
	id, ok := a.rooms.user[user]
	return id, ok
}

func (a *api) setUserRoom(user, id uuid.UUID) {
	a.rooms.mu.Lock()
	defer a.rooms.mu.Unlock()
	a.rooms.init()
	if id == uuid.Nil {
		delete(a.rooms.user, user)
	} else {
		a.rooms.user[user] = id
	}
}

type roomMeta struct {
	pairID      *uuid.UUID
	host        uuid.UUID
	audience    []uuid.UUID
	conv        *uuid.UUID
	anyoneAdd   bool
	anyoneSkip  bool
	friendsJoin bool
}

func (m roomMeta) jam() bool { return m.pairID == nil }

type together struct {
	mu         sync.Mutex
	state      roomState
	meta       roomMeta
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

func (a *api) together(ctx context.Context) roomState {
	t := a.roomOf(ctx)
	t.mu.Lock()
	defer t.mu.Unlock()
	st := t.state
	if st.Members == nil {
		st.Members = []uuid.UUID{}
	}
	if st.Queue == nil {
		st.Queue = []queueItem{}
	}
	return st
}

func (a *api) publishRoom(ctx context.Context) {
	if a.Hub == nil {
		return
	}
	t := a.roomOf(ctx)
	st := a.together(ctx)
	t.mu.Lock()
	to := append(append([]uuid.UUID{}, t.meta.audience...), st.Members...)
	t.mu.Unlock()
	if len(to) == 0 {
		a.broadcast(ctx, realtime.NewEvent("room.state", st))
		return
	}
	sent := map[uuid.UUID]bool{}
	e := realtime.NewEvent("room.state", st)
	for _, u := range to {
		if !sent[u] {
			sent[u] = true
			a.Hub.Send(u, e)
		}
	}
}

func (a *api) saveLive(ctx context.Context, played bool) {
	t := a.roomOf(ctx)
	t.mu.Lock()
	st := t.state
	t.accrue(time.Now().UnixMilli())
	together := t.togetherMs
	t.mu.Unlock()
	if !st.Active || a.Store == nil {
		return
	}
	dctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	key := st.currentKey()
	if err := a.Store.SaveSessionLive(dctx, st.SessionID, key, st.position(time.Now().UnixMilli()), together, st.Members); err != nil {
		a.Log.Warn("save live session", "err", err)
	}
	if played && key != "" {
		if err := a.Store.MarkSessionItemPlayed(dctx, st.SessionID, key); err != nil {
			a.Log.Warn("mark session song played", "err", err)
		}
	}
}

func (a *api) saveLiveQueue(ctx context.Context) {
	st := a.together(ctx)
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

func (a *api) goLive(ctx context.Context, sess *store.ListeningSession, user uuid.UUID) {
	ctx = withRoom(ctx, sess.ID)
	meta := roomMeta{pairID: sess.PairID, host: sess.CreatedBy, conv: sess.ConversationID,
		anyoneAdd: sess.AnyoneAdd, anyoneSkip: sess.AnyoneSkip, friendsJoin: sess.FriendsJoin}
	if sess.PairID != nil {
		if p, err := a.pairFor(ctx, sess.CreatedBy); err == nil && p != nil && p.ID == *sess.PairID {
			for _, m := range p.Members {
				meta.audience = append(meta.audience, m.ID)
			}
		} else if sp := spaceOf(ctx); sp != nil && sp.pair != nil {
			for _, m := range sp.pair.Members {
				meta.audience = append(meta.audience, m.ID)
			}
		}
	} else {
		meta.audience = append(append(meta.audience, sess.CreatedBy), sess.Audience...)
		if sess.ConversationID != nil && a.social() != nil {
			if ids, err := a.social().ConversationMemberIDs(store.AnyPair(ctx), *sess.ConversationID); err == nil {
				meta.audience = append(meta.audience, ids...)
			}
		}
	}
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
	members := []uuid.UUID{}
	if user != uuid.Nil {
		members = append(members, user)
	}
	t := a.roomOf(ctx)
	t.mu.Lock()
	t.state = roomState{Active: true, SessionID: sess.ID, Title: sess.Title, Members: members, Queue: q,
		Playing: len(q) > 0 && user != uuid.Nil, StartedAtServerMs: at, ApplyAtServerMs: at, StartedBy: sess.CreatedBy, Version: t.state.Version + 1,
		Jam: meta.jam(), Host: sess.CreatedBy, AnyoneAdd: meta.anyoneAdd, AnyoneSkip: meta.anyoneSkip}
	t.meta = meta
	t.togetherMs = sess.TogetherMs
	t.accruedAt = now
	t.mu.Unlock()
	a.rooms.mu.Lock()
	a.rooms.init()
	if sess.PairID != nil {
		a.rooms.pair[*sess.PairID] = sess.ID
	}
	a.rooms.mu.Unlock()
	if user != uuid.Nil {
		if prev, ok := a.userRoom(user); ok && prev != sess.ID {
			a.leaveRoom(withRoom(ctx, prev), user)
		}
		a.setUserRoom(user, sess.ID)
	}
}

func (a *api) reloadLiveQueue(ctx context.Context, id uuid.UUID) error {
	items, err := a.Store.SessionItems(ctx, id)
	if err != nil {
		return err
	}
	ctx = withRoom(ctx, id)
	now := time.Now().UnixMilli()
	at := now + commandLead
	t := a.roomOf(ctx)
	t.mu.Lock()
	st := &t.state
	if !st.Active || st.SessionID != id {
		t.mu.Unlock()
		return nil
	}
	t.accrue(now)
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
	t.mu.Unlock()
	if resume {
		a.saveLive(ctx, true)
	}
	a.publishRoom(ctx)
	return nil
}

func (a *api) restoreLive() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ls, ok := a.Store.(interface {
		LiveSessions(ctx context.Context) ([]store.ListeningSession, error)
	})
	if !ok {
		return
	}
	list, err := ls.LiveSessions(store.AnyPair(ctx))
	if err != nil {
		a.Log.Warn("restore live sessions", "err", err)
		return
	}
	for i := range list {
		sess, err := a.Store.ListeningSessionByID(store.AnyPair(ctx), list[i].ID)
		if err != nil {
			continue
		}
		a.goLive(ctx, sess, uuid.Nil)
		rm := a.room(sess.ID)
		rm.mu.Lock()
		st := &rm.state
		st.Playing = false
		for i, q := range st.Queue {
			if sess.CurrentKey != nil && q.Key == *sess.CurrentKey {
				st.Index = i
			}
		}
		st.PositionAtStartMs = sess.PositionMs
		rm.mu.Unlock()
	}
}

func (a *api) endLive(ctx context.Context) {
	id := a.roomID(ctx)
	if id == uuid.Nil {
		return
	}
	ctx = withRoom(ctx, id)
	now := time.Now().UnixMilli()
	t := a.roomOf(ctx)
	t.mu.Lock()
	st := t.state
	meta := t.meta
	t.accrue(now)
	together := t.togetherMs
	t.state = roomState{Version: st.Version + 1}
	t.togetherMs = 0
	t.mu.Unlock()
	if st.Active && a.Store != nil {
		if err := a.Store.EndSession(store.AnyPair(ctx), st.SessionID, st.position(now), together); err != nil {
			a.Log.Warn("end session", "err", err)
		}
		a.broadcast(ctx, realtime.NewEvent("session.update", map[string]any{"id": st.SessionID}))
	}
	if a.Hub != nil {
		e := realtime.NewEvent("room.state", roomState{Version: st.Version + 1, Members: []uuid.UUID{}, Queue: []queueItem{}, SessionID: st.SessionID})
		sent := map[uuid.UUID]bool{}
		for _, u := range append(append([]uuid.UUID{}, meta.audience...), st.Members...) {
			if !sent[u] {
				sent[u] = true
				a.Hub.Send(u, e)
			}
		}
	}
	a.rooms.mu.Lock()
	a.rooms.init()
	for u, rid := range a.rooms.user {
		if rid == id {
			delete(a.rooms.user, u)
		}
	}
	if meta.pairID != nil && a.rooms.pair[*meta.pairID] == id {
		delete(a.rooms.pair, *meta.pairID)
	}
	delete(a.rooms.m, id)
	a.rooms.mu.Unlock()
	if meta.jam() {
		a.activityChanged(ctx, meta.host)
	}
}

func (a *api) leaveRoom(ctx context.Context, user uuid.UUID) {
	ctx = withRoom(ctx, a.roomID(ctx))
	t := a.roomOf(ctx)
	now := time.Now().UnixMilli()
	t.mu.Lock()
	st := &t.state
	if !st.Active || !containsID(st.Members, user) {
		t.mu.Unlock()
		return
	}
	if t.meta.jam() && t.meta.host == user {
		t.mu.Unlock()
		a.endLive(ctx)
		return
	}
	t.accrue(now)
	st.Members = removeID(st.Members, user)
	if len(st.Members) == 0 && st.Playing {
		st.PositionAtStartMs = st.position(now)
		st.Playing = false
	}
	st.Version++
	jam, host := t.meta.jam(), t.meta.host
	t.mu.Unlock()
	if rid, ok := a.userRoom(user); ok && rid == a.roomID(ctx) {
		a.setUserRoom(user, uuid.Nil)
	}
	a.saveLive(ctx, false)
	a.publishRoom(ctx)
	if jam {
		a.activityChanged(ctx, host)
	}
}

func (a *api) joinRoom(ctx context.Context, user uuid.UUID) bool {
	id := a.roomID(ctx)
	if prev, ok := a.userRoom(user); ok && prev != id {
		a.leaveRoom(withRoom(ctx, prev), user)
	}
	ctx = withRoom(ctx, id)
	t := a.roomOf(ctx)
	t.mu.Lock()
	st := &t.state
	if !st.Active {
		t.mu.Unlock()
		return false
	}
	joined := false
	if !containsID(st.Members, user) {
		t.accrue(time.Now().UnixMilli())
		st.Members = append(st.Members, user)
		st.Version++
		joined = true
	}
	jam, host := t.meta.jam(), t.meta.host
	t.mu.Unlock()
	a.setUserRoom(user, id)
	if joined {
		a.saveLive(ctx, false)
		if jam {
			a.activityChanged(ctx, host)
		}
	}
	a.publishRoom(ctx)
	return true
}

func (a *api) canSeeSession(ctx context.Context, user, id uuid.UUID) (*store.ListeningSession, bool) {
	sess, err := a.Store.ListeningSessionByID(a.spaceFor(ctx, user), id)
	if err != nil || sess.Status != "live" {
		return nil, false
	}
	return sess, true
}

func (a *api) registerTogether() {
	a.Hub.Handle("room.join", func(ctx context.Context, user uuid.UUID, e realtime.Event, reply func(realtime.Event)) {
		ctx = a.spaceFor(ctx, user)
		var c struct {
			SessionID *uuid.UUID `json:"session_id"`
		}
		_ = json.Unmarshal(e.Data, &c)
		if c.SessionID != nil {
			sess, ok := a.canSeeSession(ctx, user, *c.SessionID)
			if !ok {
				reply(realtime.NewEvent("room.denied", map[string]any{"session_id": *c.SessionID}))
				return
			}
			if !a.room(sess.ID).state.Active {
				a.goLive(ctx, sess, uuid.Nil)
			}
			ctx = withRoom(ctx, sess.ID)
		}
		a.joinRoom(ctx, user)
	})
	a.Hub.Handle("room.leave", func(ctx context.Context, user uuid.UUID, _ realtime.Event, reply func(realtime.Event)) {
		ctx = a.spaceFor(ctx, user)
		id, ok := a.userRoom(user)
		if !ok {
			return
		}
		a.leaveRoom(withRoom(ctx, id), user)
		st := a.together(ctx)
		if st.SessionID == uuid.Nil || !st.Active {
			st = roomState{Version: st.Version, Members: []uuid.UUID{}, Queue: []queueItem{}}
		}
		reply(realtime.NewEvent("room.state", st))
	})
	a.Hub.Handle("room.react", func(ctx context.Context, user uuid.UUID, e realtime.Event, _ func(realtime.Event)) {
		ctx = a.spaceFor(ctx, user)
		id, ok := a.userRoom(user)
		if !ok {
			return
		}
		ctx = withRoom(ctx, id)
		var c struct {
			Emoji string `json:"emoji"`
		}
		st := a.together(ctx)
		if json.Unmarshal(e.Data, &c) != nil || !sessionReactions[c.Emoji] || !st.Active || !containsID(st.Members, user) {
			return
		}
		ev := realtime.NewEvent("session.reaction", map[string]any{"session_id": st.SessionID, "from": user, "emoji": c.Emoji})
		for _, u := range st.Members {
			a.Hub.Send(u, ev)
		}
	})
	a.Hub.Handle("room.command", func(ctx context.Context, user uuid.UUID, e realtime.Event, reply func(realtime.Event)) {
		ctx = a.spaceFor(ctx, user)
		rid, inRoom := a.userRoom(user)
		if !inRoom {
			return
		}
		ctx = withRoom(ctx, rid)
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
		t := a.roomOf(ctx)
		t.mu.Lock()
		meta := t.meta
		t.mu.Unlock()
		if meta.jam() && user != meta.host {
			switch c.Action {
			case "end":
				return
			case "queue.add", "playnow":
				if !meta.anyoneAdd {
					reply(realtime.NewEvent("room.denied", map[string]any{"action": c.Action}))
					return
				}
			default:
				if !meta.anyoneSkip {
					reply(realtime.NewEvent("room.denied", map[string]any{"action": c.Action}))
					return
				}
			}
		}
		if c.Action == "end" {
			if st := a.together(ctx); st.Active && containsID(st.Members, user) {
				a.endLive(ctx)
			}
			return
		}
		now := time.Now().UnixMilli()
		at := now + commandLead
		t.mu.Lock()
		st := &t.state
		if !st.Active || !containsID(st.Members, user) {
			t.mu.Unlock()
			return
		}
		t.accrue(now)
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
		t.mu.Unlock()
		if !changed {
			return
		}
		a.publishRoom(ctx)
		if queueChanged {
			a.saveLiveQueue(ctx)
		}
		a.saveLive(ctx, played)
	})
}

func (a *api) togetherState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"room": a.together(r.Context()), "server_ts": time.Now().UnixMilli()})
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
