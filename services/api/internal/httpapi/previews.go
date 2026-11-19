package httpapi

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func (a *api) registerPreviewRoutes(r chi.Router) {
	r.Get("/previews", a.previews)
	r.Post("/previews/{track}/react", a.reactPreview)
	r.Get("/tracks/{id}/highlight", a.trackHighlight)
}

var previewRuns = struct {
	sync.Mutex
	at      map[uuid.UUID]time.Time
	running map[uuid.UUID]bool
}{at: map[uuid.UUID]time.Time{}, running: map[uuid.UUID]bool{}}

const (
	previewRefreshEvery = 20 * time.Hour
	previewRetryEvery   = 10 * time.Minute
	previewLowWater     = 6
)

func (a *api) refreshPreviews(s socialStore, user uuid.UUID) bool {
	previewRuns.Lock()
	if previewRuns.running[user] || time.Since(previewRuns.at[user]) < previewRetryEvery {
		previewRuns.Unlock()
		return false
	}
	previewRuns.running[user] = true
	previewRuns.at[user] = time.Now()
	previewRuns.Unlock()
	go func() {
		defer func() {
			previewRuns.Lock()
			delete(previewRuns.running, user)
			previewRuns.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		ctx = a.spaceFor(ctx, user)
		if n, err := s.GeneratePreviews(ctx, user, time.Now(), a.homeTZ()); err != nil {
			a.Log.Warn("previews", "user", user, "err", err)
		} else if n > 0 {
			a.Log.Info("previews", "user", user, "added", n)
		}
	}()
	return true
}

func (a *api) previews(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = store.PreviewsForYou
	}
	if mode != store.PreviewsForYou && mode != store.PreviewsFriends {
		writeError(w, http.StatusBadRequest, "mode must be you or friends")
		return
	}
	ctx := r.Context()
	me := uid(r)
	list, err := s.Previews(ctx, me, mode, 60)
	if err != nil {
		a.serverError(w, "previews", err)
		return
	}
	unseen := 0
	for _, p := range list {
		if !p.Seen {
			unseen++
		}
	}
	growing := false
	at, err := s.PreviewsGeneratedAt(ctx, me)
	if err == nil && (unseen < previewLowWater || time.Since(at) > previewRefreshEvery) {
		growing = a.refreshPreviews(s, me)
	}
	writeJSON(w, http.StatusOK, map[string]any{"previews": list, "growing": growing})
}

func (a *api) reactPreview(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "track"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}
	var in struct {
		Reaction string `json:"reaction"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Reaction != "" && !store.PreviewReactions[in.Reaction] {
		writeError(w, http.StatusBadRequest, "reaction must be like, skip, add, send or full")
		return
	}
	if err := s.ReactPreview(r.Context(), uid(r), id, in.Reaction); err != nil {
		a.serverError(w, "react to preview", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) trackHighlight(w http.ResponseWriter, r *http.Request) {
	s := a.needSocial(w)
	if s == nil {
		return
	}
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	h, err := s.TrackHighlight(r.Context(), id)
	if err != nil {
		a.serverError(w, "highlight", err)
		return
	}
	if h == nil {
		if err := s.EnqueueHighlights(r.Context(), []uuid.UUID{id}, store.PriorityInteractive); err != nil {
			a.Log.Warn("queue highlight", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"highlight": h})
}
