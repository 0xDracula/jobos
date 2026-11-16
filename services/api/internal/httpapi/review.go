package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func (a *api) registerReviewRoutes(r chi.Router) {
	r.Get("/review", a.reviewList)
	r.Put("/review/{id}", a.setMatchCheck)
	r.Get("/tracks/{id}/lyrics", a.adminLyrics)
	r.Put("/tracks/{id}/lyrics", a.setLyrics)
	r.Get("/listening", a.adminListening)
}

func (a *api) reviewList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list := q.Get("list")
	if list == "" {
		list = "review"
	}
	if _, ok := store.ReviewLists[list]; !ok {
		writeError(w, http.StatusBadRequest, "unknown list")
		return
	}
	var playlist *uuid.UUID
	if p := q.Get("playlist"); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid playlist")
			return
		}
		playlist = &id
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 500
	}
	items, err := a.Store.ReviewList(r.Context(), list, playlist, limit)
	if err != nil {
		a.serverError(w, "review list", err)
		return
	}
	counts, err := a.Store.ReviewCounts(r.Context(), playlist)
	if err != nil {
		a.serverError(w, "review counts", err)
		return
	}
	if items == nil {
		items = []store.ReviewItem{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "counts": counts})
}

func (a *api) setMatchCheck(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	var in struct {
		Verdict string `json:"verdict"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Verdict != "" && in.Verdict != "correct" && in.Verdict != "wrong" {
		writeError(w, http.StatusBadRequest, "verdict must be correct or wrong")
		return
	}
	if err := a.Store.SetMatchCheck(r.Context(), id, uid(r), in.Verdict); err != nil {
		a.serverError(w, "match check", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) adminLyrics(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	v, err := a.Store.Lyrics(r.Context(), id)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		a.serverError(w, "lyrics", err)
		return
	}
	lrc, err := a.Store.SyncedLRC(r.Context(), id)
	if err != nil {
		a.serverError(w, "lyrics", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lyrics": v, "synced_lrc": lrc})
}

func (a *api) setLyrics(w http.ResponseWriter, r *http.Request) {
	id, ok := urlID(w, r, "track")
	if !ok {
		return
	}
	var in struct {
		SyncedLRC    string `json:"synced_lrc"`
		Plain        string `json:"plain"`
		Instrumental bool   `json:"instrumental"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if len(in.SyncedLRC)+len(in.Plain) > 200_000 {
		writeError(w, http.StatusBadRequest, "lyrics too long")
		return
	}
	if strings.TrimSpace(in.SyncedLRC) != "" {
		if _, err := store.ParseLRC(in.SyncedLRC); err != nil {
			writeError(w, http.StatusBadRequest, "invalid LRC: "+err.Error())
			return
		}
	}
	if err := a.Store.SetLyrics(r.Context(), id, in.SyncedLRC, in.Plain, in.Instrumental); err != nil {
		a.serverError(w, "save lyrics", err)
		return
	}
	a.adminLyrics(w, r)
}

func (a *api) adminListening(w http.ResponseWriter, r *http.Request) {
	now, err := a.Store.ListeningNow(r.Context())
	if err != nil {
		a.serverError(w, "listening", err)
		return
	}
	list := make([]store.NowPlaying, 0, len(now))
	ids := make([]uuid.UUID, 0, len(now))
	for _, n := range now {
		list = append(list, n)
		ids = append(ids, n.TrackID)
	}
	tracks, err := a.Store.TracksByID(r.Context(), ids)
	if err != nil {
		a.serverError(w, "listening", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"playing": list, "tracks": tracks})
}
