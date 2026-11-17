package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

type SessionsStore interface {
	ListeningSessions(ctx context.Context) ([]store.ListeningSession, error)
	ListeningSessionByID(ctx context.Context, id uuid.UUID) (*store.ListeningSession, error)
	SessionItems(ctx context.Context, id uuid.UUID) ([]store.SessionItem, error)
	CreateListeningSession(ctx context.Context, by uuid.UUID, title string, scheduledAt *time.Time, trackIDs []uuid.UUID) (uuid.UUID, error)
	UpdateListeningSession(ctx context.Context, id uuid.UUID, title string, scheduledAt *time.Time) error
	DeleteListeningSession(ctx context.Context, id uuid.UUID) error
	AddSessionItems(ctx context.Context, id, by uuid.UUID, trackIDs []uuid.UUID, at int) error
	RemoveSessionItem(ctx context.Context, id uuid.UUID, key string) error
	OrderSessionItems(ctx context.Context, id uuid.UUID, keys []string) error
	SetSessionItemNote(ctx context.Context, id uuid.UUID, key, note string) error
	SyncSessionItems(ctx context.Context, id uuid.UUID, items []store.SessionItem) error
	StartSession(ctx context.Context, id uuid.UUID, endIdle *uuid.UUID) error
	SaveSessionLive(ctx context.Context, id uuid.UUID, currentKey string, positionMs, togetherMs int64, members []uuid.UUID) error
	MarkSessionItemPlayed(ctx context.Context, id uuid.UUID, key string) error
	EndSession(ctx context.Context, id uuid.UUID, positionMs, togetherMs int64) error
	LiveSession(ctx context.Context) (*store.ListeningSession, error)
	CopySession(ctx context.Context, id, by uuid.UUID) (uuid.UUID, error)
	PlannedSessionsBetween(ctx context.Context, from, to time.Time) ([]store.ListeningSession, error)
	DueSessionReminders(ctx context.Context, now, until time.Time) ([]store.ListeningSession, error)
}

func init() {
	notifyDefaults["together"] = true
	registerCalendarSource("sessions", sessionEvents)
}

func (a *api) registerSessionRoutes(r chi.Router) {
	r.Get("/sessions", a.listSessions)
	r.Post("/sessions", a.createListening)
	r.Get("/sessions/{id}", a.getListening)
	r.Patch("/sessions/{id}", a.updateListening)
	r.Delete("/sessions/{id}", a.deleteListening)
	r.Post("/sessions/{id}/items", a.addSessionItems)
	r.Put("/sessions/{id}/items/order", a.orderSessionItems)
	r.Patch("/sessions/{id}/items/{key}", a.noteSessionItem)
	r.Delete("/sessions/{id}/items/{key}", a.removeSessionItem)
	r.Post("/sessions/{id}/start", a.startListening)
	r.Post("/sessions/{id}/end", a.endListening)
	r.Post("/sessions/{id}/copy", a.copyListening)
	r.Post("/sessions/{id}/invite", a.inviteListening)
}

func (a *api) sessionChanged(ctx context.Context, id uuid.UUID) {
	a.broadcast(ctx, realtime.NewEvent("session.update", map[string]any{"id": id}))
}

func cleanTitle(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > 80 {
		s = string([]rune(s)[:80])
	}
	return s
}

func (a *api) sessionWhen(t *time.Time) string {
	if t == nil {
		return "Now"
	}
	return t.In(a.homeTZ()).Format("Mon 2 Jan, 3:04 PM")
}

func sessionTitle(s *store.ListeningSession) string {
	if s.Title != "" {
		return s.Title
	}
	return "Listening together"
}

