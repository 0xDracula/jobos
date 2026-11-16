package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testServer() http.Handler {
	return New(Deps{WorkerToken: "secret", MediaRoot: "/tmp/none", Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
}

func TestInternalRoutesNeedWorkerToken(t *testing.T) {
	h := testServer()
	for _, auth := range []string{"", "Bearer wrong", "secret"} {
		req := httptest.NewRequest(http.MethodPost, "/internal/jobs/claim", strings.NewReader(`{}`))
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("auth %q: status %d, want 401", auth, rec.Code)
		}
	}
}

func TestMediaFileRejectsBadNames(t *testing.T) {
	h := testServer()
	for _, name := range []string{"abc.m4a", strings.Repeat("a", 64) + ".mp3", "..%2F..%2Fetc%2Fpasswd"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/media/"+name, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", name, rec.Code)
		}
	}
}

func TestDevPageOnlyWhenEnabled(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/dev/", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("disabled: status %d, want 404", rec.Code)
	}
	h := New(Deps{DevUI: true, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/dev/", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Jobbos dev player") {
		t.Errorf("enabled: status %d", rec.Code)
	}
}

func TestSearchNeedsQuery(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/search?q=%20", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}

func TestImportValidatesInput(t *testing.T) {
	cases := map[string]struct{ query, body string }{
		"no link":      {"?name=Mix", "Track URI,Track Name,Artist Name(s)\n"},
		"album link":   {"?name=Mix&url=https://open.spotify.com/album/7yEdkXGwVhjU2OSNidRzCT", ""},
		"no name":      {"?url=spotify:playlist:7yEdkXGwVhjU2OSNidRzCT", ""},
		"not exported": {"?name=Mix&url=spotify:playlist:7yEdkXGwVhjU2OSNidRzCT", "Title,Artist\nWahdy,Cairokee\n"},
		"no tracks":    {"?name=Mix&url=spotify:playlist:7yEdkXGwVhjU2OSNidRzCT", "Track URI,Track Name,Artist Name(s)\n"},
	}
	for name, c := range cases {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/playlists/import"+c.query, strings.NewReader(c.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
}

func TestBadIDsAreNotFound(t *testing.T) {
	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodPost, "/api/tracks/not-a-uuid/cache", nil),
		httptest.NewRequest(http.MethodGet, "/api/playlists/not-a-uuid", nil),
	} {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: status %d, want 404", req.Method, req.URL.Path, rec.Code)
		}
	}
}

func TestRematchRejectsChosenStatus(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodPost,
		"/api/playlists/01a1e546-b14e-73a9-826b-81452848e479/rematch?status=review,chosen", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}

func TestChooseSourceValidatesInput(t *testing.T) {
	cases := map[string]struct {
		path, body string
		want       int
	}{
		"bad id":           {"/api/tracks/nope/source", `{"provider":"youtube","external_id":"abc","title":"x"}`, http.StatusNotFound},
		"unknown provider": {"/api/tracks/01a1e546-b14e-73a9-826b-81452848e479/source", `{"provider":"spotify","external_id":"abc","title":"x"}`, http.StatusBadRequest},
		"no title":         {"/api/tracks/01a1e546-b14e-73a9-826b-81452848e479/source", `{"provider":"youtube","external_id":"abc"}`, http.StatusBadRequest},
	}
	for name, c := range cases {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, c.path, strings.NewReader(c.body)))
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", name, rec.Code, c.want)
		}
	}
}
