package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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

func TestPhaseOneEndpointsValidateInput(t *testing.T) {
	const track = "/api/tracks/01a1e546-b14e-73a9-826b-81452848e479"
	cases := []struct {
		method, path, contentType, body string
		want                            int
	}{
		{http.MethodPost, "/api/uploads", "application/json", `{}`, http.StatusBadRequest},
		{http.MethodPost, "/api/uploads", "multipart/form-data; boundary=x",
			"--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"song.exe\"\r\n\r\nMZ\r\n--x--\r\n", http.StatusBadRequest},
		{http.MethodPost, "/api/prefetch", "application/json", `{"track_ids":[]}`, http.StatusBadRequest},
		{http.MethodPatch, "/api/playlists/01a1e546-b14e-73a9-826b-81452848e479", "application/json", `{}`, http.StatusBadRequest},
		{http.MethodPatch, track, "application/json", `{"title":"  "}`, http.StatusBadRequest},
		{http.MethodPost, track + "/cover", "application/json", `{}`, http.StatusBadRequest},
		{http.MethodPost, "/api/admin/jobs/abc/retry", "", "", http.StatusNotFound},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		if c.contentType != "" {
			req.Header.Set("Content-Type", c.contentType)
		}
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s: status %d, want %d (%s)", c.method, c.path, rec.Code, c.want, rec.Body.String())
		}
	}
}

func TestPhaseTwoEndpointsValidateInput(t *testing.T) {
	const pl = "/api/playlists/01a1e546-b14e-73a9-826b-81452848e479"
	cases := []struct {
		method, path, body string
		want               int
	}{
		{http.MethodPost, "/api/devices", `{"name":""}`, http.StatusBadRequest},
		{http.MethodPost, "/api/events", `{"events":[]}`, http.StatusBadRequest},
		{http.MethodPost, "/api/events", `{"events":[{"track_id":"01a1e546-b14e-73a9-826b-81452848e479","event":"dance"}]}`, http.StatusBadRequest},
		{http.MethodPut, "/api/playback", `{"device_id":"01a1e546-b14e-73a9-826b-81452848e479","repeat":"forever"}`, http.StatusBadRequest},
		{http.MethodPost, "/api/playlists", `{"name":"  "}`, http.StatusBadRequest},
		{http.MethodPatch, pl, `{"name":""}`, http.StatusBadRequest},
		{http.MethodPost, pl + "/items", `{"track_ids":[]}`, http.StatusBadRequest},
		{http.MethodPut, "/api/hidden/album/01a1e546-b14e-73a9-826b-81452848e479", "", http.StatusNotFound},
		{http.MethodGet, "/api/library/search?q=", "", http.StatusBadRequest},
		{http.MethodGet, "/api/albums/nope", "", http.StatusNotFound},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		testServer().ServeHTTP(rec, httptest.NewRequest(c.method, c.path, strings.NewReader(c.body)))
		if rec.Code != c.want {
			t.Errorf("%s %s %s: status %d, want %d", c.method, c.path, c.body, rec.Code, c.want)
		}
	}
}

func TestWebAppServesPagesAndAssets(t *testing.T) {
	root := t.TempDir()
	for name, body := range map[string]string{
		"index.html":                 "home",
		"library/index.html":         "library",
		"404.html":                   "missing",
		"_next/static/chunks/app.js": "js",
	} {
		p := root + "/" + name
		if err := os.MkdirAll(p[:strings.LastIndex(p, "/")], 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h := New(Deps{WebRoot: root, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	for path, want := range map[string]struct {
		code        int
		body, cache string
	}{
		"/":                           {200, "home", "no-cache"},
		"/library/":                   {200, "library", "no-cache"},
		"/_next/static/chunks/app.js": {200, "js", "public, max-age=31536000, immutable"},
		"/nowhere":                    {404, "missing", "no-cache"},
		"/../etc/passwd":              {404, "missing", "no-cache"},
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want.code || rec.Body.String() != want.body || rec.Header().Get("Cache-Control") != want.cache {
			t.Errorf("%s: %d %q %q", path, rec.Code, rec.Body.String(), rec.Header().Get("Cache-Control"))
		}
	}
}