func (a *api) listSessions(w http.ResponseWriter, r *http.Request) {
	list, err := a.Store.ListeningSessions(r.Context())
	if err != nil {
		a.serverError(w, "list sessions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list})
}

func (a *api) createListening(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Title       string      `json:"title"`
		ScheduledAt *time.Time  `json:"scheduled_at"`
		TrackIDs    []uuid.UUID `json:"track_ids"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.ScheduledAt != nil && in.ScheduledAt.Before(time.Now().Add(-time.Hour)) {
		writeError(w, http.StatusBadRequest, "time is in the past")
		return
	}
	id, err := a.Store.CreateListeningSession(r.Context(), uid(r), cleanTitle(in.Title), in.ScheduledAt, in.TrackIDs)
	if err != nil {
		a.serverError(w, "create session", err)
		return
	}
	a.sessionChanged(r.Context(), id)
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (a *api) getListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	s, err := a.Store.ListeningSessionByID(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if err != nil {
		a.serverError(w, "session", err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (a *api) updateListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	var in struct {
		Title       string     `json:"title"`
		ScheduledAt *time.Time `json:"scheduled_at"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	title := cleanTitle(in.Title)
	if err := a.Store.UpdateListeningSession(r.Context(), id, title, in.ScheduledAt); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	} else if err != nil {
		a.serverError(w, "update session", err)
		return
	}
	a.room.mu.Lock()
	if a.room.state.Active && a.room.state.SessionID == id && a.room.state.Title != title {
		a.room.state.Title = title
		a.room.state.Version++
	}
	a.room.mu.Unlock()
	a.publishRoom(r.Context())
	a.sessionChanged(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) deleteListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	if err := a.Store.DeleteListeningSession(r.Context(), id); errors.Is(err, store.ErrSessionState) {
		writeError(w, http.StatusConflict, "a live session can't be deleted")
		return
	} else if err != nil {
		a.serverError(w, "delete session", err)
		return
	}
	a.sessionChanged(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) afterItemsChange(ctx context.Context, id uuid.UUID) {
	if st := a.together(); st.Active && st.SessionID == id {
		if err := a.reloadLiveQueue(ctx, id); err != nil {
			a.Log.Warn("reload live setlist", "err", err)
		}
	}
	a.sessionChanged(ctx, id)
}

func (a *api) addSessionItems(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	var in struct {
		TrackIDs []uuid.UUID `json:"track_ids"`
		At       *int        `json:"at"`
		Next     bool        `json:"next"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.TrackIDs) == 0 {
		writeError(w, http.StatusBadRequest, "track_ids is required")
		return
	}
	at := -1
	if in.At != nil {
		at = *in.At
	}
	if st := a.together(); in.Next && st.Active && st.SessionID == id {
		at = st.Index + 1
	}
	if err := a.Store.AddSessionItems(r.Context(), id, uid(r), in.TrackIDs, at); errors.Is(err, store.ErrSessionState) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("a setlist holds %d songs at most", store.MaxSessionItems))
		return
	} else if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	} else if err != nil {
		a.serverError(w, "add session songs", err)
		return
	}
	a.afterItemsChange(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) removeSessionItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	key := chi.URLParam(r, "key")
	if st := a.together(); st.Active && st.SessionID == id && st.currentKey() == key {
		writeError(w, http.StatusConflict, "the song playing now can't be removed")
		return
	}
	if err := a.Store.RemoveSessionItem(r.Context(), id, key); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "song not in this session")
		return
	} else if err != nil {
		a.serverError(w, "remove session song", err)
		return
	}
	a.afterItemsChange(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) orderSessionItems(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	var in struct {
		Keys []string `json:"keys"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if err := a.Store.OrderSessionItems(r.Context(), id, in.Keys); errors.Is(err, store.ErrNotPermutation) {
		writeError(w, http.StatusBadRequest, "keys must list every song of the session once")
		return
	} else if err != nil {
		a.serverError(w, "order session songs", err)
		return
	}
	a.afterItemsChange(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) noteSessionItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	var in struct {
		Note string `json:"note"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	note := strings.TrimSpace(in.Note)
	if utf8.RuneCountInString(note) > 280 {
		writeError(w, http.StatusBadRequest, "note is 280 characters at most")
		return
	}
	if err := a.Store.SetSessionItemNote(r.Context(), id, chi.URLParam(r, "key"), note); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "song not in this session")
		return
	} else if err != nil {
		a.serverError(w, "note session song", err)
		return
	}
	a.sessionChanged(r.Context(), id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) startListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	ctx := r.Context()
	var endIdle *uuid.UUID
	if st := a.together(); st.Active && st.SessionID != id && len(st.Members) == 0 {
		idle := st.SessionID
		endIdle = &idle
	}
	switch err := a.Store.StartSession(ctx, id, endIdle); {
	case errors.Is(err, store.ErrSessionLive):
		writeError(w, http.StatusConflict, "another session is live")
		return
	case errors.Is(err, store.ErrSessionState):
		writeError(w, http.StatusConflict, "this session isn't planned")
		return
	case err != nil:
		a.serverError(w, "start session", err)
		return
	}
	if endIdle != nil {
		a.sessionChanged(ctx, *endIdle)
	}
	sess, err := a.Store.ListeningSessionByID(ctx, id)
	if err != nil {
		a.serverError(w, "session", err)
		return
	}
	me := currentUser(r)
	a.goLive(sess, me.ID)
	a.saveLive(true)
	a.publishRoom(ctx)
	a.sessionChanged(ctx, id)
	for _, u := range a.others(ctx, me.ID) {
		a.notify(u.ID, "together", me.DisplayName, "Started "+sessionTitle(sess), "/together/?id="+id.String())
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) endListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	if st := a.together(); !st.Active || st.SessionID != id {
		writeError(w, http.StatusConflict, "this session isn't live")
		return
	}
	a.endLive(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) copyListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	nid, err := a.Store.CopySession(r.Context(), id, uid(r))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if err != nil {
		a.serverError(w, "copy session", err)
		return
	}
	a.sessionChanged(r.Context(), nid)
	writeJSON(w, http.StatusCreated, map[string]any{"id": nid})
}

func (a *api) inviteListening(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "session")
	if !ok {
		return
	}
	ctx := r.Context()
	sess, err := a.Store.ListeningSessionByID(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	if err != nil {
		a.serverError(w, "session", err)
		return
	}
	if sess.Status == "ended" {
		writeError(w, http.StatusConflict, "this session has ended")
		return
	}
	me := currentUser(r)
	data, _ := json.Marshal(map[string]any{"session_id": sess.ID, "title": sessionTitle(sess), "scheduled_at": sess.ScheduledAt, "songs": sess.ItemCount})
	m, created, err := a.Store.SendChat(ctx, me.ID, store.ChatInput{ClientKey: "session-" + uuid.NewString(), Kind: "session", Body: sessionTitle(sess), Data: data})
	if err != nil {
		a.serverError(w, "session card", err)
		return
	}
	if created {
		a.broadcast(ctx, realtime.NewEvent("chat.message", m))
	}
	when := a.sessionWhen(sess.ScheduledAt)
	for _, u := range a.others(ctx, me.ID) {
		a.notify(u.ID, "together", me.DisplayName, sessionTitle(sess)+" · "+when, "/together/?id="+id.String())
	}
	w.WriteHeader(http.StatusNoContent)
}

func sessionEvents(ctx context.Context, a *api, _ *store.User, from, to time.Time) ([]CalendarEvent, error) {
	list, err := a.Store.PlannedSessionsBetween(ctx, from, to.AddDate(0, 0, 1))
	if err != nil {
		return nil, err
	}
	tz := a.homeTZ()
	out := make([]CalendarEvent, 0, len(list))
	for i := range list {
		s := &list[i]
		at := s.ScheduledAt.In(tz)
		out = append(out, CalendarEvent{
			ID: "session:" + s.ID.String(), Kind: "listening_date", Title: sessionTitle(s),
			Date: at.Format("2006-01-02"), Time: at.Format("15:04"), Link: "/together/?id=" + s.ID.String(), AuthorID: s.CreatedBy.String(),
		})
	}
	return out, nil
}

func SendSessionReminders(ctx context.Context, d Deps, now time.Time) {
	if d.Store == nil {
		return
	}
	a := &api{Deps: d}
	due, err := d.Store.DueSessionReminders(ctx, now, now.Add(10*time.Minute))
	if err != nil {
		d.Log.Warn("session reminders", "err", err)
		return
	}
	for i := range due {
		s := &due[i]
		for _, u := range a.memberList(ctx) {
			a.notify(u.ID, "together", sessionTitle(s), "Starts at "+s.ScheduledAt.In(a.homeTZ()).Format("3:04 PM"), "/together/?id="+s.ID.String())
		}
	}
}
