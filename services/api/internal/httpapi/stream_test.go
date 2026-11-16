package httpapi

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/media"
	"jobbos/api/internal/store"
)

type streamStore struct {
	Store
	view     *store.TrackView
	enqueued int
}

func (s *streamStore) Track(context.Context, uuid.UUID) (*store.TrackView, error) { return s.view, nil }

func (s *streamStore) Enqueue(context.Context, store.JobSpec) (int64, bool, error) {
	s.enqueued++
	return 1, true, nil
}

type fakeResolver struct {
	urls  []string
	calls int
}

func (f *fakeResolver) Resolve(context.Context, string, string) (*media.Stream, error) {
	u := f.urls[min(f.calls, len(f.urls)-1)]
	f.calls++
	return &media.Stream{URL: u, Mime: "audio/mp4", Headers: map[string]string{"User-Agent": "test"}}, nil
}

var song = bytes.Repeat([]byte("0123456789"), 100)

func upstream(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/expired" {
			http.Error(w, "expired", http.StatusForbidden)
			return
		}
		if r.Header.Get("User-Agent") != "test" || r.Header.Get("Range") == "" {
			http.Error(w, "missing headers", http.StatusBadRequest)
			return
		}
		http.ServeContent(w, r, "song.m4a", time.Time{}, bytes.NewReader(song))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func streamServer(view *store.TrackView, r *fakeResolver) (http.Handler, *streamStore) {
	st := &streamStore{view: view}
	return New(Deps{Store: st, Resolver: r, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}), st
}

func uncached() *store.TrackView {
	id := uuid.New()
	return &store.TrackView{ID: id, Status: "queued",
		Source: &store.SourceView{ID: uuid.New(), Provider: "ytmusic", ExternalID: "abc"}}
}

func get(h http.Handler, path, rangeHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestStreamPassesRangesThrough(t *testing.T) {
	up := upstream(t)
	view := uncached()
	h, st := streamServer(view, &fakeResolver{urls: []string{up.URL + "/song"}})
	rec := get(h, "/api/tracks/"+view.ID.String()+"/stream", "bytes=10-19")
	if rec.Code != http.StatusPartialContent || rec.Body.String() != string(song[10:20]) {
		t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Range") != "bytes 10-19/1000" || rec.Header().Get("Content-Type") != "audio/mp4" {
		t.Errorf("headers %v", rec.Header())
	}
	if st.enqueued != 1 {
		t.Errorf("download enqueued %d times, want 1", st.enqueued)
	}
}

func TestStreamWithoutRangeIsWholeFile(t *testing.T) {
	up := upstream(t)
	view := uncached()
	h, _ := streamServer(view, &fakeResolver{urls: []string{up.URL + "/song"}})
	rec := get(h, "/api/tracks/"+view.ID.String()+"/stream", "")
	if rec.Code != http.StatusOK || rec.Body.Len() != len(song) || rec.Header().Get("Content-Range") != "" {
		t.Fatalf("status %d, %d bytes, Content-Range %q", rec.Code, rec.Body.Len(), rec.Header().Get("Content-Range"))
	}
}

func TestStreamResolvesAgainWhenTheURLExpired(t *testing.T) {
	up := upstream(t)
	view := uncached()
	r := &fakeResolver{urls: []string{up.URL + "/expired", up.URL + "/song"}}
	h, _ := streamServer(view, r)
	rec := get(h, "/api/tracks/"+view.ID.String()+"/stream", "bytes=0-9")
	if rec.Code != http.StatusPartialContent || r.calls != 2 {
		t.Fatalf("status %d after %d resolves", rec.Code, r.calls)
	}
	if rec := get(h, "/api/tracks/"+view.ID.String()+"/stream", "bytes=0-9"); rec.Code != http.StatusPartialContent || r.calls != 2 {
		t.Fatalf("second request: status %d after %d resolves", rec.Code, r.calls)
	}
}

func TestStreamRedirectsCachedAndRefusesWithoutRecording(t *testing.T) {
	cached := uncached()
	cached.Status, cached.Audio = "cached", &store.AudioView{URL: "/api/media/" + strings.Repeat("a", 64) + ".m4a"}
	h, _ := streamServer(cached, &fakeResolver{})
	if rec := get(h, "/api/tracks/"+cached.ID.String()+"/stream", ""); rec.Code != http.StatusTemporaryRedirect || rec.Header().Get("Location") != cached.Audio.URL {
		t.Errorf("cached: status %d location %q", rec.Code, rec.Header().Get("Location"))
	}
	none := uncached()
	none.Source = nil
	h, _ = streamServer(none, &fakeResolver{})
	if rec := get(h, "/api/tracks/"+none.ID.String()+"/stream", ""); rec.Code != http.StatusConflict {
		t.Errorf("no recording: status %d", rec.Code)
	}
}

func TestWholeFile(t *testing.T) {
	for cr, want := range map[string]bool{"bytes 0-999/1000": true, "bytes 0-9/1000": false, "bytes 5-999/1000": false, "": false} {
		if got := wholeFile(cr); got != want {
			t.Errorf("wholeFile(%q) = %v", cr, got)
		}
	}
}
