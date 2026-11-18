package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/realtime"
	"jobbos/api/internal/store"
)

func (a *api) me(w http.ResponseWriter, r *http.Request) {
	u, err := a.Store.User(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "load user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *api) members(w http.ResponseWriter, r *http.Request) {
	users := a.memberList(r.Context())
	if users == nil {
		users = []store.User{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (a *api) registerDevice(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID       *uuid.UUID `json:"id"`
		Name     string     `json:"name"`
		Platform string     `json:"platform"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 100 || len(in.Platform) > 50 {
		writeError(w, http.StatusBadRequest, "name is required (100 characters at most)")
		return
	}
	id, err := a.Store.RegisterDevice(r.Context(), uid(r), in.ID, in.Name, in.Platform)
	if err != nil {
		a.serverError(w, "register device", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (a *api) settings(w http.ResponseWriter, r *http.Request) {
	s, err := a.Store.Settings(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "load settings", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": s})
}

func (a *api) setSetting(w http.ResponseWriter, r *http.Request) {
	value, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "setting value must be JSON of 16 KB at most")
		return
	}
	if err := a.Store.SetSetting(r.Context(), uid(r), chi.URLParam(r, "key"), value); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func trackParam(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		writeError(w, http.StatusNotFound, "not found")
		return id, false
	}
	return id, true
}

func (a *api) likes(w http.ResponseWriter, r *http.Request) {
	sort := r.URL.Query().Get("sort")
	if sort == "" {
		sort = "added"
	}
	tracks, err := a.Store.Likes(r.Context(), uid(r), sort)
	if err != nil {
		writeError(w, http.StatusBadRequest, "sort must be added, title or artist")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) likedIDs(w http.ResponseWriter, r *http.Request) {
	ids, err := a.Store.LikedIDs(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "liked ids", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ids": ids})
}

func (a *api) setLike(w http.ResponseWriter, r *http.Request) {
	id, ok := trackParam(w, r, "trackID")
	if !ok {
		return
	}
	var err error
	if r.Method == http.MethodDelete {
		err = a.Store.Unlike(r.Context(), uid(r), id)
	} else {
		err = a.Store.Like(r.Context(), uid(r), id)
	}
	a.noContent(w, "like", err)
}

func (a *api) noContent(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case err != nil:
		a.serverError(w, what, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *api) hidden(w http.ResponseWriter, r *http.Request) {
	tracks, artists, err := a.Store.Hidden(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "hidden", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks, "artists": artists})
}

func (a *api) hiddenIDs(w http.ResponseWriter, r *http.Request) {
	tracks, artists, err := a.Store.HiddenIDs(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "hidden ids", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks, "artists": artists})
}

func (a *api) setHidden(w http.ResponseWriter, r *http.Request) {
	kind := chi.URLParam(r, "type")
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil || !store.HiddenTypes[kind] {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method == http.MethodDelete {
		err = a.Store.Unhide(r.Context(), uid(r), kind, id)
	} else {
		err = a.Store.Hide(r.Context(), uid(r), kind, id)
	}
	a.noContent(w, "hide", err)
}

func (a *api) events(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Events []store.ListeningEvent `json:"events"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.Events) == 0 || len(in.Events) > 200 {
		writeError(w, http.StatusBadRequest, "events must hold 1 to 200 events")
		return
	}
	for _, e := range in.Events {
		if err := e.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := a.Store.RecordEvents(r.Context(), uid(r), in.Events); err != nil {
		a.serverError(w, "record events", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func intParam(r *http.Request, name string, fallback, max int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || n <= 0 || n > max {
		return fallback
	}
	return n
}

func (a *api) recentlyPlayed(w http.ResponseWriter, r *http.Request) {
	tracks, err := a.Store.RecentlyPlayed(r.Context(), uid(r), intParam(r, "limit", 50, 200))
	if err != nil {
		a.serverError(w, "recently played", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) mostPlayed(w http.ResponseWriter, r *http.Request) {
	tracks, err := a.Store.MostPlayed(r.Context(), uid(r), intParam(r, "days", 30, 3650), intParam(r, "limit", 50, 200))
	if err != nil {
		a.serverError(w, "most played", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tracks": tracks})
}

func (a *api) savePlayback(w http.ResponseWriter, r *http.Request) {
	var in store.PlaybackState
	if !readJSON(w, r, &in) {
		return
	}
	if in.Repeat == "" {
		in.Repeat = "off"
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.Store.SavePlayback(r.Context(), uid(r), in); err != nil {
		a.serverError(w, "save playback", err)
		return
	}
	a.announcePlaying(r, in.Playing)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) announcePlaying(r *http.Request, playing bool) {
	me := currentUser(r)
	if prev, ok := a.playing.Swap(me.ID, playing); ok && prev.(bool) == playing {
		return
	}
	if a.Hub == nil {
		return
	}
	modes := a.visibility(r.Context())
	e := realtime.NewEvent("presence.update", map[string]any{"user_id": me.ID, "listening": playing})
	for _, u := range a.others(r.Context(), me.ID) {
		u := u
		if canSee(modes, &u, me, "listening_status") {
			a.Hub.Send(u.ID, e)
		}
	}
}

func (a *api) playback(w http.ResponseWriter, r *http.Request) {
	states, err := a.Store.Playback(r.Context(), uid(r))
	if err != nil {
		a.serverError(w, "playback", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"states": states})
}
