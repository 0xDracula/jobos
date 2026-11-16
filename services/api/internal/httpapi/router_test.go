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
	for _, name := range []string{"abc.m4a", strings.Repeat("a", 64) + ".mp3", strings.Repeat("a", 64) + ".300.png",
		strings.Repeat("a", 64) + ".300.m4a", "..%2F..%2Fetc%2Fpasswd"} {
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

func TestLyricsValidatesInput(t *testing.T) {
	const track = "/api/tracks/01a1e546-b14e-73a9-826b-81452848e479/lyrics"
	cases := []struct {
		method, path, body string
		want               int
	}{
		{http.MethodGet, "/api/tracks/nope/lyrics", "", http.StatusNotFound},
		{http.MethodPatch, "/api/tracks/nope/lyrics", `{"offset_ms":0}`, http.StatusNotFound},
		{http.MethodPatch, track, `{}`, http.StatusBadRequest},
		{http.MethodPatch, track, `{"offset_ms":900000}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(c.method, c.path, strings.NewReader(c.body)))
		if rec.Code != c.want {
			t.Errorf("%s %s %s: status %d, want %d", c.method, c.path, c.body, rec.Code, c.want)
		}
	}
}

func TestLinksValidateInput(t *testing.T) {
	cases := []struct{ method, path, body string }{
		{http.MethodPost, "/api/links", `{"url":"Cairokee Wahdy"}`},
		{http.MethodPost, "/api/links", `{"url":"ftp://example.com/song"}`},
		{http.MethodPut, "/api/tracks/01a1e546-b14e-73a9-826b-81452848e479/source", `{"url":"javascript:alert(1)"}`},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(c.method, c.path, strings.NewReader(c.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s %s: status %d, want 400", c.method, c.body, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/tracks/nope/sources", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("sources with a bad id: status %d, want 404", rec.Code)
	}
}

func TestSearchRejectsUnknownSources(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/search?q=wahdy&sources=ytmusic,spotify", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}
