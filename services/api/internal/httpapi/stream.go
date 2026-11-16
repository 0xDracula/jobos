package httpapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"jobbos/api/internal/media"
	"jobbos/api/internal/store"
)

type Resolver interface {
	Resolve(ctx context.Context, provider, externalID string) (*media.Stream, error)
}

type cachedStream struct {
	stream *media.Stream
	until  time.Time
}

const streamTTL = 30 * time.Minute

func (a *api) streamTrack(w http.ResponseWriter, r *http.Request) {
	view, ok := a.loadTrack(w, r)
	if !ok {
		return
	}
	if view.Audio != nil {
		http.Redirect(w, r, view.Audio.URL, http.StatusTemporaryRedirect)
		return
	}
	if view.Source == nil {
		writeError(w, http.StatusConflict, "track has no recording")
		return
	}
	if err := a.enqueueDownload(r.Context(), view.ID, view.Source.ID, view.Source.Provider, view.Source.ExternalID); err != nil {
		a.Log.Error("enqueue download", "err", err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		s, err := a.stream(r.Context(), view.Source, attempt > 0)
		if err != nil {
			a.Log.Warn("resolve stream", "track", view.ID, "err", err)
			writeError(w, http.StatusBadGateway, "source unavailable")
			return
		}
		retry, err := a.proxy(w, r, s)
		if err != nil && r.Context().Err() == nil {
			a.Log.Warn("proxy stream", "track", view.ID, "err", err)
		}
		if !retry {
			return
		}
	}
	writeError(w, http.StatusBadGateway, "source unavailable")
}

func (a *api) stream(ctx context.Context, src *store.SourceView, refresh bool) (*media.Stream, error) {
	now := time.Now()
	a.mu.Lock()
	c, ok := a.streams[src.ID]
	a.mu.Unlock()
	if ok && !refresh && now.Before(c.until) {
		return c.stream, nil
	}
	s, err := a.Resolver.Resolve(ctx, src.Provider, src.ExternalID)
	if err != nil {
		return nil, err
	}
	until := now.Add(streamTTL)
	if s.ExpiresAt != nil {
		if exp := time.Unix(*s.ExpiresAt, 0).Add(-5 * time.Minute); exp.Before(until) {
			until = exp
		}
	}
	a.mu.Lock()
	for id, old := range a.streams {
		if now.After(old.until) {
			delete(a.streams, id)
		}
	}
	a.streams[src.ID] = cachedStream{stream: s, until: until}
	a.mu.Unlock()
	return s, nil
}

func (a *api) proxy(w http.ResponseWriter, r *http.Request, s *media.Stream) (retry bool, err error) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, s.URL, nil)
	if err != nil {
		return false, err
	}
	for k, v := range s.Headers {
		req.Header.Set(k, v)
	}
	clientRange := r.Header.Get("Range")
	if clientRange != "" {
		req.Header.Set("Range", clientRange)
	} else {
		req.Header.Set("Range", "bytes=0-")
	}
	resp, err := a.upstream.Do(req)
	if err != nil {
		return r.Context().Err() == nil, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK, http.StatusPartialContent, http.StatusRequestedRangeNotSatisfiable:
	case http.StatusForbidden, http.StatusNotFound, http.StatusGone:
		return true, fmt.Errorf("source answered %s", resp.Status)
	default:
		writeError(w, http.StatusBadGateway, "source unavailable")
		return false, fmt.Errorf("source answered %s", resp.Status)
	}
	h := w.Header()
	h.Set("Content-Type", s.Mime)
	h.Set("Accept-Ranges", "bytes")
	h.Set("Cache-Control", "no-store")
	status, contentRange := resp.StatusCode, resp.Header.Get("Content-Range")
	if clientRange == "" && status == http.StatusPartialContent && wholeFile(contentRange) {
		status, contentRange = http.StatusOK, ""
	}
	if contentRange != "" {
		h.Set("Content-Range", contentRange)
	}
	if n := resp.Header.Get("Content-Length"); n != "" {
		h.Set("Content-Length", n)
	}
	w.WriteHeader(status)
	_, err = io.Copy(w, resp.Body)
	return false, err
}

func wholeFile(contentRange string) bool {
	var start, end, total int64
	n, _ := fmt.Sscanf(contentRange, "bytes %d-%d/%d", &start, &end, &total)
	return n == 3 && start == 0 && end == total-1
}

func newUpstreamClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.ResponseHeaderTimeout = 15 * time.Second
	return &http.Client{Transport: t}
}
