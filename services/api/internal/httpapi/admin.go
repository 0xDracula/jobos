package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"jobbos/api/internal/store"
)

type StatusReader interface {
	Status(ctx context.Context) (json.RawMessage, error)
}

type workerSeen struct {
	LastClaimAt          time.Time  `json:"last_claim_at"`
	DownloadsPausedUntil *time.Time `json:"downloads_paused_until,omitempty"`
}

func (a *api) seeWorker(id string, pausedS int) {
	if id == "" {
		return
	}
	seen := workerSeen{LastClaimAt: time.Now()}
	if pausedS > 0 {
		until := seen.LastClaimAt.Add(time.Duration(pausedS) * time.Second)
		seen.DownloadsPausedUntil = &until
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.workers[id] = seen
	for k, v := range a.workers {
		if time.Since(v.LastClaimAt) > 24*time.Hour {
			delete(a.workers, k)
		}
	}
}

func (a *api) adminStatus(w http.ResponseWriter, r *http.Request) {
	st, err := a.Store.AdminStatus(r.Context())
	if err != nil {
		a.serverError(w, "admin status", err)
		return
	}
	var media json.RawMessage
	if a.MediaStatus != nil {
		if media, err = a.MediaStatus.Status(r.Context()); err != nil {
			a.Log.Warn("media status", "err", err)
			media = nil
		}
	}
	a.mu.Lock()
	workers := make(map[string]workerSeen, len(a.workers))
	for k, v := range a.workers {
		workers[k] = v
	}
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"media": media, "workers": workers, "store": st})
}

func (a *api) retryJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	err = a.Store.RetryJob(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no failed job with this id")
		return
	}
	if err != nil {
		a.serverError(w, "retry job", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) syncNow(w http.ResponseWriter, r *http.Request) {
	SyncPlaylists(r.Context(), a.Deps, 0)
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) clearCache(w http.ResponseWriter, r *http.Request) {
	files, err := a.Store.ClearUnpinned(r.Context())
	if err != nil {
		a.serverError(w, "clear cache", err)
		return
	}
	root, _ := filepath.Abs(a.MediaRoot)
	var removed int
	var bytes int64
	for _, f := range files {
		full := filepath.Join(root, filepath.FromSlash(f.Path))
		if !strings.HasPrefix(full, root+string(filepath.Separator)) {
			continue
		}
		if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
			a.Log.Warn("remove cached file", "path", f.Path, "err", err)
			continue
		}
		removed++
		bytes += f.Bytes
	}
	a.Log.Info("cache cleared", "files", removed, "bytes", bytes)
	writeJSON(w, http.StatusOK, map[string]any{"files": removed, "bytes": bytes})
}
