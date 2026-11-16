package httpapi

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"jobbos/api/internal/store"
)

func TestSwapWeekRevealsFridayEvening(t *testing.T) {
	cairo, err := time.LoadLocation("Africa/Cairo")
	if err != nil {
		t.Skip("no tzdata")
	}
	at := func(s string) time.Time {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, cairo)
		return v
	}
	cases := map[string]string{
		"2026-11-17 10:00": "2026-11-20 20:00",
		"2026-11-20 19:59": "2026-11-20 20:00",
		"2026-11-20 20:00": "2026-11-27 20:00",
		"2026-11-21 09:00": "2026-11-27 20:00",
	}
	for now, want := range cases {
		if got := swapWeek(at(now), cairo).Format("2006-01-02 15:04"); got != want {
			t.Errorf("%s: reveal %s, want %s", now, got, want)
		}
	}
}

func TestVisibilityFilter(t *testing.T) {
	admin := &store.User{ID: uuid.New(), Role: "admin"}
	member := &store.User{ID: uuid.New(), Role: "member"}
	modes := map[string]string{"online_last_seen": "admin", "typing": "shared"}
	if !canSee(modes, admin, member, "online_last_seen") || canSee(modes, member, admin, "online_last_seen") {
		t.Error("admin-only mode")
	}
	if !canSee(modes, member, admin, "typing") {
		t.Error("shared mode")
	}
	if canSee(modes, admin, member, "read_receipts") {
		t.Error("an unset signal must behave as off")
	}
	if !canSee(modes, member, member, "read_receipts") {
		t.Error("people always see their own signals")
	}
}
