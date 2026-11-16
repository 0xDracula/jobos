package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

type Store interface {
	AddTrackFromSource(ctx context.Context, in store.SourceTrack) (uuid.UUID, uuid.UUID, bool, error)
	HasMainMedia(ctx context.Context, trackID uuid.UUID) (bool, error)
	Track(ctx context.Context, id uuid.UUID) (*store.TrackView, error)
	AssetBySHA(ctx context.Context, sha string) (string, string, error)
	Enqueue(ctx context.Context, queue, kind string, payload any, dedupeKey string) (int64, bool, error)
	ClaimJob(ctx context.Context, queue, worker string, kinds []string) (*store.Job, error)
	CompleteJob(ctx context.Context, id int64, result json.RawMessage) error
	FailJob(ctx context.Context, id int64, message string) error
}

type Searcher interface {
	Search(ctx context.Context, query string, limit int) (json.RawMessage, error)
}

type Deps struct {
	Store       Store
	Media       Searcher
	MediaRoot   string
	WorkerToken string
	Log         *slog.Logger
}

type api struct{ Deps }

var mediaFileRE = regexp.MustCompile(`^([0-9a-f]{64})\.m4a$`)

func New(d Deps) http.Handler {
	a := &api{d}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) })

	r.Route("/api", func(r chi.Router) {
		r.Get("/search", a.search)
		r.Post("/tracks", a.addTrack)
		r.Get("/tracks/{id}", a.track)
		r.Get("/tracks/{id}/audio", a.trackAudio)
		r.Get("/media/{file}", a.mediaFile)
	})
	r.Route("/internal", func(r chi.Router) {
		r.Use(a.requireWorker)
		r.Post("/jobs/claim", a.claimJob)
		r.Post("/jobs/{id}/complete", a.completeJob)
		r.Post("/jobs/{id}/fail", a.failJob)
	})
	return r
}

func (a *api) search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 200 {
		writeError(w, http.StatusBadRequest, "q is required (200 characters at most)")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	body, err := a.Media.Search(r.Context(), q, limit)
	if err != nil {
		a.Log.Error("search", "err", err)
		writeError(w, http.StatusBadGateway, "search is unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func (a *api) addTrack(w http.ResponseWriter, r *http.Request) {
	var in store.SourceTrack
	if !readJSON(w, r, &in) {
		return
	}
	if err := in.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	trackID, sourceID, created, err := a.Store.AddTrackFromSource(r.Context(), in)
	if err != nil {
		a.serverError(w, "add track", err)
		return
	}
	cached, err := a.Store.HasMainMedia(r.Context(), trackID)
	if err != nil {
		a.serverError(w, "check media", err)
		return
	}
	if !cached {
		payload := store.DownloadPayload{TrackID: trackID, SourceID: sourceID, Provider: in.Provider, ExternalID: in.ExternalID}
		if _, _, err := a.Store.Enqueue(r.Context(), "default", store.KindDownloadTrack, payload, store.DownloadKey(sourceID)); err != nil {
			a.serverError(w, "enqueue download", err)
			return
		}
	}
	view, err := a.Store.Track(r.Context(), trackID)
	if err != nil {
		a.serverError(w, "load track", err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, view)
}

func (a *api) track(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if ok {
		writeJSON(w, http.StatusOK, view)
	}
}

func (a *api) trackAudio(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if !ok {
		return
	}
	if view.Audio == nil {
		writeJSON(w, http.StatusAccepted, map[string]any{"status": view.Status, "error": view.Error})
		return
	}
	http.Redirect(w, r, view.Audio.URL, http.StatusTemporaryRedirect)
}

func (a *api) loadTrack(w http.ResponseWriter, r *http.Request) (*store.TrackView, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return nil, false
	}
	view, err := a.Store.Track(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "track not found")
		return nil, false
	}
	if err != nil {
		a.serverError(w, "load track", err)
		return nil, false
	}
	return view, true
}

func (a *api) mediaFile(w http.ResponseWriter, r *http.Request) {
	m := mediaFileRE.FindStringSubmatch(chi.URLParam(r, "file"))
	if m == nil {
		http.NotFound(w, r)
		return
	}
	sha := m[1]
	rel, mime, err := a.Store.AssetBySHA(r.Context(), sha)
	if errors.Is(err, store.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		a.serverError(w, "load asset", err)
		return
	}
	root, _ := filepath.Abs(a.MediaRoot)
	full := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(full, root+string(filepath.Separator)) {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		a.serverError(w, "open asset", err)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		a.serverError(w, "stat asset", err)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("ETag", `"`+sha+`"`)
	http.ServeContent(w, r, sha+".m4a", info.ModTime(), f)
}

func (a *api) requireWorker(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || a.WorkerToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(a.WorkerToken)) != 1 {
			writeError(w, http.StatusUnauthorized, "worker token required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *api) claimJob(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Queue  string   `json:"queue"`
		Worker string   `json:"worker"`
		Kinds  []string `json:"kinds"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if in.Queue == "" {
		in.Queue = "default"
	}
	job, err := a.Store.ClaimJob(r.Context(), in.Queue, in.Worker, in.Kinds)
	if err != nil {
		a.serverError(w, "claim job", err)
		return
	}
	if job == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (a *api) completeJob(w http.ResponseWriter, r *http.Request) {
	id, ok := jobID(w, r)
	if !ok {
		return
	}
	var in struct {
		Result json.RawMessage `json:"result"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.finishJob(w, "complete job", a.Store.CompleteJob(r.Context(), id, in.Result))
}

func (a *api) failJob(w http.ResponseWriter, r *http.Request) {
	id, ok := jobID(w, r)
	if !ok {
		return
	}
	var in struct {
		Error string `json:"error"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	a.finishJob(w, "fail job", a.Store.FailJob(r.Context(), id, in.Error))
}

func (a *api) finishJob(w http.ResponseWriter, what string, err error) {
	switch {
	case errors.Is(err, store.ErrJobNotRunning):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil:
		a.serverError(w, what, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func jobID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return 0, false
	}
	return id, true
}

func (a *api) serverError(w http.ResponseWriter, what string, err error) {
	a.Log.Error(what, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
