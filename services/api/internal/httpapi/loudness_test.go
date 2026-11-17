package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

type reprocessStore struct {
	Store
	limits []int
}

func (s *reprocessStore) ReprocessLoudness(_ context.Context, limit int) (int, int, error) {
	s.limits = append(s.limits, limit)
	return 2, 21, nil
}

func TestReprocessLoudness(t *testing.T) {
	st := &reprocessStore{}
	h := New(Deps{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), AutoUser: testUser})
	for path, want := range map[string]int{
		"/api/admin/loudness/reprocess":          http.StatusAccepted,
		"/api/admin/loudness/reprocess?limit=6":  http.StatusAccepted,
		"/api/admin/loudness/reprocess?limit=0":  http.StatusBadRequest,
		"/api/admin/loudness/reprocess?limit=ab": http.StatusBadRequest,
	} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
		if rec.Code != want {
			t.Errorf("%s: status %d, want %d", path, rec.Code, want)
		}
		if want == http.StatusAccepted && rec.Body.String() != "{\"found\":21,\"queued\":2}\n" {
			t.Errorf("%s: body %s", path, rec.Body.String())
		}
	}
	slices.Sort(st.limits)
	if !slices.Equal(st.limits, []int{0, 6}) {
		t.Errorf("limits %v, want [0 6]", st.limits)
	}
}
