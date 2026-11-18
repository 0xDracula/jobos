package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type starter interface {
	StartChart(ctx context.Context, country string) (json.RawMessage, error)
	StartArtist(ctx context.Context, browseID string) (json.RawMessage, error)
	StartSearch(ctx context.Context, query string) (json.RawMessage, error)
}

type historyStore interface {
	HasHistory(ctx context.Context, userID uuid.UUID) (bool, error)
}

var (
	countryRE  = regexp.MustCompile(`^[A-Za-z]{2}$`)
	browseIDRE = regexp.MustCompile(`^[A-Za-z0-9_-]{10,64}$`)
)

const (
	startTTL       = 6 * time.Hour
	startMaxPicks  = 30
	startSongPicks = 12
	startDoneKey   = "start.done"
)

var startCache = struct {
	sync.Mutex
	m map[string]startEntry
}{m: map[string]startEntry{}}

type startEntry struct {
	body json.RawMessage
	at   time.Time
}

func startCached(key string, fetch func() (json.RawMessage, error)) (json.RawMessage, error) {
	startCache.Lock()
	e, ok := startCache.m[key]
	startCache.Unlock()
	if ok && time.Since(e.at) < startTTL {
		return e.body, nil
	}
	body, err := fetch()
	if err != nil {
		return nil, err
	}
	startCache.Lock()
	startCache.m[key] = startEntry{body: body, at: time.Now()}
	startCache.Unlock()
	return body, nil
}

func (a *api) registerStartRoutes(r chi.Router) {
	r.Get("/start", a.startState)
	r.Post("/start", a.saveStart)
	r.Get("/start/chart", a.startChart)
	r.Get("/start/search", a.startSearch)
	r.Get("/start/artists/{id}", a.startArtist)
}

func (a *api) starter(w http.ResponseWriter) (starter, bool) {
	s, ok := a.Media.(starter)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "Artists unavailable")
	}
	return s, ok
}

func (a *api) startState(w http.ResponseWriter, r *http.Request) {
	me := uid(r)
	if raw, err := a.Store.UserSetting(r.Context(), me, startDoneKey); err != nil {
		a.serverError(w, "start state", err)
		return
	} else if raw != nil {
		writeJSON(w, http.StatusOK, map[string]bool{"show": false})
		return
	}
	hs, ok := a.Store.(historyStore)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]bool{"show": false})
		return
	}
	has, err := hs.HasHistory(r.Context(), me)
	if err != nil {
		a.serverError(w, "start history", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"show": !has})
}

func (a *api) startChart(w http.ResponseWriter, r *http.Request) {
	country := strings.ToUpper(r.URL.Query().Get("country"))
	if !countryRE.MatchString(country) {
		country = "ZZ"
	}
	s, ok := a.starter(w)
	if !ok {
		return
	}
	body, err := startCached("chart:"+country, func() (json.RawMessage, error) { return s.StartChart(r.Context(), country) })
	if err != nil {
		a.Log.Warn("start chart", "country", country, "err", err)
		writeError(w, http.StatusBadGateway, "Artists unavailable")
		return
	}
	writeRaw(w, body)
}

func (a *api) startArtist(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !browseIDRE.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid artist")
		return
	}
	s, ok := a.starter(w)
	if !ok {
		return
	}
	body, err := startCached("artist:"+id, func() (json.RawMessage, error) { return s.StartArtist(r.Context(), id) })
	if err != nil {
		a.Log.Warn("start artist", "id", id, "err", err)
		writeError(w, http.StatusBadGateway, "Artist unavailable")
		return
	}
	writeRaw(w, body)
}

func (a *api) startSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeError(w, http.StatusBadRequest, "q needs 1 to 200 characters")
		return
	}
	s, ok := a.starter(w)
	if !ok {
		return
	}
	body, err := startCached("search:"+strings.ToLower(q), func() (json.RawMessage, error) { return s.StartSearch(r.Context(), q) })
	if err != nil {
		a.Log.Warn("start search", "err", err)
		writeError(w, http.StatusBadGateway, "Search unavailable")
		return
	}
	writeRaw(w, body)
}

func (a *api) saveStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Artists []struct {
			ID    string  `json:"id"`
			Name  string  `json:"name"`
			Image *string `json:"image"`
		} `json:"artists"`
		Skip bool `json:"skip"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	ctx, me := r.Context(), uid(r)
	if len(in.Artists) > startMaxPicks {
		writeError(w, http.StatusBadRequest, "30 artists at most")
		return
	}
	var picks []store.StartArtist
	if !in.Skip {
		s, ok := a.starter(w)
		if !ok {
			return
		}
		for i, p := range in.Artists {
			name := strings.TrimSpace(p.Name)
			if !browseIDRE.MatchString(p.ID) || name == "" || len(name) > 200 {
				writeError(w, http.StatusBadRequest, "invalid artist")
				return
			}
			pick := store.StartArtist{ID: p.ID, Name: name, Image: p.Image}
			if i < startSongPicks {
				id := p.ID
				if body, err := startCached("artist:"+id, func() (json.RawMessage, error) { return s.StartArtist(ctx, id) }); err == nil {
					var art struct {
						Songs []store.StartSong `json:"songs"`
					}
					if json.Unmarshal(body, &art) == nil {
						pick.Songs = art.Songs
					}
				} else {
					a.Log.Warn("start artist songs", "id", id, "err", err)
				}
			}
			picks = append(picks, pick)
		}
		raw, err := json.Marshal(picks)
		if err != nil {
			a.serverError(w, "encode picks", err)
			return
		}
		if err := a.Store.SetSetting(ctx, me, store.StartPicksKey, raw); err != nil {
			a.serverError(w, "save picks", err)
			return
		}
	}
	done, _ := json.Marshal(time.Now())
	if err := a.Store.SetSetting(ctx, me, startDoneKey, done); err != nil {
		a.serverError(w, "finish start", err)
		return
	}
	if len(picks) > 0 {
		if _, err := a.Store.EnqueueCandidates(ctx, me, time.Now()); err != nil {
			a.Log.Warn("start candidates", "err", err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeRaw(w http.ResponseWriter, body json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
