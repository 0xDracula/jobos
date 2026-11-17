package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func TestYtdlpUpdateDue(t *testing.T) {
	cairo, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no time zone data")
	}
	at := func(s string) time.Time {
		v, err := time.ParseInLocation("2006-01-02 15:04", s, cairo)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	ptr := func(v time.Time) *time.Time { return &v }
	cases := []struct {
		now  string
		last *time.Time
		want bool
	}{
		{"2026-11-17 13:00", nil, true},
		{"2026-11-17 04:10", ptr(at("2026-11-16 04:00")), true},
		{"2026-11-17 04:10", ptr(at("2026-11-17 01:00")), false},
		{"2026-11-17 13:00", ptr(at("2026-11-16 22:00")), false},
		{"2026-11-18 13:00", ptr(at("2026-11-17 10:00")), true},
		{"2026-11-17 05:00", ptr(at("2026-11-16 04:00")), false},
		{"2026-11-17 03:59", ptr(at("2026-11-16 04:00")), false},
		{"2026-11-17 04:00", ptr(at("2026-11-16 15:59").Add(-time.Minute)), true},
	}
	for _, c := range cases {
		if got := ytdlpUpdateDue(at(c.now), c.last, cairo); got != c.want {
			t.Errorf("now %s last %v: due %v, want %v", c.now, c.last, got, c.want)
		}
	}
}

type queueStore struct {
	Store
	jobs []store.JobSpec
}

func (s *queueStore) Enqueue(_ context.Context, j store.JobSpec) (int64, bool, error) {
	s.jobs = append(s.jobs, j)
	return 7, true, nil
}

func TestYtdlpUpdateNowQueuesAheadOfOtherWork(t *testing.T) {
	st := &queueStore{}
	h := New(Deps{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), AutoUser: testUser})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/admin/ytdlp/update", nil))
	if rec.Code != http.StatusAccepted || rec.Body.String() != "{\"added\":true,\"job_id\":7}\n" {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if len(st.jobs) != 1 || st.jobs[0].Kind != store.KindUpdateYtdlp || st.jobs[0].DedupeKey != store.YtdlpUpdateKey ||
		st.jobs[0].Priority != store.PriorityInteractive {
		t.Errorf("jobs %+v", st.jobs)
	}
	member := &store.User{ID: uuid.New(), Username: "partner", Role: "member"}
	rec = httptest.NewRecorder()
	New(Deps{Store: st, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), AutoUser: member}).
		ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/admin/ytdlp/update", nil))
	if rec.Code != http.StatusForbidden {
		t.Errorf("member: status %d, want 403", rec.Code)
	}
}
