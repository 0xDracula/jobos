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

func TestSearchNeedsQuery(t *testing.T) {
	rec := httptest.NewRecorder()
	testServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/search?q=%20", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400", rec.Code)
	}
}
